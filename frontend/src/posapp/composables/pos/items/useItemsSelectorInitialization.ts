import { watch, type Ref, type WatchStopHandle } from "vue";

import { startupInitPromise } from "../../../../offline/index";
import {
	finishStartupPhase,
	startStartupPhase,
} from "../../../../utils/startupTrace";

type PosProfileLike = {
	name?: string | null;
	currency?: string | null;
};

type ItemsIntegrationLike = {
	initializeStore: (
		_profile: PosProfileLike,
		_customer: unknown,
		_priceList: unknown,
	) => Promise<void>;
};

type UseItemsSelectorInitializationArgs = {
	uiPosProfile: Ref<PosProfileLike | null | undefined>;
	selectedCustomer: Ref<unknown>;
	customerPriceList: Ref<unknown>;
	selectedCurrency: Ref<string>;
	selectedExchangeRate: Ref<number>;
	selectedConversionRate: Ref<number>;
	isInitialized: Ref<boolean>;
	initTimeout: Ref<ReturnType<typeof setTimeout> | null>;
	initError: Ref<unknown>;
	itemsIntegration: ItemsIntegrationLike;
	startItemWorker: () => void;
	loadItemSettings: () => void;
	startBackgroundSyncScheduler: () => void;
	timeoutMs?: number;
};

function resolveErrorMessage(error: unknown) {
	if (error instanceof Error) {
		return error.message || error;
	}
	return error;
}

export function startItemsSelectorInitialization({
	uiPosProfile,
	selectedCustomer,
	customerPriceList,
	selectedCurrency,
	selectedExchangeRate,
	selectedConversionRate,
	isInitialized,
	initTimeout,
	initError,
	itemsIntegration,
	startItemWorker,
	loadItemSettings,
	startBackgroundSyncScheduler,
	timeoutMs = 10000,
}: UseItemsSelectorInitializationArgs): WatchStopHandle {
	return watch(
		uiPosProfile,
		async (newProfile) => {
			if (!newProfile?.name || isInitialized.value) {
				return;
			}

			if (initTimeout.value) clearTimeout(initTimeout.value);
			initTimeout.value = setTimeout(() => {
				if (!isInitialized.value) {
					console.warn(
						"ItemsSelector: Initialization taking too long, forcing isInitialized to true.",
					);
					isInitialized.value = true;
				}
			}, timeoutMs);

			const phase = startStartupPhase("items.selector_initialization", {
				profile: newProfile.name,
			});
			try {
				// Storage hydration is not a prerequisite for the online catalog call.
				// Keep it running so offline queues and caches become ready independently.
				void startupInitPromise;

				selectedCurrency.value = newProfile.currency || "";
				selectedExchangeRate.value = 1;
				selectedConversionRate.value = 1;

				await itemsIntegration.initializeStore(
					newProfile,
					selectedCustomer.value,
					customerPriceList.value,
				);

				isInitialized.value = true;
				startItemWorker();
				loadItemSettings();
				startBackgroundSyncScheduler();
				finishStartupPhase(phase, "ok");
			} catch (err: unknown) {
				console.error("ItemsSelector: Initialization failed", err);
				initError.value = resolveErrorMessage(err);
				isInitialized.value = true;
				finishStartupPhase(phase, "error", { error: err });
			} finally {
				if (initTimeout.value) {
					clearTimeout(initTimeout.value);
					initTimeout.value = null;
				}
			}
		},
		{ immediate: true },
	);
}
