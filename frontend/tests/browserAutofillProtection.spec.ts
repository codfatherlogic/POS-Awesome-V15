import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(path), "utf8");

const getFieldTag = (source: string, name: string) => {
	const nameOffset = source.indexOf(`name="${name}"`);
	expect(nameOffset, `Missing field ${name}`).toBeGreaterThan(-1);

	const tagStart = source.lastIndexOf("<v-text-field", nameOffset);
	const tagEnd = source.indexOf("/>", nameOffset);
	expect(tagStart, `Missing v-text-field start for ${name}`).toBeGreaterThan(
		-1,
	);
	expect(tagEnd, `Missing v-text-field end for ${name}`).toBeGreaterThan(
		nameOffset,
	);

	return source.slice(tagStart, tagEnd + 2);
};

describe("browser autofill protection", () => {
	it("preserves explicit autocomplete tokens in the global input helper", () => {
		const source = readSource("src/posapp/posapp.ts");

		expect(source).toContain('if (!element.hasAttribute("autocomplete"))');
		expect(source).toContain('element.setAttribute("autocomplete", "off")');
		expect(source).toContain(
			'element.setAttribute("data-1p-ignore", "true")',
		);
		expect(source).toContain(
			'element.setAttribute("data-lpignore", "true")',
		);
		expect(source).toContain(
			'element.setAttribute("data-bwignore", "true")',
		);
	});

	it("marks every additional discount field as a decimal non-credential input", () => {
		const invoiceSummary = readSource(
			"src/posapp/components/pos/invoice/InvoiceSummary.vue",
		);
		const posShell = readSource("src/posapp/components/pos/shell/Pos.vue");
		const fields = [
			[invoiceSummary, "pos-counter-additional-discount"],
			[invoiceSummary, "pos-counter-additional-discount-percent"],
			[invoiceSummary, "pos-invoice-additional-discount"],
			[invoiceSummary, "pos-invoice-additional-discount-percent"],
			[posShell, "pos-mobile-additional-discount"],
			[posShell, "pos-mobile-additional-discount-percent"],
		] as const;

		for (const [source, name] of fields) {
			const field = getFieldTag(source, name);
			expect(field).toContain('autocomplete="transaction-amount"');
			expect(field).toContain('inputmode="decimal"');
			expect(field).toContain('data-1p-ignore="true"');
			expect(field).toContain('data-lpignore="true"');
			expect(field).toContain('data-bwignore="true"');
		}
	});
});
