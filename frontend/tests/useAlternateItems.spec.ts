import { describe, expect, it, vi } from "vitest";

import { ApiEnvelopeError } from "../src/posapp/services/api";
import { useAlternateItems } from "../src/posapp/composables/pos/items/useAlternateItems";
import type { AlternateItemsResponse } from "../src/posapp/services/itemService";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function responseFor(itemCode: string): AlternateItemsResponse {
	return {
		requested_item: {
			item_code: itemCode,
			item_name: `Requested ${itemCode}`,
			generic_field: "retailmind_old_pos_generic_code",
			generic: "GEN-1",
		},
		context: {
			pos_profile: "Main POS",
			company: "RetailMind",
			warehouse: "Main Warehouse",
			price_list: "Standard Selling",
			currency: "PKR",
			requested_qty: 1,
		},
		profit_display_allowed: false,
		items: [
			{
				item_code: `ALT-${itemCode}`,
				item_name: `Alternate ${itemCode}`,
				item_group: "Medicines",
				generic_code: "GEN-1",
				generic_name: "Paracetamol",
				pack: "10S",
				company: "GSK",
				company_code: "10",
				rack: "R-1",
				stock_uom: "Nos",
				uom: "Nos",
				units_per_pack: 10,
				available_qty: 25,
				pack_stock: 2,
				loose_stock: 5,
				rate: 15,
				retail_price: 15,
				currency: "PKR",
				has_batch_no: 0,
				has_serial_no: 0,
				can_fulfill_requested_qty: true,
				replacement_reason: "same_generic_in_stock",
				profit_display_allowed: false,
			},
		],
		reason: null,
		candidate_metadata_ttl_seconds: 60,
		candidate_pool_truncated: false,
		stock_cached: false,
	};
}

describe("useAlternateItems", () => {
	it("exposes loading and the exact successful response as result state", async () => {
		const pending = deferred<AlternateItemsResponse>();
		const request = vi.fn(() => pending.promise);
		const state = useAlternateItems({ request });

		const loadPromise = state.load({
			item_code: "REQ-1",
			pos_profile: "Main POS",
		});
		expect(state.loading.value).toBe(true);
		expect(state.items.value).toEqual([]);

		const response = responseFor("REQ-1");
		pending.resolve(response);
		await expect(loadPromise).resolves.toBe(response);

		expect(state.loading.value).toBe(false);
		expect(state.response.value).toBe(response);
		expect(state.items.value).toBe(response.items);
		expect(state.hasItems.value).toBe(true);
		expect(state.profitDisplayAllowed.value).toBe(false);
		expect(state.error.value).toBeNull();
	});

	it("aborts superseded work and ignores a stale response that resolves late", async () => {
		const first = deferred<AlternateItemsResponse>();
		const second = deferred<AlternateItemsResponse>();
		const signals: AbortSignal[] = [];
		const request = vi.fn((args, signal?: AbortSignal) => {
			signals.push(signal as AbortSignal);
			return args.item_code === "REQ-1" ? first.promise : second.promise;
		});
		const state = useAlternateItems({ request });

		const firstLoad = state.load({ item_code: "REQ-1" });
		const secondLoad = state.load({ item_code: "REQ-2" });
		expect(signals[0].aborted).toBe(true);
		expect(signals[1].aborted).toBe(false);

		const currentResponse = responseFor("REQ-2");
		second.resolve(currentResponse);
		await expect(secondLoad).resolves.toBe(currentResponse);

		first.resolve(responseFor("REQ-1"));
		await expect(firstLoad).resolves.toBeNull();
		expect(state.response.value).toBe(currentResponse);
		expect(state.items.value[0]?.item_code).toBe("ALT-REQ-2");
	});

	it("normalizes API errors without leaking a rejected promise to the UI", async () => {
		const apiError = new ApiEnvelopeError<AlternateItemsResponse>({
			ok: false,
			data: null,
			error: {
				code: "BUSINESS_RULE",
				message: "Terminal is locked",
				retryable: false,
			},
			requestId: "alternate-error-1",
			serverTime: null,
		});
		const state = useAlternateItems({
			request: vi.fn().mockRejectedValue(apiError),
		});

		await expect(state.load({ item_code: "REQ-1" })).resolves.toBeNull();
		expect(state.loading.value).toBe(false);
		expect(state.response.value).toBeNull();
		expect(state.error.value).toEqual({
			code: "BUSINESS_RULE",
			message: "Terminal is locked",
			retryable: false,
		});
	});

	it("clear aborts work and removes all item-specific state", async () => {
		const pending = deferred<AlternateItemsResponse>();
		let signal: AbortSignal | undefined;
		const state = useAlternateItems({
			request: vi.fn((_args, requestSignal) => {
				signal = requestSignal;
				return pending.promise;
			}),
		});
		const loadPromise = state.load({ item_code: "REQ-1" });

		state.clear();
		expect(signal?.aborted).toBe(true);
		expect(state.loading.value).toBe(false);
		expect(state.lastArgs.value).toBeNull();
		expect(state.response.value).toBeNull();
		expect(state.error.value).toBeNull();

		pending.resolve(responseFor("REQ-1"));
		await expect(loadPromise).resolves.toBeNull();
		expect(state.response.value).toBeNull();
	});
});
