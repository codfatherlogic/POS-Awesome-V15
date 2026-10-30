type ItemSelectionLike = {
	highlightedIndex?: { value: number };
	isItemHighlighted?: (_candidate: unknown) => boolean;
	getItemRowProps?: (_item: unknown) => Record<string, unknown>;
};

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
	Boolean(candidate && typeof candidate === "object");

const resolveSelectorRowItem = (
	candidate: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null => {
	if (!candidate) {
		return null;
	}
	if (candidate.item_code) {
		return candidate;
	}
	for (const key of ["raw", "item", "internalItem"]) {
		const nested = candidate[key];
		if (isRecord(nested)) {
			const resolved = resolveSelectorRowItem(nested);
			if (resolved) {
				return resolved;
			}
		}
	}
	return candidate;
};

export const createItemHighlightMatcher = (
	itemSelection: ItemSelectionLike,
) => {
	return (candidate: unknown) => {
		if (typeof candidate === "number") {
			return itemSelection?.highlightedIndex?.value === candidate;
		}
		return itemSelection?.isItemHighlighted?.(candidate) || false;
	};
};

export const buildSelectorRowProps = (
	itemSelection: ItemSelectionLike,
	item: Record<string, unknown> | null | undefined,
) => {
	const resolvedItem = resolveSelectorRowItem(item);
	const itemCode = String(resolvedItem?.item_code || "");
	const highlightProps = itemSelection?.getItemRowProps?.(resolvedItem) || {};
	return {
		...highlightProps,
		"data-item-code": itemCode,
		"data-testid": itemCode ? `pos-item-row-${itemCode}` : "pos-item-row",
		"data-pos-keyboard-target": "item-row",
		draggable: true,
		role: "button",
		tabindex: 0,
	};
};
