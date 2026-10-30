import { describe, expect, it } from "vitest";

import { shouldBlockSaleForStock } from "../src/posapp/utils/stock";

const stockItem = (overrides: Record<string, any> = {}) => ({
	item_code: "ITEM-001",
	is_stock_item: 1,
	actual_qty: -2,
	...overrides,
});

describe("shared stock sale policy", () => {
	it("allows negative stock when ERPNext or the item grants permission", () => {
		expect(
			shouldBlockSaleForStock({
				item: stockItem(),
				requestedQty: 1,
				stockSettings: { allow_negative_stock: 1 },
			}),
		).toBe(false);
		expect(
			shouldBlockSaleForStock({
				item: stockItem({ allow_negative_stock: 1 }),
				requestedQty: 1,
			}),
		).toBe(false);
	});

	it("blocks shortages when negative stock is disabled or POS Profile forces blocking", () => {
		expect(
			shouldBlockSaleForStock({
				item: stockItem(),
				requestedQty: 1,
			}),
		).toBe(true);
		expect(
			shouldBlockSaleForStock({
				item: stockItem({ allow_negative_stock: 1 }),
				requestedQty: 1,
				stockSettings: { allow_negative_stock: 1 },
				posProfile: { posa_block_sale_beyond_available_qty: 1 },
			}),
		).toBe(true);
	});

	it("preserves return, non-stock, and deferred document behavior", () => {
		for (const options of [
			{ item: stockItem(), isReturnInvoice: true },
			{ item: stockItem({ is_stock_item: 0 }) },
			{ item: stockItem(), deferStockValidationToPayment: true },
		]) {
			expect(
				shouldBlockSaleForStock({
					requestedQty: 1,
					...options,
				}),
			).toBe(false);
		}
	});

	it("keeps the POS Profile in-stock-only rule authoritative for zero stock", () => {
		expect(
			shouldBlockSaleForStock({
				item: stockItem({ actual_qty: 0 }),
				requestedQty: 1,
				stockSettings: { allow_negative_stock: 1 },
				posProfile: { posa_display_items_in_stock: 1 },
			}),
		).toBe(true);
	});
});
