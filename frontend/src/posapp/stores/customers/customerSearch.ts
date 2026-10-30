import type { CustomerSummary } from "../../types/models";

type SearchableCustomer = CustomerSummary & {
	_search_text?: string;
};

export function normalizeCustomerSearchTerm(
	term: string | null | undefined,
): string {
	if (typeof term !== "string") {
		return "";
	}
	return term.trim();
}

export function normalizeCustomerMobile(
	value: string | null | undefined,
): string {
	return String(value ?? "").replace(/\D/g, "");
}

export function normalizeCustomerTaxId(
	value: string | null | undefined,
): string {
	return String(value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

export function isCustomerMobileSearchTerm(
	term: string | null | undefined,
): boolean {
	const normalized = normalizeCustomerSearchTerm(term);
	return Boolean(normalized) && /^[\d\s()+.-]+$/.test(normalized);
}

export function buildCustomerMobileSearchKeys(
	value: string | null | undefined,
): string[] {
	const digits = normalizeCustomerMobile(value);
	if (!digits) {
		return [];
	}

	const keys = new Set([digits]);
	if (digits.startsWith("00") && digits.length > 2) {
		keys.add(digits.slice(2));
	}
	if (digits.startsWith("0") && digits.length > 1) {
		keys.add(digits.slice(1));
	}
	for (const tailLength of [10, 9, 8]) {
		if (digits.length > tailLength) {
			keys.add(digits.slice(-tailLength));
		}
	}

	return Array.from(keys).filter((key) => key.length >= 4);
}

export function customerMobileMatchesSearch(
	mobile: string | null | undefined,
	term: string | null | undefined,
): boolean {
	const customerKeys = buildCustomerMobileSearchKeys(mobile);
	const searchKeys = buildCustomerMobileSearchKeys(term);
	return searchKeys.some((searchKey) =>
		customerKeys.some(
			(customerKey) =>
				customerKey.includes(searchKey) ||
				searchKey.includes(customerKey),
		),
	);
}

export function buildCustomerSearchParts(
	term: string | null | undefined,
): string[] {
	return normalizeCustomerSearchTerm(term)
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
}

export function buildCustomerSearchText(
	customer: CustomerSummary | null | undefined,
): string {
	if (!customer) {
		return "";
	}

	return [
		customer.customer_name,
		customer.name,
		customer.mobile_no,
		customer.email_id,
		(customer as CustomerSummary & { tax_id?: unknown }).tax_id,
		normalizeCustomerMobile(customer.mobile_no),
		normalizeCustomerTaxId(
			(customer as CustomerSummary & { tax_id?: string }).tax_id,
		),
	]
		.filter((value) => value !== null && value !== undefined)
		.map((value) => String(value).toLowerCase())
		.join("\n");
}

export function customerMatchesSearchParts(
	customer: CustomerSummary | null | undefined,
	searchParts: readonly string[],
): boolean {
	if (!searchParts.length) {
		return true;
	}

	if (!customer) {
		return false;
	}

	const searchableCustomer = customer as SearchableCustomer;
	const searchText =
		searchableCustomer._search_text || buildCustomerSearchText(customer);

	return searchParts.every((part) => searchText.includes(part));
}

export function customerMatchesSearchTerm(
	customer: CustomerSummary | null | undefined,
	term: string | null | undefined,
): boolean {
	if (isCustomerMobileSearchTerm(term)) {
		return (
			customerMobileMatchesSearch(customer?.mobile_no, term) ||
			customerMatchesSearchParts(customer, buildCustomerSearchParts(term))
		);
	}
	return customerMatchesSearchParts(customer, buildCustomerSearchParts(term));
}

export type CustomerDuplicateField =
	| "customer_name"
	| "mobile_no"
	| "email_id"
	| "tax_id";

export function normalizeCustomerDuplicateValue(
	field: CustomerDuplicateField,
	value: unknown,
): string {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase();
	if (field === "mobile_no") {
		return normalized.replace(/\D/g, "");
	}
	if (field === "customer_name") {
		return normalized.replace(/\s+/g, " ");
	}
	if (field === "tax_id") {
		return normalized.replace(/\s+/g, "");
	}
	return normalized;
}

export function getCustomerDuplicateFields(
	customer: CustomerSummary,
	candidate: Partial<CustomerSummary>,
	includeCustomerName = true,
): CustomerDuplicateField[] {
	const fields: CustomerDuplicateField[] = [
		...(includeCustomerName ? (["customer_name"] as const) : []),
		"mobile_no",
		"email_id",
		"tax_id",
	];
	return fields.filter((field) => {
		const candidateValue = normalizeCustomerDuplicateValue(
			field,
			candidate[field],
		);
		return (
			Boolean(candidateValue) &&
			candidateValue ===
				normalizeCustomerDuplicateValue(field, customer[field])
		);
	});
}
