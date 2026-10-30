import { describe, expect, it, vi } from "vitest";

const setOffers = vi.fn();
const serverCall = vi.fn();

vi.mock("../src/posapp/stores/uiStore.js", () => ({
	useUIStore: () => ({ setOffers }),
}));

vi.mock("../src/offline/index", () => ({
	getCachedOffers: vi.fn(() => [{ name: "OFFLINE-OFFER" }]),
	isOffline: vi.fn(() => true),
	memoryInitPromise: Promise.resolve(),
	saveOffers: vi.fn(),
}));

import { useOffers } from "../src/posapp/composables/pos/shared/useOffers";

describe("offline offer hydration", () => {
	it("restores cached offers after a hard offline refresh without a server call", async () => {
		(globalThis as any).frappe = { call: serverCall };
		const api = useOffers();

		await api.get_offers("Main POS", { name: "Main POS" });

		expect(api.offers.value).toEqual([
			{ name: "OFFLINE-OFFER", row_id: "OFFLINE-OFFER" },
		]);
		expect(setOffers).toHaveBeenCalledWith([
			{ name: "OFFLINE-OFFER", row_id: "OFFLINE-OFFER" },
		]);
		expect(serverCall).not.toHaveBeenCalled();
	});
});
