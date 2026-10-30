export const PHARMACY_ITEM_RESULTS_GRID_ID =
	"pharmacy-item-search-results-grid";

export const getPharmacyItemResultId = (itemCode: unknown) => {
	const normalized = String(itemCode || "").trim();
	if (!normalized) return "";

	const codePoints = Array.from(normalized, (character) =>
		character.codePointAt(0)?.toString(16),
	).filter(Boolean);
	return `pharmacy-item-result-${codePoints.join("-")}`;
};
