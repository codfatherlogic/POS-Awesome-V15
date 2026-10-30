import { nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/offline/index", () => ({
	startupInitPromise: new Promise<void>(() => {}),
}));

import { startItemsSelectorInitialization } from "../src/posapp/composables/pos/items/useItemsSelectorInitialization";

describe("item startup critical path", () => {
	it("releases shell hydration before starting offline resource synchronization", () => {
		const testsDir = path.dirname(fileURLToPath(import.meta.url));
		const source = readFileSync(
			path.resolve(testsDir, "../src/posapp/layouts/DefaultLayout.vue"),
			"utf8",
		);
		const initializeData = source.slice(
			source.indexOf("const initializeData"),
		);

		expect(
			initializeData.indexOf('markSourceLoaded("init")'),
		).toBeGreaterThan(-1);
		expect(
			initializeData.indexOf("finishInitialOfflineResourceSync()"),
		).toBeGreaterThan(initializeData.indexOf('markSourceLoaded("init")'));
	});

	it("starts catalog initialization without waiting for unrelated offline hydration", async () => {
		const initializeStore = vi.fn(async () => undefined);
		const isInitialized = ref(false);
		const initTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
		const stop = startItemsSelectorInitialization({
			uiPosProfile: ref({ name: "POS-1", currency: "PKR" }),
			selectedCustomer: ref("Walk In"),
			customerPriceList: ref("Retail"),
			selectedCurrency: ref(""),
			selectedExchangeRate: ref(0),
			selectedConversionRate: ref(0),
			isInitialized,
			initTimeout,
			initError: ref(null),
			itemsIntegration: { initializeStore },
			startItemWorker: vi.fn(),
			loadItemSettings: vi.fn(),
			startBackgroundSyncScheduler: vi.fn(),
			timeoutMs: 60_000,
		});

		await nextTick();
		await vi.waitFor(() => expect(isInitialized.value).toBe(true));

		expect(initializeStore).toHaveBeenCalledWith(
			expect.objectContaining({ name: "POS-1" }),
			"Walk In",
			"Retail",
		);
		stop();
		if (initTimeout.value) clearTimeout(initTimeout.value);
	});
});
