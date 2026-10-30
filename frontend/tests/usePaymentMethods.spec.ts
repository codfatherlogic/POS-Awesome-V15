import { computed, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePaymentMethods } from "../src/posapp/composables/pos/payments/usePaymentMethods";

const getSmartTenderSuggestionsMock = vi.fn();

vi.mock("../src/utils/smartTender", () => ({
	getSmartTenderSuggestions: (...args: any[]) =>
		getSmartTenderSuggestionsMock(...args),
}));

describe("usePaymentMethods", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("discovers M-Pesa modes within the active POS Profile scope", () => {
		const call = vi.fn();
		vi.stubGlobal("frappe", { call });
		const posProfile = ref({ name: "Main POS", company: "Test Company" });
		const { get_mpesa_modes } = usePaymentMethods({
			invoiceDoc: ref({ payments: [] }),
			posProfile,
			diffPayment: computed(() => 0),
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		get_mpesa_modes();

		expect(call).toHaveBeenCalledWith(
			expect.objectContaining({
				args: {
					company: "Test Company",
					pos_profile: "Main POS",
				},
			}),
		);
	});

	it("sets the selected payment method to the post-credit outstanding amount", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			conversion_rate: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 250,
					base_amount: 250,
					default: 1,
				},
				{
					mode_of_payment: "Card",
					type: "Bank",
					amount: 0,
					base_amount: 0,
				},
			],
		});

		const { set_full_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		set_full_amount(invoiceDoc.value.payments[1]);

		expect(invoiceDoc.value.payments[0].amount).toBe(0);
		expect(invoiceDoc.value.payments[1].amount).toBe(250);
		expect(invoiceDoc.value.payments[1].base_amount).toBe(250);
	});

	it("fills only the remaining outstanding amount after redeemed credit and other payments", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			conversion_rate: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 100,
					base_amount: 100,
					default: 1,
				},
				{
					mode_of_payment: "Card",
					type: "Bank",
					amount: 0,
					base_amount: 0,
				},
			],
		});

		const { set_rest_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 150),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		set_rest_amount(invoiceDoc.value.payments[1]);

		expect(invoiceDoc.value.payments[1].amount).toBe(150);
		expect(invoiceDoc.value.payments[1].base_amount).toBe(150);
	});

	it("recalculates an existing unlocked payment amount when the cashier focuses it", () => {
		const invoiceDoc = ref<any>({
			currency: "USD",
			conversion_rate: 285,
			payments: [
				{ mode_of_payment: "Cash", amount: 0.11, posa_original_amount: 30 },
				{ mode_of_payment: "Online Transfer", amount: 0.32, posa_original_amount: 0.32 },
			],
		});
		const onPaymentInvoiceAmountChanged = vi.fn();
		const { set_rest_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({ currency: "PKR" }),
			getNetInvoiceAmount: () => 0.42,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
			onPaymentInvoiceAmountChanged,
		});

		set_rest_amount(invoiceDoc.value.payments[1]);

		expect(invoiceDoc.value.payments[1].amount).toBeCloseTo(0.31);
		expect(invoiceDoc.value.payments[1].posa_original_amount).toBe(0.32);
		expect(onPaymentInvoiceAmountChanged).toHaveBeenCalledWith(
			invoiceDoc.value.payments[1],
			0.31,
			undefined,
		);
	});

	it("uses the exact company-currency remainder for an auto-filled row", () => {
		const target: any = {
			mode_of_payment: "Online Transfer",
			amount: 0.315,
			base_amount: 89.775,
			posa_original_amount: 0.315,
		};
		const invoiceDoc = ref<any>({
			currency: "USD",
			conversion_rate: 285,
			base_rounded_total: 119.7,
			payments: [
				{ mode_of_payment: "Cash", amount: 0.105, base_amount: 30 },
				target,
			],
		});
		const onPaymentInvoiceAmountChanged = vi.fn();
		const { set_rest_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({ currency: "PKR" }),
			getNetInvoiceAmount: () => 0.42,
			getNetCompanyAmount: () => 119.7,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
			onPaymentInvoiceAmountChanged,
		});

		set_rest_amount(target);

		expect(target.amount).toBeCloseTo(0.315);
		expect(target.base_amount).toBeCloseTo(89.7);
		expect(onPaymentInvoiceAmountChanged).toHaveBeenCalledWith(
			target,
			0.315,
			89.7,
		);
	});

	it("marks auto remainder rows and respects the cashier lock", () => {
		const target: any = {
			mode_of_payment: "Online Transfer",
			amount: 0,
			base_amount: 0,
			posa_original_amount: 0,
		};
		const invoiceDoc = ref<any>({
			currency: "USD",
			conversion_rate: 285,
			payments: [{ mode_of_payment: "Cash", amount: 0.07, base_amount: 20 }, target],
		});
		const { set_rest_amount, toggle_remainder_lock } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({ currency: "PKR" }),
			getNetInvoiceAmount: () => 0.42,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		toggle_remainder_lock(target);
		set_rest_amount(target);
		expect(target.amount).toBe(0);
		expect(target._posa_auto_remainder).toBeUndefined();

		toggle_remainder_lock(target);
		set_rest_amount(target);
		expect(target.amount).toBe(0.35);
		expect(target._posa_auto_remainder).toBe(true);
	});

	it("fills base payment amount with the invoice conversion rate", () => {
		const invoiceDoc = ref<any>({
			currency: "USD",
			rounded_total: 100,
			grand_total: 100,
			conversion_rate: 280,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 0,
					base_amount: 0,
					default: 1,
				},
			],
		});

		const { set_full_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({ currency: "PKR" }),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 100,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		set_full_amount(invoiceDoc.value.payments[0]);

		expect(invoiceDoc.value.payments[0].amount).toBe(100);
		expect(invoiceDoc.value.payments[0].base_amount).toBe(28000);
	});

	it("does not set a negative remaining amount on regular sale overpayments", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 120,
			grand_total: 120,
			conversion_rate: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 0,
					base_amount: 0,
					default: 1,
				},
				{
					mode_of_payment: "Online Transfer",
					type: "Bank",
					amount: 150,
					base_amount: 150,
				},
			],
		});

		const { set_rest_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => -30),
			getNetInvoiceAmount: () => 120,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		set_rest_amount(invoiceDoc.value.payments[0], false);

		expect(invoiceDoc.value.payments[0].amount).toBe(0);
		expect(invoiceDoc.value.payments[0].base_amount).toBe(0);
		expect(invoiceDoc.value.payments[1].amount).toBe(150);
	});

	it("auto-balances against the net settlement amount instead of gross totals", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			conversion_rate: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 150,
					base_amount: 150,
					default: 1,
				},
				{
					mode_of_payment: "Card",
					type: "Bank",
					amount: 200,
					base_amount: 200,
				},
			],
		});

		const { autoBalancePayments } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		autoBalancePayments(invoiceDoc.value.payments[0]);

		expect(invoiceDoc.value.payments[1].amount).toBe(100);
		expect(invoiceDoc.value.payments[1].base_amount).toBe(100);
	});

	it("builds cash denomination suggestions from the net settlement amount", () => {
		getSmartTenderSuggestionsMock.mockReturnValue([200, 500]);

		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			currency: "PKR",
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 100,
					default: 1,
				},
				{
					mode_of_payment: "Card",
					type: "Bank",
					amount: 0,
				},
			],
		});

		const { getVisibleDenominations } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		const suggestions = getVisibleDenominations(invoiceDoc.value.payments[1]);

		expect(suggestions).toEqual([200, 500]);
		expect(getSmartTenderSuggestionsMock).toHaveBeenCalledWith(150, "PKR");
	});

	it("caps M-Pesa credit redemption against the net settlement amount", () => {
		const customerCreditDict = ref<any[]>([]);
		const redeemCustomerCredit = ref(false);

		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			payments: [],
		});

		const { set_mpesa_payment } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
			setRedeemCustomerCredit: (value) => {
				redeemCustomerCredit.value = value;
			},
			customerCreditDict,
		});

		set_mpesa_payment({
			name: "ACC-PAY-0001",
			unallocated_amount: 400,
		});

		expect(redeemCustomerCredit.value).toBe(true);
		expect(customerCreditDict.value).toEqual([
			expect.objectContaining({
				credit_origin: "ACC-PAY-0001",
				total_credit: 400,
				credit_to_redeem: 250,
			}),
		]);
	});
});
