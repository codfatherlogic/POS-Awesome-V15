import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(testsDir, "..");
const source = (...segments: string[]) =>
	readFileSync(path.join(frontendDir, "src", "posapp", ...segments), "utf8");

describe("new POS feature dark-mode contract", () => {
	it("uses shared surface and text tokens across the Counter Grid workflow", () => {
		const sources = [
			source("components", "pos", "shell", "Pos.vue"),
			source("components", "pos", "Invoice.vue"),
			source("components", "pos", "invoice", "CounterGridEntryRow.vue"),
			source("components", "pos", "invoice", "InvoiceSummary.vue"),
			source("components", "pos", "invoice", "items-table-styles.css"),
			source("components", "pos", "items", "ItemsSelector.vue"),
			source("components", "pos", "items", "PharmacyItemSearchTable.vue"),
			source("components", "pos", "items", "ItemQuickEditDialog.vue"),
		];

		for (const component of sources) {
			expect(component).toMatch(
				/var\(--pos-(?:card-bg|input-bg|surface-muted|text-primary)/,
			);
		}

		expect(sources.join("\n")).not.toMatch(
			/(?:background:\s*#ffffff|color:\s*#10263b|color:\s*#25384b)/,
		);
	});

	it("resolves teleported history dialogs from the global theme", () => {
		const history = source(
			"components",
			"pos",
			"invoice",
			"ItemSalesHistoryModal.vue",
		);

		expect(history).toContain(
			'import { useTheme } from "../../../composables/core/useTheme"',
		);
		expect(history).toContain(':theme="resolvedTheme"');
		expect(history).toContain("props.isDarkTheme ?? theme.isDark.value");
		expect(history).toContain(
			"background: var(--pos-dialog-bg) !important",
		);
	});

	it("keeps opening and payment states theme-aware", () => {
		const opening = source(
			"components",
			"pos",
			"shift",
			"OpeningDialog.vue",
		);
		const payment = source("components", "pos", "shell", "PayView.vue");

		expect(opening).toContain("background: var(--pos-card-bg)");
		expect(opening).toContain("color: var(--pos-text-primary)");
		expect(opening).toContain("background: var(--pos-table-header-bg)");
		expect(payment).toContain(
			"background-color: var(--pos-selected-bg) !important",
		);
	});
});
