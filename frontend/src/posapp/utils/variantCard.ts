import { shouldBlockSaleForStock } from "./stock";

type VariantCardItem = Record<string, any> | null | undefined;

const normalizeBarcode = (value: unknown): string => {
	if (value && typeof value === "object" && "barcode" in value) {
		return String((value as { barcode?: unknown }).barcode ?? "").trim();
	}
	return String(value ?? "").trim();
};

/** Resolve the most relevant barcode for a variant's current/stock UOM. */
export function getVariantCardBarcode(item: VariantCardItem): string {
	if (!item) return "";

	const directBarcode = normalizeBarcode(item.barcode);
	if (directBarcode) return directBarcode;

	const barcodeRows = Array.isArray(item.item_barcode)
		? item.item_barcode
		: [];
	const preferredUom = String(item.uom || item.stock_uom || "").trim();
	if (preferredUom) {
		const matchingRow = barcodeRows.find(
			(row: any) =>
				String(row?.uom || "").trim() === preferredUom &&
				normalizeBarcode(row),
		);
		const matchingBarcode = normalizeBarcode(matchingRow);
		if (matchingBarcode) return matchingBarcode;
	}

	for (const row of barcodeRows) {
		const barcode = normalizeBarcode(row);
		if (barcode) return barcode;
	}

	if (Array.isArray(item.barcodes)) {
		for (const row of item.barcodes) {
			const barcode = normalizeBarcode(row);
			if (barcode) return barcode;
		}
	}

	return "";
}

/** Return warehouse availability when present without treating missing cache data as zero. */
export function getVariantCardAvailableQty(
	item: VariantCardItem,
): number | null {
	if (!item) return null;

	for (const value of [item.available_qty, item.actual_qty, item.stock_qty]) {
		if (value === null || value === undefined || value === "") continue;
		const quantity = Number(value);
		if (Number.isFinite(quantity)) return quantity;
	}

	return null;
}

/** Keep popup selection aligned with the shared cart stock policy. */
export function isVariantCardUnavailable(
	item: VariantCardItem,
	posProfile: Record<string, any> | null | undefined,
	stockSettings: Record<string, any> | null | undefined,
): boolean {
	const availableQty = getVariantCardAvailableQty(item);
	if (availableQty === null) return false;

	return shouldBlockSaleForStock({
		item,
		requestedQty: 1,
		availableQty,
		posProfile,
		stockSettings,
	});
}
