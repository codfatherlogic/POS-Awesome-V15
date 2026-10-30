import {
	expect,
	test,
	type BrowserContext,
	type Locator,
	type Page,
} from "@playwright/test";

import {
	cleanupProvisionedTerminalCashier,
	ensureAuthoritativeTerminalUnlock,
} from "./helpers/terminalAuth";

const ENABLED = process.env.POSA_COUNTER_GRID_E2E === "1";
const POS_PATH = process.env.POSA_SMOKE_PATH || "/desk/posapp";
const BASE_URL = process.env.POSA_SMOKE_BASE_URL || "http://127.0.0.1:8000";

test.skip(
	!ENABLED,
	"Set POSA_COUNTER_GRID_E2E=1 to run Counter Grid visual E2E tests.",
);

async function waitForPos(page: Page) {
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	if (/\/login/.test(page.url())) {
		throw new Error(
			"Counter Grid visual E2E requires POSA_SMOKE_SID or login credentials.",
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

async function expectNoViewportOverflow(page: Page) {
	const dimensions = await page.evaluate(() => ({
		documentWidth: document.documentElement.scrollWidth,
		viewportWidth: document.documentElement.clientWidth,
		documentHeight: document.documentElement.scrollHeight,
		viewportHeight: document.documentElement.clientHeight,
	}));
	expect(dimensions.documentWidth).toBeLessThanOrEqual(
		dimensions.viewportWidth + 1,
	);
	expect(dimensions.documentHeight).toBeLessThanOrEqual(
		dimensions.viewportHeight + 1,
	);
}

async function expectBackground(locator: Locator, expected: string) {
	await expect
		.poll(() =>
			locator.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.toBe(expected);
}

test.describe("Counter Grid rugged visual system", () => {
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
			await cleanupProvisionedTerminalCashier(page);
		}
		if (context) {
			await context.close();
		}
	});

	test("keeps the navy grid hierarchy inside every certified desktop width", async () => {
		await page.setViewportSize({ width: 1366, height: 768 });

		for (const viewport of [
			{ width: 1024, height: 768 },
			{ width: 1280, height: 720 },
			{ width: 1366, height: 768 },
			{ width: 1920, height: 1080 },
		]) {
			await page.setViewportSize(viewport);
			await expect(page.getByTestId("counter-grid-pos")).toBeVisible();
			await expectBackground(
				page.locator(".pos-navbar-enhanced--counter-grid"),
				"rgb(9, 37, 61)",
			);
			await expectBackground(
				page.locator(".invoice-items-card > .invoice-section-heading"),
				"rgb(9, 37, 61)",
			);
			await expectBackground(
				page.locator(".posa-cart-table thead th").first(),
				"rgb(23, 74, 112)",
			);
			await expectBackground(
				page.getByTestId("invoice-action-pay"),
				"rgb(7, 155, 85)",
			);
			await expectBackground(
				page.getByTestId("invoice-action-cancel-sale"),
				"rgb(220, 52, 61)",
			);
			await expectNoViewportOverflow(page);
			await page.screenshot({
				path: `test-results/counter-grid-rugged-${viewport.width}x${viewport.height}.png`,
				fullPage: true,
			});
		}
	});

	test("uses the rugged search, history, and update-item surfaces", async () => {
		await page.setViewportSize({ width: 1366, height: 768 });

		const entry = page.getByTestId("counter-grid-item-entry");
		await entry.fill("arinac");
		await entry.press("Enter");
		const selector = page.locator(".items-selector-shell--counter-dialog");
		await expect(selector).toHaveAttribute(
			"data-search-ready-query",
			"arinac",
			{
				timeout: 30_000,
			},
		);
		const selectedResult = page.locator('[data-pharmacy-active="true"]');
		await expect(selectedResult).toHaveCount(1);
		await expectBackground(
			selectedResult.locator("td").first(),
			"rgb(15, 112, 215)",
		);
		await expectBackground(
			page.locator(".counter-item-search-header"),
			"rgb(9, 37, 61)",
		);

		const searchInput = page
			.getByTestId("pos-item-search")
			.locator("input");
		const selectorCard = selector.locator(".selection-card");
		const selectorHeader = selector.locator(".selector-header-card");
		const resultScroller = selector.locator(
			".pharmacy-results-table .v-table__wrapper",
		);
		const initialLayout = await page.evaluate(() => {
			const input = document.querySelector<HTMLElement>(
				'[data-testid="pos-item-search"] input',
			);
			const header = document.querySelector<HTMLElement>(
				".items-selector-shell--counter-dialog .selector-header-card",
			);
			const card = document.querySelector<HTMLElement>(
				".items-selector-shell--counter-dialog .selection-card",
			);
			const inputRect = input?.getBoundingClientRect();
			const headerRect = header?.getBoundingClientRect();
			return {
				inputHeight: inputRect?.height || 0,
				inputTop: inputRect?.top || 0,
				inputBottom: inputRect?.bottom || 0,
				headerTop: headerRect?.top || 0,
				headerBottom: headerRect?.bottom || 0,
				cardScrollTop: card?.scrollTop || 0,
			};
		});
		expect(initialLayout.inputHeight).toBeGreaterThanOrEqual(38);
		expect(initialLayout.inputTop).toBeGreaterThanOrEqual(
			initialLayout.headerTop - 1,
		);
		expect(initialLayout.inputBottom).toBeLessThanOrEqual(
			initialLayout.headerBottom + 1,
		);
		expect(initialLayout.cardScrollTop).toBe(0);
		const visibleResultHeights = await page
			.locator(".pharmacy-results-table [data-item-code]")
			.evaluateAll((rows) =>
				rows.map((row) => row.getBoundingClientRect().height),
			);
		expect(visibleResultHeights.length).toBeGreaterThan(0);
		expect(Math.max(...visibleResultHeights)).toBeLessThanOrEqual(41);

		await searchInput.press("Alt+ArrowDown");
		await expect(
			page.locator('[data-pharmacy-active="true"]'),
		).toBeFocused();
		await page.keyboard.press("End");
		await page.keyboard.press("ArrowDown");
		await expect(searchInput).toBeFocused();
		await expect(page.locator('[data-pharmacy-active="true"]')).toHaveCount(
			0,
		);
		await searchInput.press("ArrowDown");
		await expect(page.locator('[data-pharmacy-active="true"]')).toHaveCount(
			1,
		);

		await searchInput.focus();
		const downScrollPositions: number[] = [];
		for (let index = 0; index < 18; index += 1) {
			await page.keyboard.down("ArrowDown");
			await page.waitForTimeout(18);
			downScrollPositions.push(
				await resultScroller.evaluate((node) => node.scrollTop),
			);
		}
		await page.keyboard.up("ArrowDown");
		const downCode = await page
			.locator('[data-pharmacy-active="true"]')
			.getAttribute("data-item-code");

		for (let index = 0; index < 7; index += 1) {
			await page.keyboard.down("ArrowUp");
			await page.waitForTimeout(18);
		}
		await page.keyboard.up("ArrowUp");
		const reversedCode = await page
			.locator('[data-pharmacy-active="true"]')
			.getAttribute("data-item-code");
		expect(reversedCode).not.toBe(downCode);

		const largestScrollStep = downScrollPositions.reduce(
			(largest, current, index) =>
				Math.max(
					largest,
					Math.abs(current - (downScrollPositions[index - 1] || 0)),
				),
			0,
		);
		expect(largestScrollStep).toBeLessThanOrEqual(50);
		expect(await selectorCard.evaluate((node) => node.scrollTop)).toBe(0);
		await expect(selectorHeader).toBeInViewport();
		await expect(searchInput).toBeInViewport();
		const activeRow = page.locator('[data-pharmacy-active="true"]');
		await expect(activeRow).toHaveCount(1);
		const activeVisibility = await page.evaluate(() => {
			const root = document.querySelector<HTMLElement>(
				".pharmacy-results-table",
			);
			const scroller =
				root?.querySelector<HTMLElement>(".v-table__wrapper");
			const header = root?.querySelector<HTMLElement>("thead");
			const row = root?.querySelector<HTMLElement>(
				'[data-pharmacy-active="true"]',
			);
			const scrollerRect = scroller?.getBoundingClientRect();
			const rowRect = row?.getBoundingClientRect();
			return {
				rowTop: rowRect?.top || 0,
				rowBottom: rowRect?.bottom || 0,
				visibleTop:
					(scrollerRect?.top || 0) +
					(header?.getBoundingClientRect().height || 0),
				visibleBottom: scrollerRect?.bottom || 0,
			};
		});
		expect(activeVisibility.rowTop).toBeGreaterThanOrEqual(
			activeVisibility.visibleTop - 1,
		);
		expect(activeVisibility.rowBottom).toBeLessThanOrEqual(
			activeVisibility.visibleBottom + 1,
		);
		await expectNoViewportOverflow(page);

		await page.setViewportSize({ width: 1024, height: 768 });
		await page.waitForTimeout(100);
		await searchInput.focus();
		for (let index = 0; index < 8; index += 1) {
			await page.keyboard.down("ArrowDown");
			await page.waitForTimeout(18);
		}
		await page.keyboard.up("ArrowDown");
		for (let index = 0; index < 4; index += 1) {
			await page.keyboard.down("ArrowUp");
			await page.waitForTimeout(18);
		}
		await page.keyboard.up("ArrowUp");
		const laptopLayout = await page.evaluate(() => {
			const input = document.querySelector<HTMLElement>(
				'[data-testid="pos-item-search"] input',
			);
			const header = document.querySelector<HTMLElement>(
				".items-selector-shell--counter-dialog .selector-header-card",
			);
			const card = document.querySelector<HTMLElement>(
				".items-selector-shell--counter-dialog .selection-card",
			);
			const inputRect = input?.getBoundingClientRect();
			const headerRect = header?.getBoundingClientRect();
			return {
				inputHeight: inputRect?.height || 0,
				inputTop: inputRect?.top || 0,
				inputBottom: inputRect?.bottom || 0,
				headerTop: headerRect?.top || 0,
				headerBottom: headerRect?.bottom || 0,
				cardScrollTop: card?.scrollTop || 0,
			};
		});
		expect(laptopLayout.inputHeight).toBeGreaterThanOrEqual(38);
		expect(laptopLayout.inputTop).toBeGreaterThanOrEqual(
			laptopLayout.headerTop - 1,
		);
		expect(laptopLayout.inputBottom).toBeLessThanOrEqual(
			laptopLayout.headerBottom + 1,
		);
		expect(laptopLayout.cardScrollTop).toBe(0);
		await expectNoViewportOverflow(page);

		await page.setViewportSize({ width: 1366, height: 768 });
		await page.keyboard.press("Home");
		await expect(
			page.locator('[data-pharmacy-active="true"]'),
		).toHaveAttribute("data-item-code", "02017");
		await page.screenshot({
			path: "test-results/counter-grid-rugged-item-search.png",
			fullPage: true,
		});

		await page
			.getByTestId("pos-item-search")
			.locator("input")
			.press("Enter");
		const cartRow = page.getByTestId("cart-row-02017").first();
		await expect(cartRow).toBeVisible({ timeout: 30_000 });
		await cartRow.click();
		await page.keyboard.press("F12");
		const history = page.getByTestId("item-history-modal");
		await expect(history).toBeVisible({ timeout: 30_000 });
		await expectBackground(
			history.locator(".posa-item-history-header"),
			"rgb(9, 37, 61)",
		);
		await page.screenshot({
			path: "test-results/counter-grid-rugged-item-history.png",
			fullPage: true,
		});

		await page.getByTestId("item-workspace-update-item").click();
		const quickEdit = page.getByTestId("item-quick-edit-modal");
		await expect(quickEdit).toBeVisible({ timeout: 30_000 });
		await expectBackground(
			quickEdit.locator(".item-quick-edit__title"),
			"rgb(9, 37, 61)",
		);
		await expect(
			quickEdit.locator(".item-quick-edit__section-title").first(),
		).toHaveCSS("background-color", "rgb(23, 74, 112)");
		await expectNoViewportOverflow(page);
		await page.screenshot({
			path: "test-results/counter-grid-rugged-item-update.png",
			fullPage: true,
		});
	});
});
