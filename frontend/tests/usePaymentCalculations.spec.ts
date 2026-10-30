import { describe, expect, it } from "vitest";
import { ref } from "vue";

import { usePaymentCalculations } from "../src/posapp/composables/pos/payments/usePaymentCalculations";

describe("usePaymentCalculations", () => {
	it("keeps split overpayments as change instead of capping total paid to the invoice total", () => {
		const invoiceDoc = ref<any>({
			currency: "PKR",
			rounded_total: 100,
			grand_total: 100,
			payments: [
				{ mode_of_payment: "Cash", type: "Cash", amount: 80 },
				{ mode_of_payment: "Card", type: "Bank", amount: 50 },
			],
		});

		const calculations = usePaymentCalculations({
			invoiceDoc,
			posProfile: ref({ currency: "PKR", posa_allow_multi_currency: 0 }),
			currencyPrecision: ref(2),
			loyaltyAmount: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			customerInfo: ref({}),
			giftCardRedemptions: ref([]),
			formatCurrency: (value) => String(value),
		});

		expect(calculations.total_payments.value).toBe(130);
		expect(calculations.diff_payment.value).toBe(-30);
		expect(calculations.change_due.value).toBe(30);
	});

	it("uses the rounded invoice total for foreign-currency settlement", () => {
		const invoiceDoc = ref<any>({
			currency: "USD",
			grand_total: 0.425,
			rounded_total: 0.42,
			payments: [{ amount: 0.42 }],
		});
		const calculations = usePaymentCalculations({
			invoiceDoc,
			posProfile: ref({
				currency: "PKR",
				posa_allow_multi_currency: 1,
			}),
			currencyPrecision: ref(2),
			loyaltyAmount: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			customerInfo: ref({}),
			formatCurrency: (value) => String(value),
		});

		expect(calculations.total_payments.value).toBe(0.42);
		expect(calculations.diff_payment.value).toBe(0);
		expect(calculations.change_due.value).toBe(0);
	});

	it("surfaces a base-currency residual hidden by invoice-currency precision", () => {
		const invoiceDoc = ref<any>({
			currency: "USD",
			conversion_rate: 285,
			rounded_total: 0.42,
			grand_total: 0.42,
			base_rounded_total: 119.7,
			base_grand_total: 119.7,
			payments: [
				{ amount: 0.07, base_amount: 20 },
				{ amount: 0.35, base_amount: 99.75 },
			],
		});
		const calculations = usePaymentCalculations({
			invoiceDoc,
			posProfile: ref({ currency: "PKR", posa_allow_multi_currency: 1 }),
			currencyPrecision: ref(2),
			loyaltyAmount: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			customerInfo: ref({}),
			giftCardRedemptions: ref([]),
			formatCurrency: (value) => String(value),
		});

		expect(calculations.diff_payment.value).toBe(0);
		expect(calculations.base_settlement.value).toMatchObject({
			target: 119.7,
			paid: 119.75,
			difference: -0.05,
			change: 0.05,
		});
	});
});
