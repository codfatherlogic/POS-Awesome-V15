import { describe, expect, it } from "vitest";
import {
	buildCustomerSearchParts,
	buildCustomerSearchText,
	buildCustomerMobileSearchKeys,
	customerMobileMatchesSearch,
	customerMatchesSearchParts,
	customerMatchesSearchTerm,
	getCustomerDuplicateFields,
	normalizeCustomerDuplicateValue,
	normalizeCustomerSearchTerm,
	normalizeCustomerTaxId,
} from "../src/posapp/stores/customers/customerSearch";
import type { CustomerSummary } from "../src/posapp/types/models";

describe("customer search helpers", () => {
	it("normalizes empty and whitespace-only search terms", () => {
		expect(normalizeCustomerSearchTerm(null)).toBe("");
		expect(normalizeCustomerSearchTerm(undefined)).toBe("");
		expect(normalizeCustomerSearchTerm("  Jane Doe  ")).toBe("Jane Doe");
	});

	it("tokenizes a query once for repeated customer comparisons", () => {
		expect(buildCustomerSearchParts("  Jane  0101 TIN ")).toEqual([
			"jane",
			"0101",
			"tin",
		]);
	});

	it("matches every search token across customer searchable fields", () => {
		const customer: CustomerSummary = {
			name: "CUST-001",
			customer_name: "Jane Doe",
			mobile_no: "+1 555 0101",
			email_id: "jane@example.com",
			tax_id: "TIN-99",
		};

		expect(customerMatchesSearchTerm(customer, "jane 0101 tin")).toBe(true);
		expect(customerMatchesSearchTerm(customer, "jane missing")).toBe(false);
		expect(customerMatchesSearchTerm(customer, "   ")).toBe(true);
	});

	it("matches mobile numbers across punctuation and country-code formats", () => {
		expect(buildCustomerMobileSearchKeys("+92 300-1234567")).toContain(
			"3001234567",
		);
		expect(
			customerMobileMatchesSearch("+92 300-1234567", "0300 123 4567"),
		).toBe(true);
		expect(
			customerMatchesSearchTerm(
				{ name: "CUST-001", mobile_no: "+92 300-1234567" },
				"03001234567",
			),
		).toBe(true);
	});

	it("does not treat a numeric tax ID as mobile-only search", () => {
		const customer: CustomerSummary = {
			name: "CUST-001",
			customer_name: "Jane Doe",
			tax_id: "12-345 6789",
		};

		expect(normalizeCustomerTaxId(customer.tax_id)).toBe("123456789");
		expect(customerMatchesSearchTerm(customer, "123456789")).toBe(true);
	});

	it("uses persisted normalized search text when available", () => {
		const customer = {
			name: "CUST-001",
			customer_name: "Jane Doe",
			mobile_no: "+1 555 0101",
			email_id: "jane@example.com",
			tax_id: "TIN-99",
		} as CustomerSummary & { _search_text?: string };
		customer._search_text = buildCustomerSearchText(customer);
		customer.customer_name = "Changed after indexing";

		expect(customerMatchesSearchParts(customer, ["jane", "tin-99"])).toBe(
			true,
		);
	});

	it("normalizes duplicate identifiers consistently", () => {
		expect(
			normalizeCustomerDuplicateValue("mobile_no", "+92 300-123 4567"),
		).toBe("923001234567");
		expect(
			normalizeCustomerDuplicateValue("email_id", " User@Example.COM "),
		).toBe("user@example.com");
		expect(normalizeCustomerDuplicateValue("tax_id", " TAX  99 ")).toBe(
			"tax99",
		);
	});

	it("detects duplicate customer identifiers without requiring the same formatting", () => {
		const customer: CustomerSummary = {
			name: "CUST-001",
			customer_name: "Jane Doe",
			mobile_no: "+92 300-1234567",
			email_id: "jane@example.com",
			tax_id: "TIN 99",
		};

		expect(
			getCustomerDuplicateFields(customer, {
				customer_name: "Different Name",
				mobile_no: "923001234567",
				tax_id: "tin99",
			}),
		).toEqual(["mobile_no", "tax_id"]);
	});
});
