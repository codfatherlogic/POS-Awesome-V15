import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
	cleanupProvisionedTerminalCashier,
	ensureAuthoritativeTerminalUnlock,
} from "./helpers/terminalAuth";

const ENABLED = process.env.POSA_COUNTER_GRID_E2E === "1";
const POS_PATH = process.env.POSA_SMOKE_PATH || "/desk/posapp";
const BASE_URL = process.env.POSA_SMOKE_BASE_URL || "http://127.0.0.1:8000";
const ZERO_STOCK_ITEM = "02050";
const CART_ITEM = "02017";

test.skip(
	!ENABLED,
	"Set POSA_COUNTER_GRID_E2E=1 to run alternate-item E2E tests.",
);

async function waitForPos(page: Page) {
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	if (/\/login/.test(page.url())) {
		throw new Error(
			"Alternate-item E2E requires POSA_SMOKE_SID or login credentials.",
		);
	}
	await ensureAuthoritativeTerminalUnlock(page);
	await expect(page.locator(".main-section").first()).toBeVisible({
		timeout: 90_000,
	});
	await expect(page.locator(".loading-overlay")).toHaveCount(0, {
		timeout: 90_000,
	});
	await expect(page.getByTestId("counter-grid-pos")).toBeVisible({
		timeout: 30_000,
	});
}

async function openCounterSearch(page: Page, itemCode: string) {
	const entry = page.getByTestId("counter-grid-item-entry");
	await entry.fill(itemCode);
	await entry.press("Enter");
	const selector = page.locator(".items-selector-shell--counter-dialog");
	await expect(selector).toHaveAttribute(
		"data-search-ready-query",
		itemCode,
		{
			timeout: 30_000,
		},
	);
	const search = page.getByTestId("pos-item-search").locator("input");
	await expect(search).toBeFocused({ timeout: 10_000 });
	await expect(page.getByTestId(`pos-item-row-${itemCode}`)).toHaveAttribute(
		"aria-selected",
		"true",
	);
	return { entry, search, selector };
}

async function clearCart(page: Page) {
	await page.evaluate(() => {
		const app = (
			document.querySelector<HTMLElement>(".main-section") as any
		)?.__vue_app__;
		const piniaStore =
			app?.config?.globalProperties?.$pinia?._s?.get?.("invoice");
		if (piniaStore?.clearItems) {
			piniaStore.clearItems();
			return;
		}
		const root = document.querySelector<HTMLElement>(
			'[data-testid="counter-grid-pos"]',
		);
		let instance = (root as any)?.__vueParentComponent;
		while (instance) {
			const store = instance.proxy?.invoiceStore;
			if (store?.clearItems) {
				store.clearItems();
				instance.proxy?.eventBus?.emit?.("apply_pricing_rules");
				return;
			}
			instance = instance.parent;
		}
		throw new Error("Unable to locate the Counter Grid invoice store.");
	});
	await expect(page.locator(".posa-cart-item-row")).toHaveCount(0);
}

async function simulateConcurrentStockLoss(page: Page, itemCode: string) {
	return page.evaluate((code) => {
		const app = (
			document.querySelector<HTMLElement>(".main-section") as any
		)?.__vue_app__;
		const piniaStore =
			app?.config?.globalProperties?.$pinia?._s?.get?.("invoice");
		const piniaRow = piniaStore?.items?.find?.(
			(item: any) => item?.item_code === code,
		);
		if (piniaRow?.posa_row_id && piniaStore?.updateItemWithTotals) {
			piniaStore.updateItemWithTotals(
				piniaRow.posa_row_id,
				(item: any) => {
					item.actual_qty = 0;
					item._base_actual_qty = 0;
				},
			);
			return piniaRow.posa_row_id;
		}
		const root = document.querySelector<HTMLElement>(
			'[data-testid="counter-grid-pos"]',
		);
		let instance = (root as any)?.__vueParentComponent;
		while (instance) {
			const store = instance.proxy?.invoiceStore;
			const row = store?.items?.find?.(
				(item: any) => item?.item_code === code,
			);
			if (row?.posa_row_id && store?.updateItemWithTotals) {
				store.updateItemWithTotals(row.posa_row_id, (item: any) => {
					item.actual_qty = 0;
					item._base_actual_qty = 0;
				});
				return row.posa_row_id;
			}
			instance = instance.parent;
		}
		throw new Error(
			`Unable to mark ${code} unavailable in the active cart.`,
		);
	}, itemCode);
}

test.describe("Counter Grid alternate items", () => {
	test.describe.configure({ mode: "serial" });

	let context: BrowserContext;
	let page: Page;

	test.beforeAll(async ({ browser }) => {
		const sid = process.env.POSA_SMOKE_SID?.trim();
		context = await browser.newContext({
			baseURL: BASE_URL,
			storageState: sid
				? {
						cookies: [
							{
								name: "sid",
								value: sid,
								domain: new URL(BASE_URL).hostname,
								path: "/",
								expires: -1,
								httpOnly: true,
								secure: BASE_URL.startsWith("https://"),
								sameSite: "Lax",
							},
						],
						origins: [],
					}
				: undefined,
		});
		page = await context.newPage();
		await page.setViewportSize({ width: 1366, height: 768 });
		await waitForPos(page);
	});

	test.afterAll(async () => {
		if (page && !page.isClosed()) {
			await clearCart(page).catch(() => null);
			await cleanupProvisionedTerminalCashier(page);
		}
		if (context) await context.close();
	});

	test("opens same-generic alternates from a zero-stock result and preserves keyboard return", async () => {
		await clearCart(page);
		const { search, selector } = await openCounterSearch(
			page,
			ZERO_STOCK_ITEM,
		);

		await search.press("Enter");
		await expect(selector).toHaveAttribute("data-alternate-mode", "true", {
			timeout: 30_000,
		});
		await expect(page.getByTestId("alternate-items-context")).toBeVisible();
		const firstAlternate = page.locator('[data-pharmacy-active="true"]');
		await expect(firstAlternate).toHaveCount(1);
		const alternateCode =
			await firstAlternate.getAttribute("data-item-code");
		expect(alternateCode).toBeTruthy();
		expect(alternateCode).not.toBe(ZERO_STOCK_ITEM);

		await page.keyboard.press("Escape");
		await expect(selector).toHaveAttribute("data-alternate-mode", "false");
		await expect(search).toBeFocused({ timeout: 10_000 });
		await expect(search).toHaveValue(ZERO_STOCK_ITEM);

		await search.press("Enter");
		await expect(selector).toHaveAttribute("data-alternate-mode", "true", {
			timeout: 30_000,
		});
		await page.keyboard.press("Enter");
		await expect(page.getByTestId(`cart-row-${alternateCode}`)).toBeVisible(
			{
				timeout: 30_000,
			},
		);
		await expect(
			page.getByTestId(`cart-row-${ZERO_STOCK_ITEM}`),
		).toHaveCount(0);
	});

	test("Alt or Option+G replaces a cart line only after its alternate is added", async () => {
		await clearCart(page);
		const { search } = await openCounterSearch(page, CART_ITEM);
		await search.press("Enter");
		const originalRow = page.getByTestId(`cart-row-${CART_ITEM}`).first();
		await expect(originalRow).toBeVisible({ timeout: 30_000 });
		const originalRowId = await simulateConcurrentStockLoss(
			page,
			CART_ITEM,
		);
		expect(originalRowId).toBeTruthy();

		await page.keyboard.press("Alt+g");
		const selector = page.locator(".items-selector-shell--counter-dialog");
		await expect(selector).toHaveAttribute("data-alternate-mode", "true", {
			timeout: 30_000,
		});
		await expect(
			page.getByText("Choose an alternate item", { exact: true }),
		).toBeVisible();
		const firstAlternate = page.locator('[data-pharmacy-active="true"]');
		await expect(firstAlternate).toHaveCount(1);
		const replacementCode =
			await firstAlternate.getAttribute("data-item-code");
		expect(replacementCode).toBeTruthy();
		expect(replacementCode).not.toBe(CART_ITEM);

		await page.keyboard.press("Enter");
		await expect(
			page.getByTestId(`cart-row-${replacementCode}`),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(originalRow).toHaveCount(0);
		await expect(page.locator(".posa-cart-item-row")).toHaveCount(1);

		await page.keyboard.press("Alt+g");
		await expect(
			page.getByText("All cart items have enough stock", { exact: true }),
		).toBeVisible({
			timeout: 10_000,
		});
		await expect(selector).toHaveCount(0);
	});
});
