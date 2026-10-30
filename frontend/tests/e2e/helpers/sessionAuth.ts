import type { Page } from "@playwright/test";

function isLoginRoute(url: string) {
	try {
		return new URL(url).pathname === "/login";
	} catch {
		return /\/login(?:[/?#]|$)/.test(url);
	}
}

export async function gotoAuthenticatedPos(page: Page, posPath: string) {
	await page.goto(posPath, { waitUntil: "domcontentloaded" });
	if (!isLoginRoute(page.url())) return;

	const username = process.env.POSA_SMOKE_USER?.trim();
	const password = process.env.POSA_SMOKE_PASSWORD;
	if (!username || !password) {
		throw new Error(
			"Live POS E2E requires POSA_SMOKE_SID or POSA_SMOKE_USER and POSA_SMOKE_PASSWORD.",
		);
	}

	const userInput = page
		.locator('input[name="login_email"], input#login_email')
		.first();
	const passwordInput = page
		.locator('input[name="login_password"], input#login_password')
		.first();
	const loginButton = page
		.locator("button.btn-login")
		.or(page.getByRole("button", { name: /^(?:Log In|Login)$/i }))
		.first();

	await userInput.fill(username);
	await passwordInput.fill(password);
	await Promise.all([
		page.waitForURL((url) => !isLoginRoute(url.toString()), {
			timeout: 60_000,
		}),
		loginButton.click(),
	]);

	await page.goto(posPath, { waitUntil: "domcontentloaded" });
	if (isLoginRoute(page.url())) {
		throw new Error(
			"Frappe login completed without an authenticated POS session.",
		);
	}
}
