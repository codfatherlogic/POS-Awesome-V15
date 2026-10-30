import { describe, expect, it } from "vitest";

import { resolveItemQuickEditCodeFromRows } from "../src/posapp/components/pos/invoice/itemQuickEditSelection";

describe("invoice item quick edit row selection", () => {
	it("uses the active keyboard grid item first", () => {
		const context = {
			$refs: {
				itemsTableRef: {
					getActiveGridItem: () => ({ item_code: "ACTIVE-ITEM" }),
					getSelectedGridItem: () => ({ item_code: "SELECTED-ITEM" }),
				},
			},
			items: [{ item_code: "LAST-ITEM" }],
		};

		expect(resolveItemQuickEditCodeFromRows(context.$refs.itemsTableRef, context.items)).toBe("ACTIVE-ITEM");
	});

	it("uses the remembered selected row before falling back to the last row", () => {
		const context = {
			$refs: {
				itemsTableRef: {
					getActiveGridItem: () => null,
					getSelectedGridItem: () => ({ item_code: "SELECTED-ITEM" }),
				},
			},
			items: [{ item_code: "FIRST-ITEM" }, { item_code: "LAST-ITEM" }],
		};

		expect(resolveItemQuickEditCodeFromRows(context.$refs.itemsTableRef, context.items)).toBe("SELECTED-ITEM");
	});
});
