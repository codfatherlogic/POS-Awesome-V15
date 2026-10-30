// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { useItemSelection } from "../src/posapp/composables/pos/items/useItemSelection";

describe("useItemSelection fly animation", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("marks exactly the highlighted row as selected", () => {
		const itemSelection = useItemSelection();
		itemSelection.registerContext({
			displayedItems: [
				{ item_code: "ITEM-001" },
				{ item_code: "ITEM-002" },
			],
		});

		itemSelection.navigateHighlightedItem(1);

		expect(
			itemSelection.getItemRowProps({ item_code: "ITEM-001" }),
		).toEqual({
			"aria-selected": "true",
			class: { "item-row-highlighted": true },
		});
		expect(
			itemSelection.getItemRowProps({ item_code: "ITEM-002" }),
		).toEqual({
			"aria-selected": "false",
			class: { "item-row-highlighted": false },
		});
	});

	it("highlights the first result without selecting it", () => {
		const addItem = vi.fn();
		const itemSelection = useItemSelection();
		itemSelection.registerContext({
			displayedItems: [
				{ item_code: "ITEM-001" },
				{ item_code: "ITEM-002" },
			],
			addItem,
		});

		expect(itemSelection.highlightFirstItem()).toBe(true);
		expect(itemSelection.highlightedIndex.value).toBe(0);
		expect(itemSelection.highlightedItemCode.value).toBe("ITEM-001");
		expect(addItem).not.toHaveBeenCalled();
	});

	it("supports bounded arrows, paging, and result-mode Home and End", () => {
		const itemSelection = useItemSelection();
		itemSelection.registerContext({
			displayedItems: Array.from({ length: 25 }, (_, index) => ({
				item_code: `ITEM-${String(index + 1).padStart(3, "0")}`,
			})),
		});
		itemSelection.highlightFirstItem();

		const nativeHome = new KeyboardEvent("keydown", {
			key: "Home",
			cancelable: true,
		});
		expect(itemSelection.handleSearchKeydown(nativeHome)).toBe(false);
		expect(nativeHome.defaultPrevented).toBe(false);

		itemSelection.handleSearchKeydown(
			new KeyboardEvent("keydown", {
				key: "ArrowDown",
				cancelable: true,
			}),
		);
		expect(itemSelection.highlightedIndex.value).toBe(1);

		itemSelection.handleSearchKeydown(
			new KeyboardEvent("keydown", { key: "End", cancelable: true }),
		);
		expect(itemSelection.highlightedIndex.value).toBe(24);

		itemSelection.handleSearchKeydown(
			new KeyboardEvent("keydown", { key: "PageUp", cancelable: true }),
		);
		expect(itemSelection.highlightedIndex.value).toBe(14);

		itemSelection.handleSearchKeydown(
			new KeyboardEvent("keydown", { key: "Home", cancelable: true }),
		);
		expect(itemSelection.highlightedIndex.value).toBe(0);

		itemSelection.handleSearchKeydown(
			new KeyboardEvent("keydown", { key: "PageDown", cancelable: true }),
		);
		expect(itemSelection.highlightedIndex.value).toBe(10);
	});

	it("reports both result boundaries so row focus can return to search", () => {
		const itemSelection = useItemSelection();
		itemSelection.registerContext({
			displayedItems: [
				{ item_code: "ITEM-001" },
				{ item_code: "ITEM-002" },
			],
		});

		itemSelection.highlightFirstItem();
		expect(itemSelection.isResultNavigationBoundary(-1)).toBe(true);
		expect(itemSelection.isResultNavigationBoundary(1)).toBe(false);

		itemSelection.navigateHighlightedItem(1);
		expect(itemSelection.isResultNavigationBoundary(-1)).toBe(false);
		expect(itemSelection.isResultNavigationBoundary(1)).toBe(true);

		itemSelection.highlightedIndex.value = 0;
		itemSelection.highlightedItemCode.value = "ITEM-002";
		expect(itemSelection.isResultNavigationBoundary(1)).toBe(true);

		itemSelection.clearHighlightedItem();
		expect(itemSelection.isResultNavigationBoundary(1)).toBe(false);
	});

	it("passes the requested post-add focus through the existing item-add path", async () => {
		const addItem = vi.fn();
		const itemSelection = useItemSelection();
		itemSelection.registerContext({
			displayedItems: [{ item_code: "ITEM-001" }],
			addItem,
		});
		itemSelection.highlightFirstItem();

		await itemSelection.selectHighlightedItem({ postAddFocus: "qty" });

		expect(addItem).toHaveBeenCalledWith(
			{ item_code: "ITEM-001" },
			{ postAddFocus: "qty" },
		);
	});

	it("targets the cart top-center anchor instead of the selector-side table", async () => {
		const selectorTable = document.createElement("div");
		selectorTable.className = "items-table-container";
		document.body.appendChild(selectorTable);
		const cartTable = document.createElement("div");
		cartTable.className = "posa-items-table-container";
		vi.spyOn(cartTable, "getBoundingClientRect").mockReturnValue({
			left: 300,
			top: 80,
			width: 420,
			height: 320,
			right: 720,
			bottom: 400,
			x: 300,
			y: 80,
			toJSON: () => ({}),
		});
		cartTable.innerHTML = `
			<table class="posa-cart-table">
				<tbody>
					<tr data-test="cart-top-row"><td>Top row</td></tr>
				</tbody>
			</table>
		`;
		document.body.appendChild(cartTable);
		const fly = vi.fn();
		const addItem = vi.fn();
		const itemSelection = useItemSelection();
		itemSelection.registerContext({
			addItem,
			fly,
			flyConfig: { speed: 0.6 },
		});

		await itemSelection.handleRowClick(
			new MouseEvent("click", {
				clientX: 120,
				clientY: 160,
			}),
			{ item: { item_code: "ITEM-001" } },
		);

		const source = fly.mock.calls[0]?.[0] as HTMLElement | undefined;
		const target = fly.mock.calls[0]?.[1] as HTMLElement | undefined;

		expect(source?.className).toBe("item-fly-placeholder");
		expect(source?.style.backgroundColor).toBeTruthy();
		expect(target?.className).toBe("item-fly-target-anchor");
		expect(target?.style.left).toBe("510px");
		expect(target?.style.top).toBe("104px");
		expect(target).not.toBe(selectorTable);
		expect(fly).toHaveBeenCalledWith(source, target, { speed: 0.6 });
		expect(document.body.contains(source as Node)).toBe(false);
		expect(document.body.contains(target as Node)).toBe(false);
		expect(addItem).toHaveBeenCalledWith({ item_code: "ITEM-001" });
	});

	it("animates card clicks toward the cart when the selector table is not rendered", () => {
		const cartTable = document.createElement("div");
		cartTable.className = "posa-items-table-container";
		vi.spyOn(cartTable, "getBoundingClientRect").mockReturnValue({
			left: 300,
			top: 80,
			width: 420,
			height: 320,
			right: 720,
			bottom: 400,
			x: 300,
			y: 80,
			toJSON: () => ({}),
		});
		cartTable.innerHTML = `
			<table class="posa-cart-table">
				<tbody>
					<tr data-test="cart-top-row"><td>Top row</td></tr>
				</tbody>
			</table>
		`;
		document.body.appendChild(cartTable);
		const card = document.createElement("button");
		card.className = "card-item-card";
		const image = document.createElement("div");
		image.className = "card-item-image";
		card.appendChild(image);
		document.body.appendChild(card);
		const fly = vi.fn();
		const addItem = vi.fn();
		const itemSelection = useItemSelection();
		itemSelection.registerContext({
			addItem,
			fly,
			flyConfig: { speed: 0.6 },
		});
		const event = new MouseEvent("click");
		Object.defineProperty(event, "currentTarget", {
			value: card,
		});

		itemSelection.handleItemSelection(event, { item_code: "ITEM-002" });

		expect(fly).toHaveBeenCalledWith(
			image,
			expect.objectContaining({
				className: "item-fly-target-anchor",
			}),
			{ speed: 0.6 },
		);
		expect(addItem).toHaveBeenCalledWith({ item_code: "ITEM-002" });
	});
});
