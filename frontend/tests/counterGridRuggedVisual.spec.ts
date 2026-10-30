import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(testsDir, "..");
const source = (...segments: string[]) =>
	readFileSync(path.join(frontendDir, "src", "posapp", ...segments), "utf8");

describe("Counter Grid rugged visual contract", () => {
	it("uses the reference navy, selection blue, and solid action colors", () => {
		const shell = source("components", "pos", "shell", "Pos.vue");
		const navbar = source("components", "navbar", "NavbarAppBar.vue");
		const actions = source(
			"components",
			"pos",
			"invoice",
			"InvoiceActionButtons.vue",
		);
		const table = source(
			"components",
			"pos",
			"invoice",
			"items-table-styles.css",
		);

		expect(shell).toContain("--counter-rugged-navy: #09253d");
		expect(navbar).toContain("pos-navbar-enhanced--counter-grid");
		expect(navbar).toContain("background: #09253d !important");
		expect(navbar).toContain("border-bottom: 2px solid #38bdf8");
		expect(shell).toContain("border: 3px solid var(--counter-rugged-navy)");
		expect(table).toContain(
			"background: var(--counter-rugged-navy-raised)",
		);
		expect(actions).toContain("--counter-rugged-green: #079b55");
		expect(actions).toContain("--counter-rugged-red: #dc343d");
	});

	it("gives the invoice and pharmacy tables crisp cells and a saturated active row", () => {
		const table = source(
			"components",
			"pos",
			"invoice",
			"items-table-styles.css",
		);
		const pharmacy = source(
			"components",
			"pos",
			"items",
			"PharmacyItemSearchTable.vue",
		);
		const itemsTable = source(
			"components",
			"pos",
			"invoice",
			"ItemsTable.vue",
		);
		const cartRow = source(
			"components",
			"pos",
			"invoice",
			"CartItemRow.vue",
		);

		expect(table).toContain(
			"border-right: 1px solid var(--counter-rugged-soft-line)",
		);
		expect(table).toContain(
			"border-bottom: 1px solid var(--counter-rugged-line)",
		);
		expect(pharmacy).toContain(
			"background: var(--counter-rugged-blue) !important",
		);
		expect(pharmacy).toContain("color: #ffffff !important");
		expect(pharmacy).toContain(
			"tbody tr:nth-child(even):not(.item-row-highlighted)",
		);
		expect(pharmacy).not.toContain("row.scrollIntoView");
		expect(pharmacy).toContain("if (!activeRow && activeIndex >= 0)");
		expect(pharmacy).toContain("scroll-behavior: auto !important");
		expect(pharmacy).toContain("transition: none !important");
		expect(pharmacy).toContain("height: 40px !important");
		expect(table).not.toContain("tbody tr:nth-child(even)");
		expect(itemsTable).not.toContain("tbody tr:nth-child(even)");
		expect(table).toContain(
			"background: var(--counter-rugged-navy-raised) !important",
		);
		expect(cartRow).toContain("background: #174a70 !important");
		expect(cartRow).toContain("transition: none !important");
	});

	it("keeps the search header fixed while only the result viewport scrolls", () => {
		const selector = source(
			"components",
			"pos",
			"items",
			"ItemsSelector.vue",
		);
		expect(selector).toContain("overflow: hidden !important");
		expect(selector).toContain("min-height: 58px");
		expect(selector).toContain("pharmacyNavigationFrame");
		expect(selector).toContain("window.requestAnimationFrame(async () =>");
	});

	it("carries the same structural treatment into history and quick edit", () => {
		const history = source(
			"components",
			"pos",
			"invoice",
			"ItemSalesHistoryModal.vue",
		);
		const quickEdit = source(
			"components",
			"pos",
			"items",
			"ItemQuickEditDialog.vue",
		);

		for (const modal of [history, quickEdit]) {
			expect(modal).toContain("background: var(--counter-rugged-navy)");
			expect(modal).toContain(
				"border-bottom: 2px solid var(--counter-rugged-cyan)",
			);
			expect(modal).toContain("border-radius: 3px");
		}
		expect(history).toContain(".summary-tile");
		expect(quickEdit).toContain(".item-quick-edit__section-title");
	});
});
