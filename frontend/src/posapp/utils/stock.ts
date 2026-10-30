/**
 * Utility functions for stock-related logic and message formatting.
 */

declare const __: any;

/**
 * Parses a value into a boolean based on standard Frappe/POS settings.
 * @param value The value to parse (string, number, or boolean)
 * @returns boolean
 */
export function parseBooleanSetting(value: any): boolean {
	if (value === undefined || value === null) {
		return false;
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		return ["1", "true", "yes", "on"].includes(normalized);
	}

	if (typeof value === "number") {
		return value === 1;
	}

	return Boolean(value);
}

export interface StockSalePolicyOptions {
	item: Record<string, any> | null | undefined;
	requestedQty?: unknown;
	availableQty?: unknown;
	posProfile?: Record<string, any> | null;
	stockSettings?: Record<string, any> | null;
	blockSaleBeyondAvailableQty?: unknown;
	isReturnInvoice?: boolean;
	deferStockValidationToPayment?: boolean;
}

/**
 * Returns whether the active stock policy blocks the requested sale quantity.
 * This is shared by Classic validation, Counter Grid alternates, scanner input,
 * and the final cart insertion guard so presentation cannot change stock rules.
 */
export function shouldBlockSaleForStock({
	item,
	requestedQty = 1,
	availableQty,
	posProfile,
	stockSettings,
	blockSaleBeyondAvailableQty,
	isReturnInvoice = false,
	deferStockValidationToPayment = false,
}: StockSalePolicyOptions): boolean {
	if (
		!item ||
		isReturnInvoice ||
		deferStockValidationToPayment ||
		!parseBooleanSetting(item.is_stock_item)
	) {
		return false;
	}

	const resolvedAvailableQty = Number(
		availableQty ?? item.actual_qty ?? item.available_qty ?? item.stock_qty,
	);
	if (!Number.isFinite(resolvedAvailableQty)) {
		return false;
	}

	if (
		resolvedAvailableQty === 0 &&
		parseBooleanSetting(posProfile?.posa_display_items_in_stock)
	) {
		return true;
	}

	const requested = Math.abs(Number(requestedQty));
	const normalizedRequestedQty =
		Number.isFinite(requested) && requested > 0 ? requested : 1;
	const blockBeyondAvailable = parseBooleanSetting(
		blockSaleBeyondAvailableQty ??
			posProfile?.posa_block_sale_beyond_available_qty,
	);
	const negativeStockAllowed =
		!blockBeyondAvailable &&
		(parseBooleanSetting(stockSettings?.allow_negative_stock) ||
			parseBooleanSetting(item.allow_negative_stock));

	return (
		!negativeStockAllowed && normalizedRequestedQty > resolvedAvailableQty
	);
}

/**
 * Formats a stock shortage error message.
 * @param itemName The name of the item
 * @param availableQty The quantity currently available
 * @param requestedQty The quantity requested by the user
 * @returns Formatted translated string
 */
export function formatStockShortageError(
	itemName: string | null,
	availableQty: number,
	requestedQty: number,
): string {
	const label = itemName || __("this item");
	const available = availableQty ?? 0;
	const requested = requestedQty ?? 0;

	return __(
		"{0} has only {1} in stock. You requested {2}. Adjust quantity or restock.",
		[label, available, requested],
	);
}

/**
 * Formats a negative stock warning message.
 * @param itemName The name of the item
 * @param availableQty The quantity currently available
 * @param requestedQty The quantity that would be added/removed
 * @returns Formatted translated string
 */
export function formatNegativeStockWarning(
	itemName: string | null,
	availableQty: number,
	requestedQty: number,
): string {
	const label = itemName || __("this item");
	const available = availableQty ?? 0;
	const requested = requestedQty ?? 0;

	return __(
		"Stock update: {0} has {1} available. Adding {2} will bring the stock below zero.",
		[label, available, requested],
	);
}
