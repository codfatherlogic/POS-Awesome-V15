import { ref } from "vue";
import {
	findItemIndexByCode,
	getNextHighlightedIndex,
} from "../../../utils/itemHighlight.js";

type SelectableItem = {
	item_code?: string | null;
	raw?: SelectableItem;
	item?: SelectableItem;
	[key: string]: unknown;
};

type FlyConfig = Record<string, unknown>;

type ItemSelectionContext = {
	items: SelectableItem[];
	displayedItems: SelectableItem[];
	addItem:
		| ((
				_item: SelectableItem,
				_options?: { postAddFocus?: "default" | "qty" },
		  ) => Promise<void> | void)
		| null;
	clearSearch: (() => void) | null;
	focusItemSearch: (() => void) | null;
	fly:
		| ((_source: Element, _target: Element, _config?: FlyConfig) => void)
		| null;
	flyConfig: FlyConfig | undefined;
	items_view: "card" | "list";
};

/**
 * useItemSelection
 *
 * Manages item list navigation (highlighting), selection via keyboard/mouse,
 * and interaction with the item list (e.g. clicking rows).
 */
export function useItemSelection() {
	// State
	const highlightedIndex = ref(-1);
	const highlightedItemCode = ref<string | null>(null);
	const resultNavigationActive = ref(false);
	const RESULT_PAGE_SIZE = 10;

	// Context (Late Binding)
	const ctx: ItemSelectionContext = {
		items: [], // Access to full items list (if needed)
		displayedItems: [], // The filtered/visible items
		addItem: null, // Method to add item to cart
		clearSearch: null,
		focusItemSearch: null,
		fly: null, // For animation
		flyConfig: undefined,
		items_view: "card", // "card" or "list"
	};

	function registerContext(context: Partial<ItemSelectionContext>) {
		if (!context || typeof context !== "object") {
			return;
		}

		Object.defineProperties(ctx, Object.getOwnPropertyDescriptors(context));
	}

	// --- Highlighting Logic ---

	function clearHighlightedItem() {
		highlightedIndex.value = -1;
		highlightedItemCode.value = null;
		resultNavigationActive.value = false;
	}

	function syncHighlightedItem() {
		if (
			!Array.isArray(ctx.displayedItems) ||
			ctx.displayedItems.length === 0
		) {
			clearHighlightedItem();
			return;
		}

		if (highlightedItemCode.value) {
			const index = findItemIndexByCode(
				ctx.displayedItems,
				highlightedItemCode.value,
			);
			if (index >= 0) {
				highlightedIndex.value = index;
				return;
			}
		}

		clearHighlightedItem();
	}

	function navigateHighlightedItem(direction: number) {
		if (
			!Array.isArray(ctx.displayedItems) ||
			ctx.displayedItems.length === 0
		) {
			clearHighlightedItem();
			return;
		}

		const nextIndex = getNextHighlightedIndex({
			currentIndex: highlightedIndex.value,
			itemsLength: ctx.displayedItems.length,
			direction,
		});

		if (nextIndex < 0) {
			clearHighlightedItem();
			return;
		}

		const nextItem = ctx.displayedItems[nextIndex];
		if (!nextItem) {
			clearHighlightedItem();
			return;
		}

		highlightedIndex.value = nextIndex;
		highlightedItemCode.value = nextItem.item_code || null;
		resultNavigationActive.value = true;
		// Scroll logic is watcher-driven in the component
	}

	function highlightItemAt(index: number, activateNavigation = true) {
		if (
			!Array.isArray(ctx.displayedItems) ||
			ctx.displayedItems.length === 0
		) {
			clearHighlightedItem();
			return false;
		}
		const nextIndex = Math.max(
			0,
			Math.min(index, ctx.displayedItems.length - 1),
		);
		const nextItem = ctx.displayedItems[nextIndex];
		if (!nextItem) return false;
		highlightedIndex.value = nextIndex;
		highlightedItemCode.value = nextItem.item_code || null;
		resultNavigationActive.value = activateNavigation;
		return true;
	}

	function activateResultNavigation() {
		resultNavigationActive.value = true;
		if (highlightedIndex.value < 0) highlightFirstItem();
	}

	function isResultNavigationBoundary(direction: number) {
		if (
			!Array.isArray(ctx.displayedItems) ||
			ctx.displayedItems.length === 0 ||
			(highlightedIndex.value < 0 && !highlightedItemCode.value)
		) {
			return false;
		}
		const codeIndex = highlightedItemCode.value
			? findItemIndexByCode(ctx.displayedItems, highlightedItemCode.value)
			: -1;
		const activeIndex = codeIndex >= 0 ? codeIndex : highlightedIndex.value;
		if (activeIndex < 0) return false;
		return direction > 0
			? activeIndex >= ctx.displayedItems.length - 1
			: activeIndex <= 0;
	}

	function highlightFirstItem() {
		if (
			!Array.isArray(ctx.displayedItems) ||
			ctx.displayedItems.length === 0
		) {
			clearHighlightedItem();
			return false;
		}

		const firstItem = ctx.displayedItems[0];
		if (!firstItem) {
			clearHighlightedItem();
			return false;
		}

		highlightedIndex.value = 0;
		highlightedItemCode.value = firstItem.item_code || null;
		return true;
	}

	function resolveHighlightedItem(item: unknown): SelectableItem | unknown {
		if (!item || typeof item !== "object") {
			return item;
		}
		const asItem = item as SelectableItem;
		if (asItem.raw) return asItem.raw;
		if (asItem.item) return asItem.item.raw || asItem.item;
		return item;
	}

	function isItemHighlighted(item: unknown) {
		const resolvedItem = resolveHighlightedItem(item);
		if (!resolvedItem || !highlightedItemCode.value) {
			return false;
		}
		return (
			(resolvedItem as SelectableItem).item_code ===
			highlightedItemCode.value
		);
	}

	function getItemRowClass(item: unknown) {
		return isItemHighlighted(item) ? "item-row-highlighted" : "";
	}

	function getItemRowProps(item: unknown) {
		const highlighted = isItemHighlighted(item);
		return {
			"aria-selected": highlighted ? "true" : "false",
			class: { "item-row-highlighted": highlighted },
		};
	}

	// --- Selection Logic ---

	async function selectHighlightedItem(
		options: { postAddFocus?: "default" | "qty" } = {},
	) {
		if (
			!Array.isArray(ctx.displayedItems) ||
			ctx.displayedItems.length === 0
		) {
			return;
		}

		const index = highlightedIndex.value;
		if (index < 0 || index >= ctx.displayedItems.length) {
			return;
		}

		const item = ctx.displayedItems[index];
		if (!item) {
			return;
		}

		if (ctx.addItem) {
			await ctx.addItem(item, options);
		}

		clearHighlightedItem();
		if (ctx.clearSearch) ctx.clearSearch();
		if (ctx.focusItemSearch) ctx.focusItemSearch();
	}

	function selectTopItem() {
		if (!ctx.displayedItems || !ctx.displayedItems.length) {
			return;
		}
		const firstItem = ctx.displayedItems[0];
		if (!firstItem) {
			return;
		}
		if (ctx.addItem) {
			ctx.addItem(firstItem);
		}
	}

	// --- Mouse Interaction ---

	function createCartTopAnchor(container: HTMLElement) {
		const rect = container.getBoundingClientRect();
		const anchor = document.createElement("div");
		anchor.className = "item-fly-target-anchor";
		anchor.style.position = "fixed";
		anchor.style.left = `${rect.left + rect.width / 2}px`;
		anchor.style.top = `${rect.top + 24}px`;
		anchor.style.width = "1px";
		anchor.style.height = "1px";
		anchor.style.pointerEvents = "none";
		anchor.style.opacity = "0";
		document.body.appendChild(anchor);
		return anchor;
	}

	function resolveFlyTarget() {
		const cartContainer = document.querySelector(
			".posa-items-table-container",
		) as HTMLElement | null;
		if (cartContainer) {
			const anchor = createCartTopAnchor(cartContainer);
			return {
				target: anchor,
				cleanup: () => anchor.remove(),
			};
		}

		const selectorContainer = document.querySelector(
			".items-table-container",
		) as HTMLElement | null;
		return {
			target: selectorContainer,
			cleanup: null as (() => void) | null,
		};
	}

	function triggerFlyAnimation(event: MouseEvent, isRow = false) {
		if (!ctx.fly) return;

		const { target, cleanup } = resolveFlyTarget();

		if (!target) return;

		let source: Element | null | undefined;
		if (isRow) {
			// For row click, we create a placeholder
			const placeholder = document.createElement("div");
			placeholder.className = "item-fly-placeholder";
			placeholder.style.width = "40px";
			placeholder.style.height = "40px";
			placeholder.style.borderRadius = "50%";
			placeholder.style.backgroundColor = "rgba(25, 118, 210, 0.22)";
			placeholder.style.boxShadow = "0 8px 18px rgba(0, 0, 0, 0.18)";
			placeholder.style.position = "fixed";
			placeholder.style.top = `${event.clientY - 20}px`;
			placeholder.style.left = `${event.clientX - 20}px`;
			document.body.appendChild(placeholder);

			ctx.fly(placeholder, target, ctx.flyConfig);

			placeholder.remove();
		} else {
			// For card click
			const currentTarget = event.currentTarget as Element | null;
			source =
				currentTarget?.querySelector?.(".card-item-image") ||
				currentTarget;
			if (source) {
				ctx.fly(source, target, ctx.flyConfig);
			}
		}
		cleanup?.();
	}

	function handleItemSelection(event: MouseEvent, item: SelectableItem) {
		triggerFlyAnimation(event, false);
		if (ctx.addItem) ctx.addItem(item);
	}

	async function handleRowClick(
		event: MouseEvent,
		{ item }: { item: SelectableItem },
	) {
		triggerFlyAnimation(event, true);
		if (ctx.addItem) await ctx.addItem(item);
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		if (!event) return;
		const key = event.key || "";

		if (key === "ArrowDown") {
			event.preventDefault();
			navigateHighlightedItem(1);
			return true; // handled
		}

		if (key === "ArrowUp") {
			event.preventDefault();
			navigateHighlightedItem(-1);
			return true; // handled
		}

		if (key === "PageDown" || key === "PageUp") {
			event.preventDefault();
			const direction = key === "PageDown" ? 1 : -1;
			const startIndex =
				highlightedIndex.value < 0 ? 0 : highlightedIndex.value;
			highlightItemAt(startIndex + direction * RESULT_PAGE_SIZE);
			return true;
		}

		if (resultNavigationActive.value && (key === "Home" || key === "End")) {
			event.preventDefault();
			highlightItemAt(key === "Home" ? 0 : ctx.displayedItems.length - 1);
			return true;
		}

		return false; // not handled
	}

	return {
		highlightedIndex,
		highlightedItemCode,
		resultNavigationActive,
		registerContext,
		clearHighlightedItem,
		syncHighlightedItem,
		navigateHighlightedItem,
		highlightFirstItem,
		highlightItemAt,
		activateResultNavigation,
		isResultNavigationBoundary,
		selectHighlightedItem,
		isItemHighlighted,
		getItemRowClass,
		getItemRowProps,
		selectTopItem,
		handleItemSelection,
		handleRowClick,
		handleSearchKeydown,
	};
}
