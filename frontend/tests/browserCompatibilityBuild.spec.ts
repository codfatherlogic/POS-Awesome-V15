import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { auditChrome109CounterGridCss } from "../scripts/audit-chrome109-css.mjs";

const thisFile = fileURLToPath(import.meta.url);
const frontendDir = path.resolve(path.dirname(thisFile), "..");
const readFrontendFile = (fileName: string) =>
	readFileSync(path.join(frontendDir, fileName), "utf8");

describe("Chrome 109 build compatibility", () => {
	it("transpiles JavaScript and CSS to the certified minimum browser syntax", () => {
		const viteConfig = readFrontendFile("vite.config.js");

		expect(viteConfig).toContain('target: "chrome109"');
		expect(viteConfig).toContain('cssTarget: "chrome109"');
		expect(viteConfig).not.toContain('target: "esnext"');
	});

	it("keeps TypeScript API checking and Autoprefixer at the same release floor", () => {
		const tsconfig = JSON.parse(readFrontendFile("tsconfig.json"));
		const packageJson = JSON.parse(readFrontendFile("package.json"));

		expect(tsconfig.compilerOptions.target).toBe("ES2022");
		expect(tsconfig.compilerOptions.lib).toContain("ES2022");
		expect(packageJson.browserslist).toContain("Chrome >= 109");
	});

	it("loads required dependency polyfills before every application entry", () => {
		for (const entry of ["src/loader.ts", "src/posawesome.bundle.ts"]) {
			expect(readFrontendFile(entry).trimStart()).toMatch(
				/^import "\.\/browserCompatibility";/,
			);
		}
		expect(readFrontendFile("src/offline/index.ts").trimStart()).toMatch(
			/^import "\.\.\/browserCompatibility";/,
		);
	});

	it("audits Chrome 109 fallbacks and the solid Counter Grid selection contract", () => {
		const itemTableCss = readFrontendFile(
			"src/posapp/components/pos/invoice/items-table-styles.css",
		);
		const cartItemSource = readFrontendFile(
			"src/posapp/components/pos/invoice/CartItemRow.vue",
		);
		const cartItemCss = cartItemSource.match(
			/<style[^>]*>([\s\S]*?)<\/style>/,
		)?.[1];
		expect(cartItemCss).toBeTruthy();

		expect(() =>
			auditChrome109CounterGridCss(
				`${itemTableCss}\n${cartItemCss}`,
				"relevant source CSS",
			),
		).not.toThrow();
		expect(
			JSON.parse(readFrontendFile("package.json")).scripts.build,
		).toContain("audit-chrome109-css.mjs");
	});

	it("rejects color-mix selection, zebra rows, and animated focus changes", () => {
		const unsupportedOnly =
			["posa-cart-empty-state", "posa-cart-empty-state__icon-wrap"]
				.map(
					(className) =>
						`.${className}{background:red;background:color-mix(in srgb, red 10%, white);}`,
				)
				.join("") +
			`.posa-cart-table--counter-grid tbody tr:nth-child(even)>td{background:#fff;}` +
			`.posa-cart-item-row--keyboard-active{background:color-mix(in srgb, #174a70 90%, white);transition:all .2s;animation:pulse 1s;}` +
			`.posa-cart-item-cell--keyboard-active{background:#174a70;box-shadow:inset 0 0 0 3px #38bdf8;}`;

		expect(() =>
			auditChrome109CounterGridCss(unsupportedOnly, "fixture CSS"),
		).toThrow("must use a fixed Chrome 109 selection color");
	});
});
