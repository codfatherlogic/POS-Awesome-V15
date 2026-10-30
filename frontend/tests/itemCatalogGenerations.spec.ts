// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	beginItemCatalogGeneration,
	deleteStoredItemsByCodes,
	discardItemCatalogGeneration,
	getStoredItemsCountByScope,
	promoteItemCatalogGeneration,
	saveItemsBulk,
	searchStoredItems,
	stageItemCatalogRows,
} from "../src/offline/cache";
import { db, initPromise } from "../src/offline/db";

const scope = "POS-COUNTER_Main Store";

async function seedActiveCatalog() {
	await saveItemsBulk(
		[
			{
				item_code: "OLD-1",
				item_name: "Reliable Old Catalog Item",
				item_group: "Medicines",
			},
		],
		scope,
	);
	const { generation } = await beginItemCatalogGeneration(scope);
	await stageItemCatalogRows(
		[
			{
				item_code: "ACTIVE-1",
				item_name: "Active Panadol",
				item_group: "Medicines",
			},
		],
		scope,
		generation,
	);
	await promoteItemCatalogGeneration(scope, generation, {
		expectedCount: 1,
	});
	return generation;
}

describe("generation-safe item catalog persistence", () => {
	beforeEach(async () => {
		await initPromise;
		if (!db.isOpen()) await db.open();
		await Promise.all([
			db.table("items").clear(),
			db.table("item_catalog_rows").clear(),
			db.table("item_catalog_state").clear(),
		]);
	});

	it("keeps legacy rows readable until the first complete generation is promoted", async () => {
		await saveItemsBulk(
			[
				{
					item_code: "LEGACY-1",
					item_name: "Legacy Searchable Item",
					item_group: "Medicines",
				},
			],
			scope,
		);
		const { generation } = await beginItemCatalogGeneration(scope);
		await stageItemCatalogRows(
			[
				{
					item_code: "NEW-1",
					item_name: "New Searchable Item",
					item_group: "Medicines",
				},
			],
			scope,
			generation,
		);

		expect(
			(await searchStoredItems({ search: "legacy", scope })).map(
				(item) => item.item_code,
			),
		).toEqual(["LEGACY-1"]);

		await promoteItemCatalogGeneration(scope, generation, {
			expectedCount: 1,
		});

		expect(
			(await searchStoredItems({ search: "new", scope })).map(
				(item) => item.item_code,
			),
		).toEqual(["NEW-1"]);
		expect(await db.table("items").count()).toBe(0);
	});

	it("retains the last complete generation when replacement validation fails", async () => {
		const activeGeneration = await seedActiveCatalog();
		const { generation } = await beginItemCatalogGeneration(scope);
		await stageItemCatalogRows(
			[{ item_code: "PARTIAL-1", item_name: "Partial Catalog" }],
			scope,
			generation,
		);

		await expect(
			promoteItemCatalogGeneration(scope, generation, {
				expectedCount: 2,
			}),
		).rejects.toThrow("expected 2, stored 1");

		const state = await db.table("item_catalog_state").get(scope);
		expect(state.active_generation).toBe(activeGeneration);
		expect(
			(await searchStoredItems({ search: "panadol", scope })).map(
				(item) => item.item_code,
			),
		).toEqual(["ACTIVE-1"]);
	});

	it("ignores an abandoned crash generation until an atomic promotion", async () => {
		await seedActiveCatalog();
		const { generation } = await beginItemCatalogGeneration(scope);
		await stageItemCatalogRows(
			[{ item_code: "CRASH-1", item_name: "Uncommitted Crash Row" }],
			scope,
			generation,
		);

		expect(await getStoredItemsCountByScope(scope)).toBe(1);
		expect(await searchStoredItems({ search: "crash", scope })).toEqual([]);

		await discardItemCatalogGeneration(scope, generation);
	});

	it("prunes a stale crash generation when the next refresh starts", async () => {
		await seedActiveCatalog();
		const abandoned = await beginItemCatalogGeneration(scope);
		await stageItemCatalogRows(
			[{ item_code: "STALE-1", item_name: "Stale Staging Row" }],
			scope,
			abandoned.generation,
		);
		const state = await db.table("item_catalog_state").get(scope);
		await db.table("item_catalog_state").put({
			...state,
			staging_generations: [
				{
					generation: abandoned.generation,
					started_at: "2026-01-01T00:00:00.000Z",
				},
			],
		});

		const fresh = await beginItemCatalogGeneration(scope);

		expect(
			await db
				.table("item_catalog_rows")
				.where("[profile_scope+catalog_generation]")
				.equals([scope, abandoned.generation])
				.count(),
		).toBe(0);
		await discardItemCatalogGeneration(scope, fresh.generation);
	});

	it("does not prune another fresh staging generation", async () => {
		await seedActiveCatalog();
		const first = await beginItemCatalogGeneration(scope);
		await stageItemCatalogRows(
			[{ item_code: "FIRST-1", item_name: "First Staging Row" }],
			scope,
			first.generation,
		);
		const second = await beginItemCatalogGeneration(scope);

		expect(
			await db
				.table("item_catalog_rows")
				.where("[profile_scope+catalog_generation]")
				.equals([scope, first.generation])
				.count(),
		).toBe(1);
		await discardItemCatalogGeneration(scope, first.generation);
		await discardItemCatalogGeneration(scope, second.generation);
	});

	it("retains the active generation when IndexedDB rejects staging for quota", async () => {
		await seedActiveCatalog();
		const { generation } = await beginItemCatalogGeneration(scope);
		const table = db.table("item_catalog_rows");
		const quotaError = new DOMException(
			"Storage quota exceeded",
			"QuotaExceededError",
		);
		const bulkPut = vi
			.spyOn(table, "bulkPut")
			.mockRejectedValueOnce(quotaError);

		await expect(
			stageItemCatalogRows(
				[{ item_code: "QUOTA-1", item_name: "Quota Row" }],
				scope,
				generation,
			),
		).rejects.toBe(quotaError);
		bulkPut.mockRestore();

		expect(
			(await searchStoredItems({ search: "active", scope })).map(
				(item) => item.item_code,
			),
		).toEqual(["ACTIVE-1"]);
	});

	it("promotes a complete replacement and prunes only the superseded generation", async () => {
		const previousGeneration = await seedActiveCatalog();
		const { generation } = await beginItemCatalogGeneration(scope);
		await stageItemCatalogRows(
			[
				{ item_code: "NEXT-1", item_name: "Next One" },
				{ item_code: "NEXT-2", item_name: "Next Two" },
			],
			scope,
			generation,
		);

		const promoted = await promoteItemCatalogGeneration(scope, generation, {
			expectedCount: 2,
		});

		expect(promoted).toEqual({
			generation,
			rowCount: 2,
			previousGeneration,
		});
		expect(await getStoredItemsCountByScope(scope)).toBe(2);
		expect(
			await db
				.table("item_catalog_rows")
				.where("[profile_scope+catalog_generation]")
				.equals([scope, previousGeneration])
				.count(),
		).toBe(0);
	});

	it("applies delta updates and deletes only to the active generation", async () => {
		await seedActiveCatalog();
		await saveItemsBulk([{ item_code: "ACTIVE-1", actual_qty: 9 }], scope);

		const [updated] = await searchStoredItems({
			search: "panadol",
			scope,
		});
		expect(updated).toEqual(
			expect.objectContaining({
				item_code: "ACTIVE-1",
				item_name: "Active Panadol",
				actual_qty: 9,
			}),
		);

		await deleteStoredItemsByCodes(["ACTIVE-1"], scope);
		expect(await getStoredItemsCountByScope(scope)).toBe(0);
	});
});
