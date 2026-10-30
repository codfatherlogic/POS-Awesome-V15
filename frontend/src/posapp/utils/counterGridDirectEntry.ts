export type CounterGridDirectEntryItem = Record<string, any> & {
	item_code?: string | null;
	stock_uom?: string | null;
};

export type CounterGridDirectEntryResolution =
	| {
			kind: "direct";
			item: CounterGridDirectEntryItem;
			matchType: "item-code" | "barcode";
	  }
	| {
			kind: "dialog";
			reason: "empty" | "not-found" | "ambiguous" | "selection-required";
			item?: CounterGridDirectEntryItem;
	  };

type CounterGridDirectEntryLookup = {
	getItemByCode: (
		query: string,
	) => CounterGridDirectEntryItem | null | undefined;
	getItemByBarcode: (
		query: string,
	) => CounterGridDirectEntryItem | null | undefined;
};

const enabled = (value: unknown) =>
	value === true ||
	value === 1 ||
	value === "1" ||
	String(value || "").toLowerCase() === "true";

const itemIdentity = (item: CounterGridDirectEntryItem | null | undefined) =>
	String(item?.item_code || item?.name || "").trim();

const matchedBarcodeUom = (item: CounterGridDirectEntryItem, query: string) => {
	const normalizedQuery = query.trim().toLowerCase();
	const barcodeRows = [
		...(Array.isArray(item.item_barcode) ? item.item_barcode : []),
		...(Array.isArray(item.barcodes) ? item.barcodes : []),
	];
	const row = barcodeRows.find((candidate: any) => {
		const value =
			typeof candidate === "string" ? candidate : candidate?.barcode;
		return (
			String(value || "")
				.trim()
				.toLowerCase() === normalizedQuery
		);
	});
	return typeof row === "object" && row ? String(row.uom || "").trim() : "";
};

export const counterGridItemNeedsSelection = (
	item: CounterGridDirectEntryItem,
	query: string,
	matchType: "item-code" | "barcode",
) => {
	if (
		enabled(item.has_variants) ||
		enabled(item.is_template) ||
		enabled(item.has_batch_no) ||
		enabled(item.has_serial_no)
	) {
		return true;
	}

	if (matchType !== "barcode") return false;
	const barcodeUom = matchedBarcodeUom(item, query);
	const stockUom = String(item.stock_uom || item.uom || "").trim();
	return Boolean(barcodeUom && stockUom && barcodeUom !== stockUom);
};

export function resolveCounterGridDirectEntry(
	rawQuery: unknown,
	lookup: CounterGridDirectEntryLookup,
): CounterGridDirectEntryResolution {
	const query = String(rawQuery || "").trim();
	if (!query) return { kind: "dialog", reason: "empty" };

	const codeItem = lookup.getItemByCode(query) || null;
	const barcodeItem = lookup.getItemByBarcode(query) || null;
	if (!codeItem && !barcodeItem) {
		return { kind: "dialog", reason: "not-found" };
	}

	if (
		codeItem &&
		barcodeItem &&
		itemIdentity(codeItem) !== itemIdentity(barcodeItem)
	) {
		return { kind: "dialog", reason: "ambiguous" };
	}

	const item = barcodeItem || codeItem;
	if (!item) return { kind: "dialog", reason: "not-found" };
	const matchType = barcodeItem ? "barcode" : "item-code";
	if (counterGridItemNeedsSelection(item, query, matchType)) {
		return { kind: "dialog", reason: "selection-required", item };
	}

	return { kind: "direct", item, matchType };
}
