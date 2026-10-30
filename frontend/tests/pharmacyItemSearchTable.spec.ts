// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PharmacyItemSearchTable from "../src/posapp/components/pos/items/PharmacyItemSearchTable.vue";

const VDataTableVirtualStub = defineComponent({
	name: "VDataTableVirtual",
	emits: ["keydown"],
	props: {
		items: { type: Array, default: () => [] },
		rowProps: { type: [Object, Function], default: null },
		headers: { type: Array, default: () => [] },
	},
	setup(props, { attrs, emit }) {
		return () =>
			h(
				"table",
				{
					...attrs,
					class: "pharmacy-results-table",
					onKeydown: (event: KeyboardEvent) => emit("keydown", event),
				},
				[
					h(
						"tbody",
						props.items.map((item: any, index: number) => {
							const rowData = {
								index,
								item: { raw: item },
								internalItem: { raw: item },
							};
							const attrs =
								typeof props.rowProps === "function"
									? props.rowProps(rowData)
									: props.rowProps || {};
							return h("tr", attrs, [h("td", item.item_name)]);
						}),
					),
				],
			);
	},
});

const VBtnStub = defineComponent({
	name: "VBtn",
	inheritAttrs: false,
	emits: ["click"],
	setup(_props, { attrs, emit, slots }) {
		return () =>
			h(
				"button",
				{ ...attrs, onClick: () => emit("click") },
				slots.default?.(),
			);
	},
});

const items = [
	{ item_code: "02017", item_name: "ARINAC FORT", actual_qty: 4 },
	{ item_code: "A3106", item_name: "PANADOL CF", actual_qty: 7 },
	{ item_code: "22203", item_name: "PANADOL DROP", actual_qty: 0 },
];

const mountTable = (
	overrides: Record<string, unknown> = {},
	attachTo?: HTMLElement,
) =>
	mount(PharmacyItemSearchTable, {
		attachTo,
		props: {
			displayedItems: items.slice(0, 2),
			searchTerm: "panadol",
			highlightedItemCode: "02017",
			currencySymbol: () => "Rs",
			formatCurrency: (value: unknown) => String(value ?? ""),
			formatNumber: (value: unknown) => String(value ?? ""),
			ratePrecision: () => 2,
			rowProps: (rowData: any) => ({
				"aria-selected":
					rowData?.item?.raw?.item_code === "A3106"
						? "true"
						: "false",
				class: {
					"item-row-highlighted":
						rowData?.item?.raw?.item_code === "A3106",
				},
			}),
			...overrides,
		},
		global: {
			components: {
				VDataTableVirtual: VDataTableVirtualStub,
				VBtn: VBtnStub,
			},
			stubs: {
				VSelect: true,
				"v-select": true,
				VSwitch: true,
				"v-switch": true,
				VIcon: true,
				"v-icon": true,
			},
		},
	});

const row = (wrapper: ReturnType<typeof mountTable>, itemCode: string) =>
	wrapper.get(`[data-item-code="${itemCode}"]`);

describe("PharmacyItemSearchTable active result", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string) => value);
	});

	it("overrides stale Vuetify row metadata so exactly the requested first row is active", async () => {
		const wrapper = mountTable();
		await flushPromises();

		expect(wrapper.findAll('tr[aria-selected="true"]')).toHaveLength(1);
		expect(row(wrapper, "02017").attributes("aria-selected")).toBe("true");
		expect(row(wrapper, "02017").classes()).toContain(
			"item-row-highlighted",
		);
		expect(row(wrapper, "A3106").attributes("aria-selected")).toBe("false");
		expect(row(wrapper, "A3106").classes()).not.toContain(
			"item-row-highlighted",
		);
	});

	it("moves the sole active state only after keyboard navigation changes the item code", async () => {
		const wrapper = mountTable();
		await wrapper.setProps({ highlightedItemCode: "A3106" });
		await flushPromises();

		expect(wrapper.findAll('tr[aria-selected="true"]')).toHaveLength(1);
		expect(row(wrapper, "02017").attributes("aria-selected")).toBe("false");
		expect(row(wrapper, "A3106").attributes("aria-selected")).toBe("true");
		expect(row(wrapper, "A3106").classes()).toContain(
			"item-row-highlighted",
		);
	});

	it("emits a terminal boundary before table handlers can trap focus on the last result", async () => {
		const onNavigationBoundary = vi.fn();
		const onNavigationKey = vi.fn();
		const wrapper = mountTable({
			highlightedItemCode: "A3106",
			onNavigationBoundary,
			onNavigationKey,
		});
		await flushPromises();
		const downstreamKeydown = vi.fn();
		wrapper
			.get("table")
			.element.addEventListener("keydown", downstreamKeydown);
		const event = new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		});

		row(wrapper, "A3106").element.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		expect(onNavigationBoundary).toHaveBeenCalledOnce();
		expect(onNavigationKey).not.toHaveBeenCalled();
		expect(downstreamKeydown).not.toHaveBeenCalled();
	});

	it("keeps ordinary result navigation inside the table before the boundary", async () => {
		const onNavigationBoundary = vi.fn();
		const onNavigationKey = vi.fn();
		const wrapper = mountTable({
			highlightedItemCode: "02017",
			onNavigationBoundary,
			onNavigationKey,
		});
		await flushPromises();
		const event = new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		});

		row(wrapper, "02017").element.dispatchEvent(event);

		expect(onNavigationKey).toHaveBeenCalledOnce();
		expect(onNavigationBoundary).not.toHaveBeenCalled();
	});

	it("keeps a stable focus target while virtual Home and End navigation rerenders rows", async () => {
		const onNavigationKey = vi.fn();
		const wrapper = mountTable({ onNavigationKey }, document.body);
		await flushPromises();
		row(wrapper, "02017").element.focus();
		const event = new KeyboardEvent("keydown", {
			key: "End",
			bubbles: true,
			cancelable: true,
		});

		row(wrapper, "02017").element.dispatchEvent(event);

		expect(onNavigationKey).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(
			wrapper.get(".pharmacy-results-keyboard-boundary").element,
		);
		wrapper.unmount();
	});

	it("keeps the first visible row active after field and zero-stock filter rerenders", async () => {
		const wrapper = mountTable();

		await wrapper.setProps({
			displayedItems: items.slice(1),
			searchField: "generic",
			highlightedItemCode: "A3106",
		});
		await flushPromises();
		expect(wrapper.findAll('tr[aria-selected="true"]')).toHaveLength(1);
		expect(row(wrapper, "A3106").attributes("aria-selected")).toBe("true");

		await wrapper.setProps({
			displayedItems: [items[2]!, items[1]!],
			includeZeroStock: true,
			highlightedItemCode: "22203",
		});
		await flushPromises();
		expect(wrapper.findAll('tr[aria-selected="true"]')).toHaveLength(1);
		expect(row(wrapper, "22203").attributes("aria-selected")).toBe("true");
		expect(row(wrapper, "A3106").attributes("aria-selected")).toBe("false");
	});

	it("links stable result identity, virtual row indices, and active announcements", async () => {
		const wrapper = mountTable();
		await flushPromises();

		const grid = wrapper.get("#pharmacy-item-search-results-grid");
		expect(grid.attributes()).toMatchObject({
			"aria-label": "Item search results",
		});
		expect(row(wrapper, "02017").attributes()).toMatchObject({
			id: "pharmacy-item-result-30-32-30-31-37",
			role: "row",
			tabindex: "-1",
			"aria-rowindex": "2",
		});
		expect(row(wrapper, "A3106").attributes("aria-rowindex")).toBe("3");
		expect(
			wrapper.get('[data-testid="pharmacy-search-announcement"]').text(),
		).toContain("1 of 2, ARINAC FORT, code 02017");

		await wrapper.setProps({ displayedItems: [], highlightedItemCode: "" });
		await flushPromises();
		expect(
			wrapper.get('[data-testid="pharmacy-search-announcement"]').text(),
		).toBe("No matching items for panadol");
	});

	it("renders alternate context, empty reasons, back navigation, and authorized profit columns", async () => {
		const wrapper = mountTable({
			mode: "alternates",
			displayedItems: [],
			searchTerm: "",
			highlightedItemCode: "",
			alternateRequestedItem: {
				item_code: "02050",
				item_name: "COFCOL",
				generic: "PARACETAMOL",
			},
			alternateReason: "missing_generic",
			allowAlternateBack: true,
		});
		await flushPromises();
		expect(wrapper.props("allowAlternateBack")).toBe(true);

		const alternateContext = wrapper
			.get('[data-testid="alternate-items-context"]')
			.text();
		expect(alternateContext).toContain("COFCOL");
		expect(alternateContext).toContain("PARACETAMOL");
		expect(
			wrapper.get('[data-testid="alternate-items-empty"]').text(),
		).toContain("This item has no generic mapping.");
		expect(wrapper.findAllComponents({ name: "VSelect" })).toHaveLength(0);
		expect(
			wrapper.get('[aria-label="Back to item search results"]').exists(),
		).toBe(true);

		await wrapper.setProps({
			displayedItems: [
				{
					item_code: "ALT-1",
					item_name: "Alternate",
					available_qty: 4,
					profit_display_allowed: true,
					profit_amount: 12,
				},
			],
			alternateReason: "",
			highlightedItemCode: "ALT-1",
		});
		await flushPromises();
		const headerKeys = wrapper
			.findComponent(VDataTableVirtualStub)
			.props("headers")
			.map((header: any) => header.key);
		expect(headerKeys).toContain("profit");
	});
});
