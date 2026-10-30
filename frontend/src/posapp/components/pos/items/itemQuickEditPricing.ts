const roundTo = (value: number, precision = 2) => {
	const factor = 10 ** precision;
	return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const toNullableNumber = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : null;
};

export const calculateTradeDiscountPercent = (
	retailPrice: unknown,
	tradePrice: unknown,
): number | null => {
	const retail = toNullableNumber(retailPrice);
	const trade = toNullableNumber(tradePrice);
	if (retail === null || retail <= 0 || trade === null) {
		return null;
	}
	return roundTo(((retail - trade) / retail) * 100);
};

export const calculateTradePriceFromDiscount = (
	retailPrice: unknown,
	discountPercent: unknown,
): number | null => {
	const retail = toNullableNumber(retailPrice);
	const discount = toNullableNumber(discountPercent);
	if (retail === null || discount === null) {
		return null;
	}
	return roundTo(Math.max(retail * (1 - discount / 100), 0));
};
