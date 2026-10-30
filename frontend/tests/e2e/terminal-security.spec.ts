import { expect, test } from "@playwright/test";

import { gotoAuthenticatedPos } from "./helpers/sessionAuth";

const ENABLED = process.env.POSA_TERMINAL_SECURITY_E2E === "1";
const POS_PATH = process.env.POSA_SMOKE_PATH || "/desk/posapp";

test.skip(
	!ENABLED,
	"Set POSA_TERMINAL_SECURITY_E2E=1 to run terminal security E2E.",
);

test("reload and localStorage cannot bypass a server-locked terminal", async ({
	page,
}) => {
	await gotoAuthenticatedPos(page, POS_PATH);

	const lockDialog = page.locator('[data-test="terminal-lock-dialog"]');
	await expect(lockDialog).toBeVisible({
		timeout: 90_000,
	});
	const navbar = page.locator('[data-test="pos-navbar"]');
	await expect(navbar).toHaveAttribute("data-pos-profile", /\S+/, {
		timeout: 90_000,
	});
	const profileName = String(
		(await navbar.getAttribute("data-pos-profile")) || "",
	).trim();
	if (!profileName) {
		throw new Error(
			"Terminal lock dialog opened without an active POS Profile.",
		);
	}
	const authorizedCashiers = await page.evaluate(async (posProfile) => {
		const response = await (window as any).frappe.call({
			method: "posawesome.posawesome.api.employees.get_terminal_employees",
			args: { pos_profile: posProfile },
		});
		return Array.isArray(response?.message) ? response.message : [];
	}, profileName);
	await expect(
		lockDialog.locator('[data-test="terminal-cashier-loading"]'),
	).toBeHidden({
		timeout: 30_000,
	});
	await expect(
		lockDialog.locator('[data-test="terminal-cashier-error"]'),
	).toBeHidden();
	const cashierOptions = lockDialog.locator(
		'[data-test^="terminal-unlock-cashier-"]',
	);
	if (authorizedCashiers.length) {
		await expect(cashierOptions).toHaveCount(authorizedCashiers.length);
		await expect(cashierOptions.first()).toBeVisible();
		await expect(cashierOptions.first()).toHaveClass(
			/employee-switch-dialog__option--active/,
		);
		await expect(
			lockDialog.locator('[data-test="terminal-unlock-pin"]'),
		).toBeVisible();
	} else {
		await expect(
			lockDialog.locator('[data-test="terminal-cashier-empty"]'),
		).toBeVisible();
		await expect(
			lockDialog.locator('[data-test="terminal-unlock-pin"]'),
		).toBeHidden();
	}
	const forgedCashier = "forged-local-cashier@example.invalid";
	await page.evaluate((cashier) => {
		localStorage.setItem("posa_terminal_cashier", cashier);
	}, forgedCashier);
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(lockDialog).toBeVisible({
		timeout: 90_000,
	});

	const result = await page.evaluate(async () => {
		const frappe = (window as any).frappe;
		const profileResponse = await frappe.call({
			method: "posawesome.posawesome.api.utils.get_active_pos_profile",
		});
		const profile = profileResponse?.message;
		const stateResponse = await frappe.call({
			method: "posawesome.posawesome.api.employees.get_terminal_state",
			args: { pos_profile: profile?.name },
		});

		let mutationError = "";
		try {
			await frappe.call({
				method: "posawesome.posawesome.api.gift_cards.top_up_gift_card",
				args: {
					pos_profile: profile?.name,
					cashier: "Administrator",
					gift_card_code: "E2E-NOT-A-REAL-GIFT-CARD",
					amount: 1,
				},
			});
		} catch (error: any) {
			const serialized = (() => {
				try {
					return JSON.stringify(error);
				} catch {
					return "";
				}
			})();
			mutationError = `${String(
				error?.message || error?.exc || error?.exception || "",
			)} ${serialized}`;
		}

		return {
			state: stateResponse?.message,
			mutationError,
		};
	});

	expect(result.state?.locked).toBe(true);
	expect(result.state?.active_cashier || null).not.toBe(forgedCashier);
	expect(result.mutationError).toContain("POS terminal is locked");
});
