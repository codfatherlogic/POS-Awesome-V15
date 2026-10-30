import { expect, test, type Page, type Route } from "@playwright/test";

import { gotoAuthenticatedPos } from "./helpers/sessionAuth";
import {
	cleanupProvisionedTerminalCashier,
	ensureAuthoritativeTerminalUnlock,
	unlockTerminalDialogIfVisible,
} from "./helpers/terminalAuth";

const ENABLED = process.env.POSA_STARTUP_RECOVERY_E2E === "1";
const POS_PATH = process.env.POSA_SMOKE_PATH || "/desk/posapp";
const CASHIER_API =
	"**/api/method/posawesome.posawesome.api.employees.get_terminal_employees";
const CATALOG_APIS = [
	"**/api/method/posawesome.posawesome.api.items.get_items",
	"**/api/method/posawesome.posawesome.api.items.get_hot_items",
];

test.skip(
	!ENABLED,
	"Set POSA_STARTUP_RECOVERY_E2E=1 to run live startup recovery E2E.",
);

const wait = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getProfileName(page: Page) {
	const navbar = page.locator('[data-test="pos-navbar"]');
	await expect(navbar).toHaveAttribute("data-pos-profile", /\S+/, {
		timeout: 90_000,
	});
	const profileName = String(
		(await navbar.getAttribute("data-pos-profile")) || "",
	).trim();
	if (!profileName)
		throw new Error("Live POS E2E has no active POS Profile.");
	return profileName;
}

test.afterEach(async ({ page }) => {
	await page.unrouteAll({ behavior: "ignoreErrors" });
	await unlockTerminalDialogIfVisible(page).catch(() => null);
	await cleanupProvisionedTerminalCashier(page).catch(() => null);
});

test("slow cashier authorization fails closed, then Retry recovers", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await gotoAuthenticatedPos(page, POS_PATH);
	await ensureAuthoritativeTerminalUnlock(page);
	const profileName = await getProfileName(page);

	await page.evaluate(async (posProfile) => {
		await (window as any).frappe.call({
			method: "posawesome.posawesome.api.employees.lock_terminal",
			args: { pos_profile: posProfile },
		});
	}, profileName);

	let delayedRequest = false;
	await page.route(CASHIER_API, async (route) => {
		if (delayedRequest) {
			await route.continue();
			return;
		}
		delayedRequest = true;
		await wait(21_000);
		await route.continue();
	});

	await page.reload({ waitUntil: "domcontentloaded" });
	const lockDialog = page.locator('[data-test="terminal-lock-dialog"]');
	await expect(lockDialog).toBeVisible({ timeout: 30_000 });
	await expect(
		lockDialog.locator('[data-test="terminal-cashier-loading"]'),
	).toBeVisible();
	await expect(
		lockDialog.locator('[data-test="terminal-cashier-error"]'),
	).toBeVisible({ timeout: 25_000 });
	await expect(
		lockDialog.locator('[data-test="terminal-cashier-retry"]'),
	).toBeVisible();

	const lockedState = await page.evaluate(async (posProfile) => {
		const response = await (window as any).frappe.call({
			method: "posawesome.posawesome.api.employees.get_terminal_state",
			args: { pos_profile: posProfile },
		});
		return response?.message;
	}, profileName);
	expect(lockedState?.locked).toBe(true);

	await lockDialog.locator('[data-test="terminal-cashier-retry"]').click();
	await expect(
		lockDialog.locator('[data-test^="terminal-unlock-cashier-"]').first(),
	).toBeVisible({ timeout: 30_000 });
	await unlockTerminalDialogIfVisible(page);
	await expect(lockDialog).toBeHidden({ timeout: 30_000 });
});

test("slow catalog releases the startup overlay while loading continues", async ({
	page,
}) => {
	test.setTimeout(150_000);
	let catalogRequests = 0;
	let activeCatalogRequests = 0;
	const holdCatalogRequest = async (route: Route) => {
		catalogRequests += 1;
		activeCatalogRequests += 1;
		await wait(30_000);
		activeCatalogRequests -= 1;
		await route.continue();
	};
	for (const api of CATALOG_APIS) {
		await page.route(api, holdCatalogRequest);
	}

	await gotoAuthenticatedPos(page, POS_PATH);
	await expect
		.poll(() => catalogRequests, { timeout: 30_000 })
		.toBeGreaterThan(0);
	await expect(page.locator(".loading-overlay")).toHaveCount(0, {
		timeout: 25_000,
	});
	expect(activeCatalogRequests).toBeGreaterThan(0);
	await expect(page.locator(".main-section").first()).toBeVisible();
});
