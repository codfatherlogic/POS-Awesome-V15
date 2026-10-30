import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiEnvelope } from "../src/posapp/services/api";
import type { AlternateItemsResponse } from "../src/posapp/services/itemService";

vi.mock("../src/posapp/services/api", () => ({
	default: {
		callEnvelope: vi.fn(),
	},
	unwrapApiResult: vi.fn((result: any) => {
		if (result?.ok) return result.data;
		if (result?.ok === false) throw new Error(result.error?.message);
		return result;
	}),
}));

import api from "../src/posapp/services/api";
import itemService from "../src/posapp/services/itemService";

const response: AlternateItemsResponse = {
	requested_item: {
		item_code: "REQ-1",
		item_name: "Requested",
		generic_field: "retailmind_old_pos_generic_code",
		generic: "GEN-1",
	},
	context: {
		pos_profile: "Main POS",
		company: "RetailMind",
		warehouse: "Main Warehouse",
		price_list: "Standard Selling",
		currency: "PKR",
		requested_qty: 2,
	},
	profit_display_allowed: false,
	items: [],
	reason: "no_in_stock_priced_alternates",
	candidate_metadata_ttl_seconds: 60,
	candidate_pool_truncated: false,
	stock_cached: false,
};

const envelope: ApiEnvelope<AlternateItemsResponse> = {
	ok: true,
	data: response,
	error: null,
	requestId: "alternate-1",
	serverTime: null,
};

describe("itemService alternate items API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(api.callEnvelope).mockResolvedValue(envelope as never);
	});

	it("calls the canonical backend method with sale scope and an abort signal", async () => {
		const controller = new AbortController();
		const args = {
			item_code: "REQ-1",
			pos_profile: "Main POS",
			warehouse: "Main Warehouse",
			price_list: "Standard Selling",
			company: "RetailMind",
			customer: "Customer 1",
			qty: 2,
			limit: 20,
		};

		await expect(
			itemService.getAlternateItems(args, controller.signal),
		).resolves.toBe(envelope);
		expect(api.callEnvelope).toHaveBeenCalledWith(
			"posawesome.posawesome.api.items.get_alternate_items",
			args,
			{ signal: controller.signal },
		);
	});

	it("unwraps the backend response without renaming contract fields", async () => {
		await expect(
			itemService.getAlternateItemsData({
				item_code: "REQ-1",
				pos_profile: "Main POS",
			}),
		).resolves.toBe(response);

		expect(response).toMatchObject({
			requested_item: { item_code: "REQ-1" },
			profit_display_allowed: false,
			candidate_metadata_ttl_seconds: 60,
			candidate_pool_truncated: false,
			stock_cached: false,
		});
	});
});
