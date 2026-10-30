import { describe, expect, it } from "vitest";

import {
	calculateTradeDiscountPercent,
	calculateTradePriceFromDiscount,
	toNullableNumber,
} from "../src/posapp/components/pos/items/itemQuickEditPricing";

describe("item quick edit pricing", () => {
	it("calculates the trade discount percentage from retail and trade prices", () => {
		expect(calculateTradeDiscountPercent(1000, 850)).toBe(15);
		expect(calculateTradeDiscountPercent(15, 12.75)).toBe(15);
	});

	it("calculates trade price from retail price and discount percentage", () => {
		expect(calculateTradePriceFromDiscount(1000, 15)).toBe(850);
		expect(calculateTradePriceFromDiscount(15, 15)).toBe(12.75);
	});

	it("normalizes empty and invalid numeric input", () => {
		expect(toNullableNumber("")).toBeNull();
		expect(toNullableNumber("not-a-number")).toBeNull();
		expect(toNullableNumber("12.75")).toBe(12.75);
	});
});
