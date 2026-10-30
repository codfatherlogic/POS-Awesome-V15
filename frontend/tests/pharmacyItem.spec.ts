import { describe, expect, it } from "vitest";

import {
	cleanPharmacyText,
	filterPharmacySearchItems,
	pharmacySearchFieldValue,
	projectPackLooseStock,
	resolvePackLabel,
} from "../src/posapp/utils/pharmacyItem";

describe("pharmacy item projections", () => {
	it("removes legacy control characters and sentinel values", () => {
		expect(cleanPharmacyText(" Rack\u0000 A-12\n")).toBe("Rack A-12");
		expect(cleanPharmacyText("N/A")).toBe("");
	});

	it("uses the legacy pack label before units-per-pack fallback", () => {
		expect(
			resolvePackLabel({
				retailmind_old_pos_pack: "100'S",
				retailmind_units_per_pack: 20,
			}),
		).toBe("100'S");
		expect(
			resolvePackLabel({
				retailmind_units_per_pack: 20,
				stock_uom: "Nos",
			}),
		).toBe("20 Nos");
	});

	it("derives whole packs and loose Nos only from authoritative compatible stock", () => {
		expect(
			projectPackLooseStock({
				actual_qty: 121,
				stock_uom: "Nos",
				retailmind_units_per_pack: 20,
			}),
		).toEqual({
			canSplit: true,
			packQty: 6,
			looseQty: 1,
			availableQty: 121,
			uom: "Nos",
		});
		expect(
			projectPackLooseStock({
				actual_qty: -2,
				stock_uom: "Nos",
				retailmind_units_per_pack: 20,
			}),
		).toEqual({
			canSplit: false,
			packQty: null,
			looseQty: null,
			availableQty: -2,
			uom: "Nos",
		});
	});

	it("builds field-specific searchable pharmacy text", () => {
		const item = {
			item_code: "AI167",
			item_name: "PANADOL TAB 500MG",
			brand: "GSK",
			retailmind_old_pos_generic_name: "PARACETAMOL",
		};
		expect(pharmacySearchFieldValue(item, "generic")).toBe("paracetamol");
		expect(pharmacySearchFieldValue(item, "all")).toContain(
			"panadol tab 500mg",
		);
	});

	it("uses one visible result set for field and zero-stock filters", () => {
		const items = [
			{
				item_code: "IN-STOCK",
				brand: "GSK",
				is_stock_item: 1,
				actual_qty: 4,
			},
			{
				item_code: "ZERO-STOCK",
				brand: "GSK",
				is_stock_item: 1,
				actual_qty: 0,
			},
			{
				item_code: "SERVICE",
				brand: "OTHER",
				is_stock_item: 0,
				actual_qty: 0,
			},
		];

		expect(
			filterPharmacySearchItems(items, {
				searchTerm: "gsk",
				searchField: "company",
			}),
		).toEqual([items[0]]);
		expect(
			filterPharmacySearchItems(items, {
				searchTerm: "gsk",
				searchField: "company",
				includeZeroStock: true,
			}),
		).toEqual([items[0], items[1]]);
	});
});
