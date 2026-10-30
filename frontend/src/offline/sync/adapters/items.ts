import {
	beginItemCatalogGeneration,
	clearItemDetailsCache,
	clearPriceListCache,
	deleteStoredItemsByCodes,
	discardItemCatalogGeneration,
	getActiveItemCatalogGeneration,
	getStoredItemsCountByScope,
	mergeCachedPriceListItems,
	removeCachedPriceListItems,
	removeItemDetailsCacheEntries,
	saveItemDetailsCache,
	saveItemsBulk,
	stageItemCatalogRows,
	promoteItemCatalogGeneration,
	setItemsLastSync,
	withItemCatalogRefreshLock,
} from "../../cache";
import { getSyncResourceState } from "../syncState";
import {
	buildResourceSyncResult,
	buildScopeSignature,
	persistResourceSyncState,
	refreshSnapshotFromSync,
	resolveWatermark,
	type ResourceSyncResult,
	type SyncResponse,
	type SyncScopedProfile,
} from "./common";

type ItemsFetcher = (_args: {
	posProfile: SyncScopedProfile;
	priceList?: string | null;
	customer?: string | null;
	watermark?: string | null;
	startAfter?: string | null;
	limit?: number;
	schemaVersion?: string | null;
}) => Promise<SyncResponse>;

type ItemsSyncArgs = {
	posProfile: SyncScopedProfile;
	priceList?: string | null;
	customer?: string | null;
	watermark?: string | null;
	schemaVersion?: string | null;
	fetcher: ItemsFetcher;
};

const ITEM_SYNC_PAGE_SIZE = 1000;

function buildItemStorageScope(posProfile: SyncScopedProfile) {
	const profileName = posProfile?.name || "no_profile";
	const warehouse = posProfile?.warehouse || "no_warehouse";
	return `${profileName}_${warehouse}`;
}

function extractChangedItems(response: SyncResponse) {
	return (response?.changes || [])
		.map((entry) => entry?.data)
		.filter((row): row is Record<string, any> => !!row?.item_code);
}

function extractDeletedItemCodes(response: SyncResponse) {
	return (response?.deleted || [])
		.map((entry) => {
			const key = String(entry?.key || "");
			return key.startsWith("item::") ? key.slice("item::".length) : "";
		})
		.filter(Boolean);
}

function getLastItemCursor(response: SyncResponse) {
	const changes = Array.isArray(response?.changes) ? response.changes : [];
	for (let index = changes.length - 1; index >= 0; index -= 1) {
		const itemCode = String(changes[index]?.data?.item_code || "").trim();
		if (itemCode) {
			return itemCode;
		}
		const key = String(changes[index]?.key || "").trim();
		if (key.startsWith("item::")) {
			return key.slice("item::".length);
		}
	}
	return null;
}

function laterWatermark(
	current: string | null,
	candidate: string | null | undefined,
) {
	if (!candidate) {
		return current;
	}
	if (!current) {
		return candidate;
	}
	return candidate > current ? candidate : current;
}

async function hasItemScopeChanged(posProfile: SyncScopedProfile) {
	const nextScopeSignature = buildScopeSignature(posProfile);
	const currentState = await getSyncResourceState("items");
	if (
		currentState?.scopeSignature &&
		currentState.scopeSignature !== nextScopeSignature
	) {
		return true;
	}
	return false;
}

async function persistItemSyncState(
	status: "fresh" | "limited",
	args: ItemsSyncArgs,
	response: SyncResponse,
	watermark?: string | null,
) {
	await persistResourceSyncState({
		resourceId: "items",
		status,
		posProfile: args.posProfile,
		response,
		watermark,
	});
}

async function applyItemSyncResponse(
	args: ItemsSyncArgs,
	response: SyncResponse,
	storageScope: string,
	generation: string | null = null,
) {
	const changedItems = extractChangedItems(response);
	let stagedCount = 0;
	if (changedItems.length) {
		if (generation) {
			stagedCount = await stageItemCatalogRows(
				changedItems,
				storageScope,
				generation,
			);
		} else {
			await saveItemsBulk(changedItems, storageScope);
		}
		if (!generation && args.priceList) {
			saveItemDetailsCache(
				args.posProfile.name,
				args.priceList,
				changedItems,
			);
			mergeCachedPriceListItems(args.priceList, changedItems);
		}
	}

	const deletedItemCodes = extractDeletedItemCodes(response);
	if (!generation && deletedItemCodes.length) {
		await deleteStoredItemsByCodes(deletedItemCodes, storageScope);
		removeItemDetailsCacheEntries(
			args.posProfile.name,
			deletedItemCodes,
			args.priceList || null,
		);
		removeCachedPriceListItems(deletedItemCodes, args.priceList || null);
	}
	return stagedCount;
}

async function fetchAndStoreItemPages({
	args,
	watermark,
	schemaVersion,
	storageScope,
	generation = null,
}: {
	args: ItemsSyncArgs;
	watermark: string | null;
	schemaVersion?: string | null;
	storageScope: string;
	generation?: string | null;
}) {
	let startAfter: string | null = null;
	let latestWatermark = watermark;
	let schemaVersionSeen = schemaVersion || null;
	let lastResponse: SyncResponse = {};
	let stagedCount = 0;

	while (true) {
		const response = await args.fetcher({
			posProfile: args.posProfile,
			priceList: args.priceList || null,
			customer: args.customer || null,
			watermark,
			startAfter,
			limit: ITEM_SYNC_PAGE_SIZE,
			schemaVersion,
		});
		lastResponse = response || {};

		if (response?.full_resync_required) {
			return response;
		}

		const responseStagedCount = await applyItemSyncResponse(
			args,
			response,
			storageScope,
			generation,
		);
		if (generation) {
			stagedCount += responseStagedCount;
		}
		latestWatermark = laterWatermark(
			latestWatermark,
			response?.next_watermark,
		);
		schemaVersionSeen =
			response?.schema_version || schemaVersionSeen || null;

		if (!response?.has_more || watermark) {
			break;
		}

		const nextStartAfter = getLastItemCursor(response);
		if (!nextStartAfter || nextStartAfter === startAfter) {
			throw new Error("Item sync pagination cursor did not advance");
		}
		startAfter = nextStartAfter;
	}

	return {
		...lastResponse,
		changes: [],
		deleted: [],
		has_more: Boolean(lastResponse?.has_more && watermark),
		next_watermark:
			lastResponse?.has_more && watermark ? watermark : latestWatermark,
		schema_version: schemaVersionSeen,
		staged_count: stagedCount,
	};
}

async function fetchAndPromoteFullItemCatalog(
	args: ItemsSyncArgs,
	storageScope: string,
	schemaVersion: string | null | undefined,
) {
	return await withItemCatalogRefreshLock(storageScope, async () => {
		const { generation } = await beginItemCatalogGeneration(storageScope);
		try {
			const response = await fetchAndStoreItemPages({
				args,
				watermark: null,
				schemaVersion,
				storageScope,
				generation,
			});
			if (response?.full_resync_required) {
				await discardItemCatalogGeneration(storageScope, generation);
				return response;
			}

			await promoteItemCatalogGeneration(storageScope, generation, {
				expectedCount: Number((response as any)?.staged_count || 0),
				allowEmpty: true,
			});
			clearPriceListCache();
			clearItemDetailsCache();
			return response;
		} catch (error) {
			await discardItemCatalogGeneration(storageScope, generation).catch(
				() => undefined,
			);
			throw error;
		}
	});
}

export async function syncItemsResource(
	args: ItemsSyncArgs,
): Promise<ResourceSyncResult> {
	const scopeChanged = await hasItemScopeChanged(args.posProfile);
	let effectiveWatermark = scopeChanged ? null : args.watermark || null;
	const storageScope = buildItemStorageScope(args.posProfile);
	if (!(await getActiveItemCatalogGeneration(storageScope))) {
		// V16 and limit-search profiles may have a watermark without a complete
		// durable catalog. Build the first generation before accepting deltas.
		effectiveWatermark = null;
	}

	let response = effectiveWatermark
		? await fetchAndStoreItemPages({
				args,
				watermark: effectiveWatermark,
				schemaVersion: args.schemaVersion,
				storageScope,
			})
		: await fetchAndPromoteFullItemCatalog(
				args,
				storageScope,
				args.schemaVersion,
			);

	if (response?.full_resync_required) {
		effectiveWatermark = null;
		response = await fetchAndPromoteFullItemCatalog(
			args,
			storageScope,
			null,
		);
	}

	if (response?.full_resync_required) {
		await persistItemSyncState(
			"limited",
			args,
			response,
			effectiveWatermark,
		);
		return buildResourceSyncResult(
			"items",
			"limited",
			response,
			effectiveWatermark,
		);
	}

	const itemsCount = await getStoredItemsCountByScope(storageScope);
	refreshSnapshotFromSync({
		posProfile: args.posProfile,
		cacheState: {
			itemsCount,
		},
	});

	const nextWatermark = resolveWatermark(response, effectiveWatermark);
	if (nextWatermark) {
		setItemsLastSync(nextWatermark);
	}

	const status = response?.has_more ? "limited" : "fresh";
	await persistItemSyncState(status, args, response, effectiveWatermark);
	return buildResourceSyncResult(
		"items",
		status,
		response,
		effectiveWatermark,
	);
}
