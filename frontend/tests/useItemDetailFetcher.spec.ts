import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCachedItemDetails, saveItemDetailsCache, updateLocalStockCache } =
	vi.hoisted(() => ({
		getCachedItemDetails: vi.fn(),
		saveItemDetailsCache: vi.fn(),
		updateLocalStockCache: vi.fn(),
	}));

vi.mock("../src/offline/index", () => ({
	getCachedItemDetails,
	saveItemDetailsCache,
	saveItemsBulk: vi.fn(async () => {}),
	updateLocalStockCache,
	saveItemUOMs: vi.fn(),
	getItemUOMs: vi.fn(() => []),
	getLocalStock: vi.fn(() => null),
	getLocalStockCache: vi.fn(() => ({})),
	isStockCacheReady: vi.fn(() => false),
	initializeStockCache: vi.fn(async () => {}),
	isOffline: vi.fn(() => false),
}));

vi.mock("../src/posapp/utils/perf.js", () => ({
	scheduleFrame: vi.fn(async () => {}),
}));

import { useItemDetailFetcher } from "../src/posapp/composables/pos/items/useItemDetailFetcher";

describe("useItemDetailFetcher", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getCachedItemDetails.mockResolvedValue({
			cached: [],
			missing: ["ITEM-1"],
		});
		(globalThis as any).frappe = {
			call: vi.fn(async () => ({
				message: [
					{
						item_code: "ITEM-1",
						actual_qty: 0,
						has_batch_no: 1,
						has_serial_no: 1,
						batch_no_data: [],
						serial_no_data: [],
					},
				],
			})),
		};
	});

	it("replaces stale batch and serial lists when server returns empty arrays", async () => {
		const fetcher = useItemDetailFetcher();
		fetcher.registerContext({
			pos_profile: { name: "POS-TEST" },
			active_price_list: "Standard Selling",
			itemAvailability: null,
			applyCurrencyConversionToItem: vi.fn(),
			items: [],
			displayedItems: [],
			usesLimitSearch: false,
			storageAvailable: false,
		});

		const item: any = {
			item_code: "ITEM-1",
			has_batch_no: 1,
			has_serial_no: 1,
			batch_no_data: [{ batch_no: "B-EXPIRED", batch_qty: 7, is_expired: true }],
			serial_no_data: [{ serial_no: "SER-OLD" }],
		};

		await fetcher.update_items_details([item], { forceRefresh: true });

		expect(item.batch_no_data).toEqual([]);
		expect(item.serial_no_data).toEqual([]);
		expect(item.actual_qty).toBe(0);
		expect(updateLocalStockCache).toHaveBeenCalledTimes(1);
		expect(saveItemDetailsCache).toHaveBeenCalledTimes(1);
	});

	it("resolves context getters dynamically for POS profile", async () => {
		const fetcher = useItemDetailFetcher();
		let currentProfile: any = null;

		fetcher.registerContext({
			get pos_profile() {
				return currentProfile;
			},
			active_price_list: "Standard Selling",
			itemAvailability: null,
			applyCurrencyConversionToItem: vi.fn(),
			items: [],
			displayedItems: [],
			usesLimitSearch: false,
			storageAvailable: false,
		});

		currentProfile = { name: "POS-TEST" };

		const details = await fetcher.fetchItemDetails([{ item_code: "ITEM-1" }]);

		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);
		expect(details).toHaveLength(1);
	});

	it("re-applies cart reservations after cached visible stock refreshes", async () => {
		getCachedItemDetails.mockResolvedValue({
			cached: [{ item_code: "ITEM-1", actual_qty: 10 }],
			missing: [],
		});
		const item = { item_code: "ITEM-1", actual_qty: 8 };
		const itemAvailability = {
			captureBaseAvailability: vi.fn(),
			applyReservationToItem: vi.fn((target: any) => {
				target.actual_qty = 8;
			}),
		};
		const fetcher = useItemDetailFetcher();
		fetcher.registerContext({
			pos_profile: { name: "POS-TEST" },
			active_price_list: "Standard Selling",
			itemAvailability,
			displayedItems: [item],
			usesLimitSearch: false,
			storageAvailable: false,
		});

		await fetcher.refreshPricesForVisibleItems();

		expect(itemAvailability.captureBaseAvailability).toHaveBeenCalledWith(
			item,
			10,
		);
		expect(itemAvailability.applyReservationToItem).toHaveBeenCalledWith(
			item,
		);
		expect(item.actual_qty).toBe(8);
	});

	it("hydrates batch and serial options from cached item details", async () => {
		getCachedItemDetails.mockResolvedValue({
			cached: [
				{
					item_code: "ITEM-1",
					actual_qty: 4,
					has_batch_no: 1,
					has_serial_no: 1,
					batch_no_data: [
						{ batch_no: "B-CACHED", batch_qty: 4 },
					],
					serial_no_data: [
						{ serial_no: "S-CACHED", batch_no: "B-CACHED" },
					],
					item_uoms: [{ uom: "Nos", conversion_factor: 1 }],
				},
			],
			missing: [],
		});
		const fetcher = useItemDetailFetcher();
		fetcher.registerContext({
			pos_profile: { name: "POS-TEST" },
			active_price_list: "Standard Selling",
			itemAvailability: null,
			applyCurrencyConversionToItem: vi.fn(),
			usesLimitSearch: false,
			storageAvailable: false,
		});
		const item: any = { item_code: "ITEM-1", stock_uom: "Nos" };

		await fetcher.update_items_details([item]);

		expect(item.batch_no_data).toEqual([
			{ batch_no: "B-CACHED", batch_qty: 4 },
		]);
		expect(item.serial_no_data).toEqual([
			{ serial_no: "S-CACHED", batch_no: "B-CACHED" },
		]);
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
	});
});
