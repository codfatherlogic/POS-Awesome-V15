// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import CartItemRow from "../src/posapp/components/pos/invoice/CartItemRow.vue";
import { normalizeCartEditQuantity } from "../src/posapp/utils/cartQuantity";

const VTextFieldStub = defineComponent({
	name: "VTextField",
	props: {
		modelValue: { type: [String, Number], default: "" },
		disabled: { type: Boolean, default: false },
		type: { type: String, default: "text" },
	},
	emits: ["update:modelValue", "keydown"],
	setup(props, { attrs, emit }) {
		const callAttr = (name: string, ...args: unknown[]) => {
			const handler = attrs[name] as
				| ((...handlerArgs: unknown[]) => void)
				| Array<(...handlerArgs: unknown[]) => void>
				| undefined;
			if (Array.isArray(handler)) {
				handler.forEach((entry) => entry(...args));
				return;
			}
			handler?.(...args);
		};

		return () =>
			h("input", {
				...attrs,
				type: props.type,
				value: props.modelValue,
				disabled: props.disabled,
				onInput: (event: Event) => {
					const value = (event.target as HTMLInputElement).value;
					emit("update:modelValue", value);
					callAttr("onUpdate:modelValue", value);
				},
				onFocus: (event: FocusEvent) => callAttr("onFocus", event),
				onBlur: (event: FocusEvent) => callAttr("onBlur", event),
				onKeydown: (event: KeyboardEvent) => {
					emit("keydown", event);
					callAttr("onKeydown", event);
				},
			});
	},
});

const mountRow = (
	itemOverrides: Record<string, unknown> = {},
	propsOverrides: Record<string, unknown> = {},
) =>
	mount(CartItemRow, {
		props: {
			item: {
				item_code: "ITEM-001",
				item_name: "Test Item",
				qty: 1,
				rate: 10,
				discount_percentage: 0,
				discount_amount: 0,
				price_list_rate: 10,
				item_uoms: [{ uom: "Nos" }],
				uom: "Nos",
				...itemOverrides,
			},
			visibleColumns: [{ key: "qty" }],
			posProfile: { posa_allow_user_to_edit_item_discount: true },
			formatFloat: (value: unknown) => String(value ?? ""),
			formatCurrency: (value: unknown) => String(value ?? ""),
			currencySymbol: () => "Rs",
			isNumber: () => true,
			isNegative: (value: unknown) => Number(value) < 0,
			rowIndex: 0,
			...propsOverrides,
		},
		global: {
			components: {
				"v-text-field": VTextFieldStub,
				VTextField: VTextFieldStub,
			},
			stubs: {
				"v-btn": true,
				VBtn: true,
				"v-icon": true,
				VIcon: true,
				"v-select": true,
				VSelect: true,
				"v-chip": true,
				VChip: true,
			},
		},
	});

describe("CartItemRow keyboard editing", () => {
	it("submits quantity on Enter even when the value matches the current quantity", async () => {
		vi.stubGlobal("__", (value: string) => value);
		const onQtyEditSubmitted = vi.fn();
		const wrapper = mountRow({ qty: 1 }, { onQtyEditSubmitted });
		const input = wrapper.get('input[inputmode="decimal"]');

		await input.trigger("focus");
		await input.setValue("1");
		await input.trigger("keydown", { key: "Enter" });

		expect(wrapper.emitted("update-qty")).toBeUndefined();
		expect(onQtyEditSubmitted).toHaveBeenCalled();
	});

	it("keeps the existing quantity visible when the quantity input receives focus", async () => {
		vi.stubGlobal("__", (value: string) => value);
		const wrapper = mountRow({ qty: 2 });
		const input = wrapper.get<HTMLInputElement>(
			'input[inputmode="decimal"]',
		);

		expect(input.element.value).toBe("2");
		await input.trigger("focus");

		expect(input.element.value).toBe("2");
	});

	it("preserves the quantity magnitude when editing a return row", () => {
		expect(normalizeCartEditQuantity("-2", true)).toBe(-2);
		expect(normalizeCartEditQuantity("2", true)).toBe(-2);
		expect(normalizeCartEditQuantity("0", true)).toBe(-1);
	});

	it("renders safely while the POS Profile is not loaded", () => {
		vi.stubGlobal("__", (value: string) => value);

		expect(() =>
			mountRow(
				{},
				{
					posProfile: null,
					visibleColumns: [
						{ key: "rate" },
						{ key: "discount_percentage" },
					],
				},
			),
		).not.toThrow();
	});

	it("skips UOM as an editable stop when only one UOM is available", () => {
		vi.stubGlobal("__", (value: string) => value);
		const wrapper = mountRow({}, { visibleColumns: [{ key: "uom" }] });
		const display = wrapper.get(".uom-editor .posa-cart-table__editor-display");

		expect(display.attributes("tabindex")).toBe("-1");
		expect(display.attributes("aria-disabled")).toBe("true");
		expect(display.attributes("data-pos-keyboard-target")).toBeUndefined();
	});

	it("skips replacement UOM while keeping multi-UOM sale rows editable", () => {
		vi.stubGlobal("__", (value: string) => value);
		const uoms = [{ uom: "Nos" }, { uom: "Box" }];
		const replacement = mountRow(
			{ item_uoms: uoms, posa_is_replace: 1 },
			{ visibleColumns: [{ key: "uom" }] },
		);
		const regular = mountRow(
			{ item_uoms: uoms },
			{ visibleColumns: [{ key: "uom" }] },
		);

		expect(
			replacement
				.get(".uom-editor .posa-cart-table__editor-display")
				.attributes("aria-disabled"),
		).toBe("true");
		expect(
			regular
				.get(".uom-editor .posa-cart-table__editor-display")
				.attributes("data-pos-keyboard-target"),
		).toBe("cart-uom");
	});

	it("opens discount percentage editing with the current value populated", async () => {
		vi.stubGlobal("__", (value: string) => value);
		const wrapper = mountRow(
			{ discount_percentage: 2, discount_amount: 0, price_list_rate: 10 },
			{ visibleColumns: [{ key: "discount_percentage" }] },
		);

		await wrapper
			.get('[data-pos-keyboard-target="cart-discount-percent"]')
			.trigger("click");
		await wrapper.vm.$nextTick();

		expect(
			wrapper.get<HTMLInputElement>('input[inputmode="decimal"]').element
				.value,
		).toBe("2");
	});

	it("replaces the existing quantity with the first typed value", async () => {
		vi.stubGlobal("__", (value: string) => value);
		const wrapper = mountRow({ qty: 2 });
		const input = wrapper.get<HTMLInputElement>(
			'input[inputmode="decimal"]',
		);

		await input.trigger("focus");
		await input.trigger("keydown", { key: "5" });

		expect(input.element.value).toBe("");
	});

	it("renders cart numeric editors without browser number widgets or autocomplete", async () => {
		vi.stubGlobal("__", (value: string) => value);
		const wrapper = mountRow(
			{ discount_percentage: 2, discount_amount: 0, price_list_rate: 10 },
			{ visibleColumns: [{ key: "discount_percentage" }] },
		);

		await wrapper
			.get('[data-pos-keyboard-target="cart-discount-percent"]')
			.trigger("click");
		await wrapper.vm.$nextTick();

		const input = wrapper.get<HTMLInputElement>(
			'input[inputmode="decimal"]',
		);
		expect(input.attributes("type")).toBe("text");
		expect(input.attributes("autocomplete")).toBe("off");
		expect(input.attributes("autocorrect")).toBe("off");
		expect(input.attributes("autocapitalize")).toBe("off");
		expect(input.attributes("spellcheck")).toBe("false");
	});

	it("marks the row when the effective rate is below trade price", () => {
		vi.stubGlobal("__", (value: string) => value);
		const wrapper = mountRow({
			rate: 10,
			trade_price: 12.75,
		});

		expect(wrapper.classes()).toContain("posa-cart-item-row--loss-risk");
	});
});
