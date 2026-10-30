import { randomInt } from "node:crypto";

import { expect, type Locator, type Page } from "@playwright/test";

type TerminalEmployee = {
	user: string;
	is_current?: boolean;
};

type ProvisionedCashier = {
	profileName: string;
	user: string;
	pin: string;
	previousPin: string | null;
	createdUser: boolean;
};

const provisionedCashiers = new WeakMap<Page, ProvisionedCashier>();

async function provisionTemporaryCashier(page: Page, profileName: string) {
	const user =
		process.env.POSA_E2E_PROVISIONED_CASHIER?.trim() ||
		`posa-e2e-${Date.now()}-${randomInt(100000, 1000000)}@retailmind.invalid`;
	const pin = String(randomInt(1000, 10000));

	const provisionResult = await page.evaluate(
		async ({ posProfile, cashierUser, cashierPin }) => {
			const call = async (
				method: string,
				args: Record<string, unknown>,
			) => {
				try {
					return await (window as any).frappe.call({ method, args });
				} catch (error: any) {
					const message =
						error?._server_messages ||
						error?.message ||
						error?.exc ||
						error?.exception ||
						JSON.stringify(error);
					throw new Error(String(message));
				}
			};
			let userDoc: any = null;
			try {
				userDoc = (
					await call("frappe.client.get", {
						doctype: "User",
						name: cashierUser,
					})
				)?.message;
			} catch {
				userDoc = null;
			}
			let createdUser = false;
			const originalPin = userDoc?.posa_pos_pin
				? String(userDoc.posa_pos_pin)
				: null;

			if (!userDoc) {
				createdUser = true;
				await call("frappe.client.insert", {
					doc: {
						doctype: "User",
						email: cashierUser,
						first_name: "POS E2E Cashier",
						enabled: 1,
						send_welcome_email: 0,
						posa_pos_pin: cashierPin,
						roles: [{ role: "POS Awesome Supervisor" }],
					},
				});
			} else {
				userDoc.enabled = 1;
				userDoc.send_welcome_email = 0;
				userDoc.posa_pos_pin = cashierPin;
				await call("frappe.client.save", { doc: userDoc });
			}

			await call("frappe.client.insert", {
				doc: {
					doctype: "POS Profile User",
					parent: posProfile,
					parenttype: "POS Profile",
					parentfield: "applicable_for_users",
					user: cashierUser,
					default: 1,
				},
			});
			return { previousPin: originalPin, createdUser };
		},
		{ posProfile: profileName, cashierUser: user, cashierPin: pin },
	);

	provisionedCashiers.set(page, {
		profileName,
		user,
		pin,
		previousPin: provisionResult.previousPin,
		createdUser: provisionResult.createdUser,
	});
	return { user, pin };
}

async function unlockVisibleTerminalDialog(
	page: Page,
	cashierUser: string,
	pin: string,
) {
	const lockDialog = page.locator('[data-test="terminal-lock-dialog"]');
	await lockDialog
		.waitFor({ state: "visible", timeout: 10_000 })
		.catch(() => null);
	if (!(await lockDialog.isVisible().catch(() => false))) {
		return;
	}

	const cashierOption = lockDialog
		.locator(".employee-switch-dialog__option")
		.filter({ hasText: cashierUser })
		.first();
	await cashierOption
		.waitFor({ state: "visible", timeout: 3_000 })
		.catch(() => null);
	if (!(await cashierOption.isVisible().catch(() => false))) {
		return;
	}
	const clicked = await cashierOption
		.click({ timeout: 3_000 })
		.then(() => true)
		.catch(() => false);
	if (!clicked) {
		return;
	}
	await expect(cashierOption).toHaveClass(
		/employee-switch-dialog__option--active/,
		{ timeout: 5_000 },
	);
	await lockDialog.getByRole("textbox", { name: "Cashier PIN" }).fill(pin);
	await page.getByRole("button", { name: /^Unlock POS$/ }).click();
	await expect(lockDialog).toBeHidden({ timeout: 30_000 });
}

export async function unlockTerminalDialogIfVisible(page: Page) {
	const lockDialog = page.locator('[data-test="terminal-lock-dialog"]');
	if (!(await lockDialog.isVisible().catch(() => false))) {
		return;
	}

	const provisioned = provisionedCashiers.get(page);
	const cashierUser =
		process.env.POSA_E2E_CASHIER?.trim() || provisioned?.user || "";
	const pin =
		process.env.POSA_E2E_CASHIER_PIN?.trim() || provisioned?.pin || "";
	if (!cashierUser || !pin) {
		throw new Error(
			"Terminal dialog appeared but no E2E cashier credentials are available.",
		);
	}

	await unlockVisibleTerminalDialog(page, cashierUser, pin);
}

export async function clickWithTerminalUnlockRetry(
	page: Page,
	target: Locator,
) {
	let lastError: unknown = null;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		await unlockTerminalDialogIfVisible(page);
		try {
			await target.click({ timeout: 3_000 });
			return;
		} catch (error) {
			lastError = error;
			if (
				!(await page
					.locator('[data-test="terminal-lock-dialog"]')
					.isVisible()
					.catch(() => false))
			) {
				throw error;
			}
		}
	}
	await unlockTerminalDialogIfVisible(page);
	await target.click({ timeout: 10_000 }).catch((error) => {
		throw lastError || error;
	});
}

export async function cleanupProvisionedTerminalCashier(page: Page) {
	const provisioned = provisionedCashiers.get(page);
	if (!provisioned || page.isClosed()) return;
	provisionedCashiers.delete(page);

	await page.evaluate(
		async ({ posProfile, cashierUser, previousPin, createdUser }) => {
			const call = (method: string, args: Record<string, unknown>) =>
				(window as any).frappe.call({ method, args });
			try {
				await call(
					"posawesome.posawesome.api.employees.lock_terminal",
					{
						pos_profile: posProfile,
					},
				);
			} catch {
				// Continue cleanup; missing state is fail-closed.
			}
			if (createdUser) {
				const assignments = (
					await call("frappe.client.get_list", {
						doctype: "POS Profile User",
						filters: { parent: posProfile, user: cashierUser },
						fields: ["name"],
						limit_page_length: 100,
					})
				)?.message;
				for (const assignment of assignments || []) {
					await call("frappe.client.delete", {
						doctype: "POS Profile User",
						name: assignment.name,
					}).catch(() => null);
				}
				try {
					await call("frappe.client.delete", {
						doctype: "User",
						name: cashierUser,
					});
				} catch {
					await call("frappe.client.set_value", {
						doctype: "User",
						name: cashierUser,
						fieldname: "enabled",
						value: 0,
					}).catch(() => null);
					await call("frappe.client.set_value", {
						doctype: "User",
						name: cashierUser,
						fieldname: "posa_pos_pin",
						value: "",
					}).catch(() => null);
				}
			} else {
				await call("frappe.client.set_value", {
					doctype: "User",
					name: cashierUser,
					fieldname: "posa_pos_pin",
					value: previousPin || "",
				});
			}
		},
		{
			posProfile: provisioned.profileName,
			cashierUser: provisioned.user,
			previousPin: provisioned.previousPin,
			createdUser: provisioned.createdUser,
		},
	);
}

export async function ensureAuthoritativeTerminalUnlock(page: Page) {
	await page.waitForFunction(
		() => Boolean((window as any).frappe?.call),
		null,
		{
			timeout: 30_000,
		},
	);

	const navbar = page.locator('[data-test="pos-navbar"]');
	await expect(navbar).toHaveAttribute("data-pos-profile", /\S+/, {
		timeout: 90_000,
	});
	const profileName = String(
		(await navbar.getAttribute("data-pos-profile")) || "",
	).trim();
	if (!profileName) {
		throw new Error(
			"No authorized POS Profile is available for terminal E2E.",
		);
	}

	const currentState = await page.evaluate(async (posProfile) => {
		const response = await (window as any).frappe.call({
			method: "posawesome.posawesome.api.employees.get_terminal_state",
			args: { pos_profile: posProfile },
		});
		return response?.message;
	}, profileName);
	const shouldProvisionCashier =
		process.env.POSA_E2E_PROVISION_CASHIER === "1";
	if (
		currentState?.locked === false &&
		currentState?.active_cashier &&
		!shouldProvisionCashier
	) {
		await expect(
			page.locator('[data-test="terminal-lock-dialog"]'),
		).toBeHidden({
			timeout: 30_000,
		});
		return currentState;
	}
	if (
		currentState?.locked === false &&
		currentState?.active_cashier &&
		shouldProvisionCashier
	) {
		await page.evaluate(async (posProfile) => {
			await (window as any).frappe.call({
				method: "posawesome.posawesome.api.employees.lock_terminal",
				args: { pos_profile: posProfile },
			});
		}, profileName);
	}

	let pin = process.env.POSA_E2E_CASHIER_PIN?.trim();
	let configuredCashier = process.env.POSA_E2E_CASHIER?.trim();
	if (!pin && shouldProvisionCashier) {
		const provisioned = await provisionTemporaryCashier(page, profileName);
		pin = provisioned.pin;
		configuredCashier = provisioned.user;
	}
	if (!pin) {
		throw new Error(
			"Terminal E2E is locked. Set POSA_E2E_CASHIER_PIN in frontend/.env.local or the process environment.",
		);
	}

	const employees = await page.evaluate(async (posProfile) => {
		const response = await (window as any).frappe.call({
			method: "posawesome.posawesome.api.employees.get_terminal_employees",
			args: { pos_profile: posProfile },
		});
		return Array.isArray(response?.message)
			? (response.message as TerminalEmployee[])
			: [];
	}, profileName);
	const cashier = configuredCashier
		? employees.find((employee) => employee.user === configuredCashier)
		: employees.find((employee) => employee.is_current) || employees[0];
	if (!cashier?.user) {
		throw new Error("No assigned cashier is available for terminal E2E.");
	}

	const verified = await page.evaluate(
		async ({ posProfile, user, cashierPin }) => {
			const response = await (window as any).frappe.call({
				method: "posawesome.posawesome.api.employees.verify_terminal_employee_pin",
				args: {
					pos_profile: posProfile,
					user,
					pin: cashierPin,
				},
			});
			return response?.message;
		},
		{ posProfile: profileName, user: cashier.user, cashierPin: pin },
	);
	if (
		verified?.terminal_state?.locked !== false ||
		verified?.terminal_state?.active_cashier !== cashier.user
	) {
		throw new Error("The server did not confirm the E2E terminal cashier.");
	}

	await page.reload({ waitUntil: "domcontentloaded" });
	await unlockVisibleTerminalDialog(page, cashier.user, pin);
	const unlockedState = await page.evaluate(async (posProfile) => {
		const response = await (window as any).frappe.call({
			method: "posawesome.posawesome.api.employees.get_terminal_state",
			args: { pos_profile: posProfile },
		});
		return response?.message;
	}, profileName);
	if (
		unlockedState?.locked !== false ||
		unlockedState?.active_cashier !== cashier.user
	) {
		throw new Error("The server did not keep the E2E terminal unlocked.");
	}
	const lockDialog = page.locator('[data-test="terminal-lock-dialog"]');
	await expect(lockDialog)
		.toBeHidden({ timeout: 5_000 })
		.catch(async () => {
			await page.reload({ waitUntil: "domcontentloaded" });
			await unlockTerminalDialogIfVisible(page);
			await expect(lockDialog).toBeHidden({ timeout: 30_000 });
		});
	return unlockedState;
}
