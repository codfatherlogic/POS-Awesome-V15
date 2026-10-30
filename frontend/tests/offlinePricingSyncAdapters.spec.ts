import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
	itemPriceRepository: {
		clear: vi.fn().mockResolvedValue(undefined),
		upsertMany: vi.fn().mockResolvedValue(undefined),
		deleteByNames: vi.fn().mockResolvedValue(undefined),
		deleteOutsidePriceLists: vi.fn().mockResolvedValue(undefined),
	},
	pricingRuleRepository: {
		clear: vi.fn().mockResolvedValue(undefined),
		replaceRuleTargets: vi.fn().mockResolvedValue(undefined),
		deleteByRuleNames: vi.fn().mockResolvedValue(undefined),
		getAll: vi.fn().mockResolvedValue([]),
	},
}));

const cacheMocks = vi.hoisted(() => ({
	savePricingRulesSnapshot: vi.fn(),
	setProfileBuyingPriceList: vi.fn().mockResolvedValue(undefined),
}));

const commonMocks = vi.hoisted(() => ({
	buildResourceSyncResult: vi.fn(
		(resourceId, status, response, watermark) => ({
			resourceId,
			status,
			response,
			watermark: response?.next_watermark || watermark || null,
		}),
	),
	persistResourceSyncState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/offline/repositories", () => repositoryMocks);
vi.mock("../src/offline/cache", () => cacheMocks);
vi.mock("../src/offline/sync/adapters/common", async () => {
	const actual = await vi.importActual<any>(
		"../src/offline/sync/adapters/common",
	);
	return {
		...actual,
		...commonMocks,
	};
});

import { syncItemPricesResource } from "../src/offline/sync/adapters/itemPrices";
import { syncPricingRulesResource } from "../src/offline/sync/adapters/pricingRules";

describe("offline pricing sync adapters", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("loads every Item Price page before committing the final watermark", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce({
				changes: [
					{
						key: "item_price::IP-1",
						data: { name: "IP-1", item_code: "ITEM-1" },
					},
				],
				deleted: [],
				has_more: true,
				next_offset: 1,
				next_watermark: null,
				scope: {
					price_lists: ["Retail", "Export", "Standard Buying"],
					buying_price_list: "Standard Buying",
				},
			})
			.mockResolvedValueOnce({
				changes: [
					{
						key: "item_price::IP-2",
						data: { name: "IP-2", item_code: "ITEM-2" },
					},
				],
				deleted: [{ key: "item_price::IP-OLD" }],
				has_more: false,
				next_offset: null,
				next_watermark: "2026-06-01T10:00:00",
			});

		const result = await syncItemPricesResource({
			posProfile: { name: "POS-1", company: "Test Co" },
			watermark: null,
			fetcher,
		});

		expect(
			repositoryMocks.itemPriceRepository.clear,
		).toHaveBeenCalledOnce();
		expect(
			repositoryMocks.itemPriceRepository.upsertMany,
		).toHaveBeenCalledTimes(2);
		expect(
			repositoryMocks.itemPriceRepository.deleteByNames,
		).toHaveBeenCalledWith(["IP-OLD"]);
		expect(
			repositoryMocks.itemPriceRepository.deleteOutsidePriceLists,
		).toHaveBeenCalledWith(["Retail", "Export", "Standard Buying"]);
		expect(cacheMocks.setProfileBuyingPriceList).toHaveBeenCalledWith(
			expect.objectContaining({ name: "POS-1" }),
			"Standard Buying",
		);
		expect(fetcher).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ offset: 1, watermark: null }),
		);
		expect(result.watermark).toBe("2026-06-01T10:00:00");
	});

	it("recovers a later Item Price page with a missing next_offset from its row count", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce({
				changes: Array.from({ length: 500 }, (_, index) => ({
					key: `item_price::IP-${index}`,
					data: {
						name: `IP-${index}`,
						item_code: `ITEM-${index}`,
						price_list: "Retail",
					},
				})),
				deleted: [],
				has_more: true,
				next_offset: 500,
				schema_version: "2026-07-17",
			})
			.mockResolvedValueOnce({
				changes: [
					{
						key: "item_price::IP-500",
						data: {
							name: "IP-500",
							item_code: "ITEM-500",
							price_list: "Retail",
						},
					},
				],
				deleted: [],
				has_more: true,
				next_offset: null,
				schema_version: "2026-07-17",
			})
			.mockResolvedValueOnce({
				changes: [],
				deleted: [],
				has_more: false,
				next_offset: null,
				next_watermark: "2026-07-20T10:00:00",
				schema_version: "2026-07-17",
			});
		vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await syncItemPricesResource({
			posProfile: { name: "POS-1", company: "Test Co" },
			watermark: null,
			fetcher,
		});

		expect(fetcher).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ offset: 501 }),
		);
		expect(result.status).toBe("fresh");
		expect(commonMocks.persistResourceSyncState).toHaveBeenLastCalledWith(
			expect.objectContaining({
				resourceId: "item_prices",
				status: "fresh",
			}),
		);
	});

	it("logs exact pagination diagnostics before rejecting an empty invalid page", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const fetcher = vi.fn().mockResolvedValue({
			changes: [],
			deleted: [],
			has_more: true,
			next_offset: 500,
			schema_version: "2026-07-17",
		});

		await expect(
			syncItemPricesResource({
				posProfile: { name: "POS-1", company: "Test Co" },
				watermark: "2026-07-19T00:00:00",
				fetcher,
			}),
		).rejects.toThrow(
			"page 2 (offset=500, next_offset=500, has_more=true, changes=0)",
		);
		expect(consoleError).toHaveBeenLastCalledWith(
			"Item Price sync received an invalid pagination cursor",
			expect.objectContaining({
				page: 2,
				offset: 500,
				nextOffset: 500,
				hasMore: true,
				changesCount: 0,
			}),
		);
	});

	it("replaces all targets for changed Pricing Rule parents and deletes tombstones", async () => {
		repositoryMocks.pricingRuleRepository.getAll.mockResolvedValueOnce([
			{
				key: "RULE-1::item_group::Products",
				rule_name: "RULE-1",
				target_type: "item_group",
				target_value: "Products",
			},
		]);
		const fetcher = vi.fn().mockResolvedValue({
			changes: [
				{
					key: "pricing_rule::RULE-1::item_group::Products",
					data: {
						key: "RULE-1::item_group::Products",
						rule_name: "RULE-1",
						target_type: "item_group",
						target_value: "Products",
					},
				},
			],
			deleted: [{ key: "pricing_rule::RULE-OLD" }],
			has_more: false,
			next_watermark: "2026-06-01T11:00:00",
		});

		await syncPricingRulesResource({
			posProfile: {
				name: "POS-1",
				company: "Test Co",
				selling_price_list: "Standard Selling",
				currency: "PKR",
			},
			watermark: "2026-05-01T00:00:00",
			fetcher,
		});

		expect(
			repositoryMocks.pricingRuleRepository.replaceRuleTargets,
		).toHaveBeenCalledWith([
			expect.objectContaining({ rule_name: "RULE-1" }),
		]);
		expect(
			repositoryMocks.pricingRuleRepository.deleteByRuleNames,
		).toHaveBeenCalledWith(["RULE-OLD"]);
		expect(cacheMocks.savePricingRulesSnapshot).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					rule_name: "RULE-1",
					target_type: "item_group",
				}),
			],
			expect.stringContaining('"price_list":"Standard Selling"'),
		);
	});
});
