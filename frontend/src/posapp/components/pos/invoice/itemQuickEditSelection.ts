type CartItemLike = {
	item_code?: string;
	[key: string]: unknown;
};

type ItemsTableRefLike = {
	getActiveGridItem?: () => CartItemLike | null | undefined;
	getSelectedGridItem?: () => CartItemLike | null | undefined;
};

export const resolveItemQuickEditCodeFromRows = (
	itemsTableRef: ItemsTableRefLike | null | undefined,
	items: CartItemLike[] | null | undefined,
) => {
	const activeGridItem = itemsTableRef?.getActiveGridItem?.();
	if (activeGridItem?.item_code) {
		return activeGridItem.item_code;
	}
	const selectedGridItem = itemsTableRef?.getSelectedGridItem?.();
	if (selectedGridItem?.item_code) {
		return selectedGridItem.item_code;
	}
	const rows = Array.isArray(items) ? items : [];
	return rows.length ? rows[rows.length - 1]?.item_code || "" : "";
};
