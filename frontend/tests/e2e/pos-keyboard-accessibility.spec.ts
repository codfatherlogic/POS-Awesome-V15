import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
	cleanupProvisionedTerminalCashier,
	ensureAuthoritativeTerminalUnlock,
} from "./helpers/terminalAuth";

const ENABLED =
	process.env.POSA_COUNTER_GRID_A11Y_E2E === "1" ||
	process.env.POSA_KEYBOARD_E2E === "1";
const POS_PATH = process.env.POSA_SMOKE_PATH || "/desk/posapp";

const AMBIGUOUS_QUERIES = ["arinac", "panadol"] as const;

test.skip(
	!ENABLED,
	"Set POSA_COUNTER_GRID_A11Y_E2E=1 to run Counter Grid accessibility E2E tests.",
);

test.afterEach(async ({ page }) => {
	await cleanupProvisionedTerminalCashier(page);
});

type AxeViolationSummary = {
	id: string;
	impact: string | null | undefined;
	help: string;
	targets: string[][];
};

async function waitForCounterGrid(page: Page) {
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	if (/\/login/.test(page.url())) {
		throw new Error(
			"Counter Grid accessibility E2E requires POSA_SMOKE_SID or login credentials.",
		);
	}
	await ensureAuthoritativeTerminalUnlock(page);

	await expect(page.getByTestId("counter-grid-pos")).toBeVisible({
		timeout: 90_000,
	});
	await expect(page.locator(".loading-overlay")).toHaveCount(0, {
		timeout: 90_000,
	});
	await expect(page.getByTestId("counter-grid-item-entry")).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByTestId("counter-grid-item-entry")).toBeFocused({
		timeout: 15_000,
	});
}

async function waitForSearchReady(page: Page, query: string) {
	const search = page.getByTestId("pos-item-search").locator("input");
	const selector = page.locator(".items-selector-shell--counter-dialog");

	await expect(page.locator(".counter-item-search-surface")).toBeVisible({
		timeout: 30_000,
	});
	await expect(search).toBeVisible();
	await expect(search).toBeFocused({ timeout: 15_000 });
	await expect(search).toHaveValue(query);
	await expect(selector).toHaveAttribute("data-search-ready-query", query, {
		timeout: 30_000,
	});
	await expect(selector).toHaveAttribute("data-search-pending", "false", {
		timeout: 30_000,
	});

	return search;
}

async function addAmbiguousItemByKeyboard(page: Page, query: string) {
	const entry = page.getByTestId("counter-grid-item-entry");
	await expect(entry).toBeFocused();
	await expect(entry).toHaveValue("");

	await page.keyboard.type(query);
	await expect(entry).toHaveValue(query);
	await page.keyboard.press("Enter");
	const search = await waitForSearchReady(page, query);

	const rows = page.locator(
		'.items-selector-shell--counter-dialog [data-testid^="pos-item-row-"]',
	);
	await expect(rows.nth(1)).toBeVisible({ timeout: 30_000 });
	await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");
	await expect(rows.nth(1)).toHaveAttribute("aria-selected", "false");
	await expect(search).toHaveAttribute("role", "combobox");
	await expect(search).toHaveAttribute("aria-activedescendant", /\S+/);

	await page.keyboard.press("ArrowDown");
	await expect(rows.nth(0)).toHaveAttribute("aria-selected", "false");
	await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
	const itemCode = await rows.nth(1).getAttribute("data-item-code");
	expect(
		itemCode,
		`${query} second result must expose a stable item code`,
	).toBeTruthy();

	await page.keyboard.press("Enter");
	await expect(page.locator(".counter-item-search-surface")).toBeHidden({
		timeout: 30_000,
	});
	const cartRow = page.getByTestId(`cart-row-${itemCode}`).first();
	await expect(cartRow).toBeVisible({ timeout: 30_000 });
	await expect(cartRow.locator('[data-column-key="qty"] input')).toBeFocused({
		timeout: 15_000,
	});

	return { itemCode: String(itemCode), cartRow };
}

async function advanceEditableRowByKeyboard(
	page: Page,
	cartRow: Locator,
	quantity: string,
) {
	const qty = cartRow.locator('[data-column-key="qty"] input');
	const discountPercentage = cartRow.locator(
		'[data-column-key="discount_percentage"] input',
	);
	const discountAmount = cartRow.locator(
		'[data-column-key="discount_amount"] input',
	);

	await expect(qty).toBeFocused();
	await page.keyboard.press("Control+A");
	await page.keyboard.type(quantity);
	await page.keyboard.press("Enter");
	await expect(discountPercentage).toBeFocused({ timeout: 15_000 });

	await page.keyboard.press("Enter");
	await expect(discountAmount).toBeFocused({ timeout: 15_000 });

	await page.keyboard.press("Enter");
	await expect(page.getByTestId("counter-grid-item-entry")).toBeFocused({
		timeout: 15_000,
	});
}

async function addOneItemAndReturnToEntry(page: Page) {
	const result = await addAmbiguousItemByKeyboard(page, AMBIGUOUS_QUERIES[0]);
	await advanceEditableRowByKeyboard(page, result.cartRow, "1");
	return result;
}

async function openPaymentByKeyboard(page: Page) {
	await page.keyboard.press("F9");
	await expect(page.getByTestId("payment-root")).toBeVisible({
		timeout: 30_000,
	});
	await expect(
		page
			.locator("[data-pos-keyboard-target='payment-amount'] input")
			.first(),
	).toBeFocused({ timeout: 15_000 });
}

async function assertSeriousAndCriticalAxeClean(
	page: Page,
	state: string,
	include: string,
) {
	const result = await new AxeBuilder({ page }).include(include).analyze();
	const violations: AxeViolationSummary[] = result.violations
		.filter(
			(violation) =>
				violation.impact === "serious" ||
				violation.impact === "critical",
		)
		.map((violation) => ({
			id: violation.id,
			impact: violation.impact,
			help: violation.help,
			targets: violation.nodes.map((node) => node.target),
		}));

	await test.info().attach(`axe-${state}`, {
		body: Buffer.from(JSON.stringify(result, null, 2)),
		contentType: "application/json",
	});
	expect(violations, `${state} serious/critical axe violations`).toEqual([]);
}

async function assertNoPageHorizontalOverflow(page: Page) {
	const dimensions = await page.locator("html").evaluate((html) => ({
		clientWidth: html.clientWidth,
		scrollWidth: html.scrollWidth,
	}));
	expect(dimensions.scrollWidth).toBeLessThanOrEqual(
		dimensions.clientWidth + 1,
	);
}

async function assertFocusedEntryInsideViewport(page: Page) {
	const entry = page.getByTestId("counter-grid-item-entry");
	await expect(entry).toBeFocused({ timeout: 15_000 });
	await entry.scrollIntoViewIfNeeded();
	const box = await entry.boundingBox();
	expect(box).not.toBeNull();
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
	expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

test.describe.serial("Counter Grid keyboard and accessibility", () => {
	test("completes the core two-item cashier flow without a mouse", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await waitForCounterGrid(page);
		await expect(page.locator(".posa-cart-item-row")).toHaveCount(0);

		const first = await addAmbiguousItemByKeyboard(
			page,
			AMBIGUOUS_QUERIES[0],
		);
		await advanceEditableRowByKeyboard(page, first.cartRow, "2");

		const second = await addAmbiguousItemByKeyboard(
			page,
			AMBIGUOUS_QUERIES[1],
		);
		expect(second.itemCode).not.toBe(first.itemCode);
		await advanceEditableRowByKeyboard(page, second.cartRow, "1");

		const entry = page.getByTestId("counter-grid-item-entry");
		await page.keyboard.press("Shift+Tab");
		await expect(
			second.cartRow.locator('[data-column-key="discount_amount"] input'),
		).toBeFocused({ timeout: 15_000 });
		await page.keyboard.press("ArrowUp");
		await expect(
			first.cartRow.locator('[data-column-key="discount_amount"] input'),
		).toBeFocused({ timeout: 15_000 });
		await page.keyboard.press("ArrowDown");
		await expect(
			second.cartRow.locator('[data-column-key="discount_amount"] input'),
		).toBeFocused({ timeout: 15_000 });
		await page.keyboard.press("Enter");
		await expect(entry).toBeFocused({ timeout: 15_000 });

		await openPaymentByKeyboard(page);
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("payment-root")).toBeHidden({
			timeout: 30_000,
		});
		await expect(entry).toBeFocused({ timeout: 15_000 });
		await expect(entry).toHaveValue("");
	});

	test("navigates item history and permitted quick edit without a mouse", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await waitForCounterGrid(page);
		await addOneItemAndReturnToEntry(page);

		await page.keyboard.press("F12");
		const history = page.getByTestId("item-history-modal");
		const salesTab = page.getByTestId("item-history-sales-tab");
		const detailsTab = page.getByTestId("item-history-details-tab");
		const updateItem = page.getByTestId("item-workspace-update-item");
		await expect(history).toBeVisible({ timeout: 30_000 });
		await expect(salesTab).toHaveAttribute("aria-selected", "true");

		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("Enter");
		await expect(detailsTab).toHaveAttribute("aria-selected", "true");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("Enter");
		await expect(salesTab).toHaveAttribute("aria-selected", "true");

		test.skip(
			!(await updateItem.isVisible()),
			"Current cashier/profile does not permit Item quick edit.",
		);
		await page.keyboard.press("ArrowUp");
		await expect(updateItem).toHaveClass(/posa-modal-keyboard-box/);
		await page.keyboard.press("Enter");
		await expect(history).toBeHidden({ timeout: 30_000 });

		const quickEdit = page.getByTestId("item-quick-edit-modal");
		const nameField = page.getByTestId("item-quick-edit-name");
		await expect(quickEdit).toBeVisible({ timeout: 30_000 });
		await expect(nameField).toHaveClass(/posa-quick-edit-keyboard-box/);
		await page.keyboard.press("Enter");
		await expect(nameField.locator("input")).toBeFocused({
			timeout: 15_000,
		});
		await page.keyboard.press("Escape");
		await expect(nameField).toHaveClass(/posa-quick-edit-keyboard-box/);
		await page.keyboard.press("Escape");
		await expect(quickEdit).toBeHidden({ timeout: 30_000 });
		await expect(page.getByTestId("counter-grid-item-entry")).toBeFocused({
			timeout: 15_000,
		});
	});

	test("has no serious or critical axe violations in the empty grid", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await waitForCounterGrid(page);
		await assertSeriousAndCriticalAxeClean(
			page,
			"empty-grid",
			'[data-testid="counter-grid-pos"]',
		);
	});

	test("has no serious or critical axe violations in the populated grid", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await waitForCounterGrid(page);
		await addOneItemAndReturnToEntry(page);
		await assertSeriousAndCriticalAxeClean(
			page,
			"populated-grid",
			'[data-testid="counter-grid-pos"]',
		);
	});

	test("has no serious or critical axe violations in pharmacy search", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await waitForCounterGrid(page);
		await page.keyboard.type(AMBIGUOUS_QUERIES[0]);
		await page.keyboard.press("Enter");
		await waitForSearchReady(page, AMBIGUOUS_QUERIES[0]);
		await expect(
			page
				.locator(
					'.items-selector-shell--counter-dialog [data-testid^="pos-item-row-"]',
				)
				.first(),
		).toBeVisible({ timeout: 30_000 });
		await assertSeriousAndCriticalAxeClean(
			page,
			"pharmacy-search",
			".counter-item-search-surface",
		);
	});

	test("has no serious or critical axe violations in item sales history", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await waitForCounterGrid(page);
		await addOneItemAndReturnToEntry(page);
		await page.keyboard.press("F12");
		await expect(page.getByTestId("item-history-modal")).toBeVisible({
			timeout: 30_000,
		});
		await assertSeriousAndCriticalAxeClean(
			page,
			"item-sales-history",
			'[data-testid="item-history-modal"]',
		);
	});

	test("has no serious or critical axe violations in quick edit when permitted", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await waitForCounterGrid(page);
		await addOneItemAndReturnToEntry(page);
		await page.keyboard.press("F12");
		const updateItem = page.getByTestId("item-workspace-update-item");
		await expect(page.getByTestId("item-history-modal")).toBeVisible({
			timeout: 30_000,
		});
		test.skip(
			!(await updateItem.isVisible()),
			"Current cashier/profile does not permit Item quick edit.",
		);
		await updateItem.click();
		await expect(page.getByTestId("item-quick-edit-modal")).toBeVisible({
			timeout: 30_000,
		});
		await assertSeriousAndCriticalAxeClean(
			page,
			"item-quick-edit",
			'[data-testid="item-quick-edit-modal"]',
		);
	});

	test("has no serious or critical axe violations in payment", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await waitForCounterGrid(page);
		await addOneItemAndReturnToEntry(page);
		await openPaymentByKeyboard(page);
		await assertSeriousAndCriticalAxeClean(
			page,
			"payment",
			'[data-testid="payment-root"]',
		);
	});
});

for (const viewport of [
	{ width: 1024, height: 768 },
	{ width: 1280, height: 720 },
]) {
	test(`keeps focus visible without page overflow at 200% zoom (${viewport.width}x${viewport.height})`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await waitForCounterGrid(page);
		await page.addStyleTag({ content: "html { zoom: 2 !important; }" });
		await expect(page.getByTestId("counter-grid-item-entry")).toBeVisible();
		await assertNoPageHorizontalOverflow(page);
		await assertFocusedEntryInsideViewport(page);
	});

	test(`keeps focus visible without page overflow in forced colors (${viewport.width}x${viewport.height})`, async ({
		page,
	}) => {
		await page.emulateMedia({ forcedColors: "active" });
		await page.setViewportSize(viewport);
		await waitForCounterGrid(page);
		await assertNoPageHorizontalOverflow(page);
		await assertFocusedEntryInsideViewport(page);
		await expect(page.getByTestId("counter-grid-item-entry")).toHaveCSS(
			"forced-color-adjust",
			"auto",
		);
	});
}
