import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/services/exchangeRateResolver", () => ({
	convertCurrencyAmount: (amount: number, rate: number) => amount * rate,
	resolveExchangeRate: vi.fn(async ({ fromCurrency, toCurrency }) => ({
		found: true,
		fromCurrency,
		toCurrency,
		rate: fromCurrency === toCurrency ? 1 : 285,
		effectiveDate: "2026-08-21",
		rateDate: "2026-08-21",
		source: fromCurrency === toCurrency ? "same_currency" : "currency_exchange",
	})),
}));

import { usePaymentCurrencies } from "../src/posapp/composables/pos/payments/usePaymentCurrencies";

describe("usePaymentCurrencies", () => {
	it("replaces a stale initialized amount with the Alt shortcut tender", async () => {
		const invoiceDoc = ref<any>({
			currency: "PKR",
			company: "Farooq Chemicals",
			posting_date: "2026-08-21",
			payments: [],
		});
		const payment: any = {
			amount: 120,
			base_amount: 120,
			posa_payment_currency: "PKR",
			posa_original_amount: 120,
			posa_company_exchange_rate: 1,
		};
		invoiceDoc.value.payments = [payment];
		const { setInvoiceEquivalent } = usePaymentCurrencies({
			invoiceDoc,
			posProfile: ref({
				name: "POS-PROFILE-1",
				company: "Farooq Chemicals",
				currency: "PKR",
				company_currency: "PKR",
			}),
			currencyPrecision: ref(2),
			formatFloat: (value) => Number(Number(value || 0).toFixed(2)),
		});

		payment.amount = 150;
		const result = await setInvoiceEquivalent(payment, payment.amount);

		expect(result).toBe(true);
		expect(payment.amount).toBe(150);
		expect(payment.posa_original_amount).toBe(150);
		expect(payment.base_amount).toBe(150);
	});

	it("preserves an exact tender remainder while rounding invoice and base fields normally", async () => {
		const invoiceDoc = ref<any>({
			currency: "USD",
			company: "Farooq Chemicals",
			posting_date: "2026-08-21",
		});
		const payment: any = {
			posa_payment_currency: "USD",
			posa_original_amount: 0.315,
			posa_company_exchange_rate: 285,
		};
		const roundToThree = (value: unknown) =>
			Number(Number(value || 0).toFixed(3));
		const { setInvoiceEquivalent } = usePaymentCurrencies({
			invoiceDoc,
			posProfile: ref({
				name: "POS-PROFILE-1",
				company: "Farooq Chemicals",
				currency: "PKR",
				company_currency: "PKR",
				posa_enable_multi_currency_payments: 1,
			}),
			currencyPrecision: ref(3),
			formatFloat: roundToThree,
		});

		const result = await setInvoiceEquivalent(payment, 0.315, 89.7);

		expect(result).toBe(true);
		expect(payment.posa_original_amount).toBeCloseTo(0.314736842, 9);
		expect(payment.amount).toBe(0.315);
		expect(payment.base_amount).toBe(89.7);
	});
});
