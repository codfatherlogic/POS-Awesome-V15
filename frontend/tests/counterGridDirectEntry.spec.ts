import { describe, expect, it, vi } from "vitest";

import {
	counterGridItemNeedsSelection,
	resolveCounterGridDirectEntry,
} from "../src/posapp/utils/counterGridDirectEntry";

const lookup = (codeItem: any = null, barcodeItem: any = null) => ({
	getItemByCode: vi.fn(() => codeItem),
	getItemByBarcode: vi.fn(() => barcodeItem),
});

describe("Counter Grid direct entry", () => {
	it("resolves an exact item code for the direct cart path", () => {
		const item = { item_code: "02017", stock_uom: "Nos" };
		expect(resolveCounterGridDirectEntry(" 02017 ", lookup(item))).toEqual({
			kind: "direct",
			item,
			matchType: "item-code",
		});
	});

	it("prefers a unique exact barcode match", () => {
		const item = {
			item_code: "ITEM-1",
			stock_uom: "Nos",
			barcode: "12345",
		};
		expect(
			resolveCounterGridDirectEntry("12345", lookup(null, item)),
		).toEqual({
			kind: "direct",
			item,
			matchType: "barcode",
		});
	});

	it("keeps ambiguous item-code and barcode matches in the search dialog", () => {
		const result = resolveCounterGridDirectEntry(
			"12345",
			lookup({ item_code: "12345" }, { item_code: "OTHER" }),
		);
		expect(result).toEqual({ kind: "dialog", reason: "ambiguous" });
	});

	it.each([
		[{ item_code: "TEMPLATE", has_variants: 1 }, "item-code"],
		[{ item_code: "BATCH", has_batch_no: true }, "item-code"],
		[{ item_code: "SERIAL", has_serial_no: "1" }, "item-code"],
	])(
		"requires the established selection flow for special items",
		(item, matchType) => {
			expect(
				counterGridItemNeedsSelection(
					item,
					item.item_code,
					matchType as any,
				),
			).toBe(true);
		},
	);

	it("requires review when a barcode selects a non-stock UOM", () => {
		const item = {
			item_code: "PACKED",
			stock_uom: "Nos",
			item_barcode: [{ barcode: "PACK-12", uom: "Box" }],
		};
		expect(counterGridItemNeedsSelection(item, "PACK-12", "barcode")).toBe(
			true,
		);
	});

	it("falls back for empty and unknown queries", () => {
		expect(resolveCounterGridDirectEntry("", lookup())).toEqual({
			kind: "dialog",
			reason: "empty",
		});
		expect(resolveCounterGridDirectEntry("unknown", lookup())).toEqual({
			kind: "dialog",
			reason: "not-found",
		});
	});
});
