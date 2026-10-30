// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/composables/core/useRtl", () => ({
	useRtl: () => ({
		isRtl: false,
		rtlStyles: {},
		rtlClasses: [],
	}),
}));

import PayTotalsSidebar from "../src/posapp/components/pos_pay/PayTotalsSidebar.vue";

const BoxStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", {}, slots.default?.());
	},
});

const VSwitchStub = defineComponent({
	name: "VSwitchStub",
	props: {
		modelValue: {
			type: Boolean,
			default: undefined,
		},
		label: {
			type: String,
			default: "",
		},
	},
	emits: ["update:modelValue"],
	setup(props, { attrs, emit }) {
		return () =>
			h("label", {}, [
				h("input", {
					type: "checkbox",
					checked: props.modelValue ?? true,
					"data-test": attrs["data-test"],
					"aria-label": props.label,
					onInput: (event: Event) =>
						emit("update:modelValue", (event.target as HTMLInputElement).checked),
				}),
				props.label,
			]);
	},
});

const VTextFieldStub = defineComponent({
	name: "VTextFieldStub",
	props: {
		modelValue: {
			type: [String, Number],
			default: "",
		},
		label: {
			type: String,
			default: "",
		},
	},
	emits: ["update:modelValue"],
	setup(props, { attrs, emit }) {
		return () =>
			h("input", {
				value: props.modelValue,
				"data-test": attrs["data-test"],
				"aria-label": props.label,
				readonly: attrs.readonly,
				onInput: (event: Event) =>
					emit("update:modelValue", (event.target as HTMLInputElement).value),
			});
	},
});

const VSelectStub = defineComponent({
	name: "VSelectStub",
	props: {
		modelValue: {
			type: [String, Number],
			default: "",
		},
		items: {
			type: Array,
			default: () => [],
		},
		label: {
			type: String,
			default: "",
		},
	},
	emits: ["update:modelValue"],
	setup(props, { attrs, emit }) {
		return () =>
			h(
				"select",
				{
					value: props.modelValue,
					"data-test": attrs["data-test"],
					"aria-label": props.label,
					onChange: (event: Event) =>
						emit("update:modelValue", (event.target as HTMLSelectElement).value),
				},
				(props.items as Array<any>).map((item) => {
					const value = typeof item === "object" ? item.value : item;
					const title = typeof item === "object" ? item.title : item;
					return h("option", { value }, String(title));
				}),
			);
	},
});

const VueDatePickerStub = defineComponent({
	name: "VueDatePickerStub",
	props: {
		modelValue: {
			type: String,
			default: "",
		},
		placeholder: {
			type: String,
			default: "",
		},
	},
	emits: ["update:modelValue"],
	setup(props, { attrs, emit }) {
		return () =>
			h("input", {
				value: props.modelValue,
				"data-test": attrs["data-test"],
				"aria-label": props.placeholder || attrs["aria-label"] || "",
				onInput: (event: Event) =>
					emit("update:modelValue", (event.target as HTMLInputElement).value),
			});
	},
});

const mountSidebar = (props: Record<string, unknown> = {}) =>
	mount(PayTotalsSidebar, {
		props: {
			posProfile: {
				posa_allow_make_new_payments: 1,
			},
			totalSelectedInvoices: 0,
			selectedInvoicesCount: 0,
			totalSelectedPayments: 0,
			totalSelectedMpesa: 0,
			paymentMethods: [],
			filteredPaymentMethods: [],
			invoiceTotalCurrency: "USD",
			paymentTotalCurrency: "USD",
			mpesaTotalCurrency: "USD",
			companyCurrency: "USD",
			exchangeRate: 1,
			exchangeRateLoading: false,
			exchangeRateError: "",
			requiresExchangeRate: false,
			totalOfDiff: 0,
			referenceNo: "",
			referenceDate: "",
			currencySymbol: () => "$",
			formatCurrency: (value: number) => String(value),
			getPaymentMethodCurrency: () => "USD",
			...props,
		},
		global: {
			components: {
				VRow: BoxStub,
				VCol: BoxStub,
				VDivider: BoxStub,
				VTextField: VTextFieldStub,
				VSelect: VSelectStub,
				VBtn: BoxStub,
				VIcon: BoxStub,
				VSwitch: VSwitchStub,
			},
			stubs: {
				VueDatePicker: VueDatePickerStub,
			},
			config: {
				globalProperties: {
					__: (value: string) => value,
				},
			},
		},
	});

describe("PayTotalsSidebar", () => {
	beforeEach(() => {
		(globalThis as any).__ = (value: string) => value;
	});

	it("shows the auto allocate toggle enabled by default with english helper text", () => {
		const wrapper = mountSidebar();

		const toggle = wrapper.get('input[data-test="auto-allocate-payment-toggle"]');
		expect((toggle.element as HTMLInputElement).checked).toBe(true);
		expect(wrapper.text()).toContain("Auto Allocate Payment Amount");
		expect(wrapper.text()).toContain(
			"Unselected payments stay unallocated first, then auto reconcile after submit.",
		);
	});

	it("normalizes a typed reference date to backend format", () => {
		const wrapper = mountSidebar();

		wrapper.get('[data-test="reference-date-input"]');
		const normalized = (
			wrapper.vm as unknown as { updateReferenceDate: (_value: string) => void }
		).updateReferenceDate("03-04-2026");

		expect(normalized).toBe("2026-04-03");
	});

	it("offers every allowed tender currency even when the payment account uses one currency", async () => {
		const payment = {
			mode_of_payment: "Cash",
			amount: 0,
			row_id: "MOP-CASH",
			payment_currency: "PKR",
			bank_account: "Cash PKR - TC",
		};
		const wrapper = mountSidebar({
			posProfile: {
				posa_allow_make_new_payments: 1,
			},
			paymentMethods: [payment],
			filteredPaymentMethods: [payment],
			allowPaymentCurrencySelection: true,
			allowedPaymentCurrencies: ["PKR", "USD"],
			availableBankAccounts: {
				Cash: [
					{
						account: "Cash PKR - TC",
						account_currency: "PKR",
						account_type: "Cash",
					},
				],
			},
			getPaymentMethodCurrency: () => "PKR",
		});

		await wrapper.get('select[aria-label="Mode of Payment"]').setValue("Cash");

		const currencySelector = wrapper.get(
			'select[data-test="payment-tender-currency"]',
		);
		expect(currencySelector.findAll("option").map((option) => option.text())).toEqual([
			"PKR",
			"USD",
		]);
	});
});
