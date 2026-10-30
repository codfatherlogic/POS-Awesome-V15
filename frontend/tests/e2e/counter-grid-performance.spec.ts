import { writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import {
	cleanupProvisionedTerminalCashier,
	clickWithTerminalUnlockRetry,
	ensureAuthoritativeTerminalUnlock,
	unlockTerminalDialogIfVisible,
} from "./helpers/terminalAuth";

const ENABLED = process.env.POSA_COUNTER_GRID_PERF_E2E === "1";
const POS_PATH = process.env.POSA_SMOKE_PATH || "/desk/posapp";
const PROFILE =
	process.env.POSA_COUNTER_GRID_POS_PROFILE || "POS Awesome - MedPlus";
const ITEM_CODE = process.env.POSA_COUNTER_GRID_PERF_ITEM || "02017";
const SEARCH_QUERY = process.env.POSA_COUNTER_GRID_PERF_SEARCH || "arinac";
const SAMPLE_COUNT = Math.max(
	1,
	Number(process.env.POSA_COUNTER_GRID_PERF_RUNS || 30),
);
const WARMUP_COUNT = 2;
const P95_LIMIT_MS = Number(
	process.env.POSA_COUNTER_GRID_SUBMISSION_P95_MS || 2000,
);
const SEARCH_P95_LIMIT_MS = Number(
	// Transitional 2026-07-13 release gate; optimization runs can override this
	// with 1000 without weakening live stock freshness in production.
	process.env.POSA_COUNTER_GRID_SEARCH_P95_MS || 2000,
);

test.skip(
	!ENABLED,
	"Set POSA_COUNTER_GRID_PERF_E2E=1 to run real submission performance tests.",
);

test.afterEach(async ({ page }) => {
	await cleanupProvisionedTerminalCashier(page);
});

async function callFrappe<T = any>(
	page: Page,
	method: string,
	args: Record<string, unknown> = {},
) {
	return page.evaluate(
		async ({ callMethod, callArgs }) => {
			const response = await (window as any).frappe.call({
				method: callMethod,
				args: callArgs,
			});
			return response?.message;
		},
		{ callMethod: method, callArgs: args },
	) as Promise<T>;
}

async function waitForPos(page: Page) {
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	if (/\/login/.test(page.url())) {
		throw new Error(
			"Counter Grid performance E2E requires POSA_SMOKE_SID or login credentials.",
		);
	}
	await ensureAuthoritativeTerminalUnlock(page);
	await expect(page.getByTestId("counter-grid-pos")).toBeVisible({
		timeout: 90_000,
	});
	await expect(page.locator(".loading-overlay")).toHaveCount(0, {
		timeout: 90_000,
	});
}

async function addSingleItem(page: Page) {
	const entry = page.getByTestId("counter-grid-item-entry");
	await entry.fill(ITEM_CODE);
	await entry.press("Enter");
	const search = page.getByTestId("pos-item-search").locator("input");
	const cartRow = page.getByTestId(`cart-row-${ITEM_CODE}`).first();
	const outcome = await Promise.race([
		cartRow
			.waitFor({ state: "visible", timeout: 30_000 })
			.then(() => "direct"),
		search
			.waitFor({ state: "visible", timeout: 30_000 })
			.then(() => "dialog"),
	]);
	if (outcome === "direct") return;

	await expect(search).toBeFocused({ timeout: 15_000 });
	await expect(
		page.locator(".items-selector-shell--counter-dialog"),
	).toHaveAttribute("data-search-ready-query", ITEM_CODE, {
		timeout: 30_000,
	});
	const result = page.getByTestId(`pos-item-row-${ITEM_CODE}`);
	await expect(result).toBeVisible({ timeout: 30_000 });
	await expect(result).toHaveAttribute("aria-selected", "true");
	await search.press("Enter");
	await expect(cartRow).toBeVisible({ timeout: 30_000 });
}

async function establishWarmOnlineState(page: Page) {
	await page.evaluate(() => {
		(window as any).serverOnline = true;
	});
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						navigator.onLine &&
						(window as any).serverOnline === true,
				),
			{ timeout: 15_000 },
		)
		.toBe(true);
}

async function findSubmittedInvoiceByRequestId(
	page: Page,
	doctype: string,
	requestId: string,
) {
	const rows = await callFrappe<
		Array<{ name: string; posa_client_request_id: string }>
	>(page, "frappe.client.get_list", {
		doctype,
		filters: {
			docstatus: 1,
			posa_client_request_id: requestId,
		},
		fields: ["name", "posa_client_request_id"],
		limit_page_length: 1,
	});
	return rows?.[0] || null;
}

async function hasInvoiceOutboxEntry(page: Page, requestId: string) {
	return page.evaluate(
		async ({ databaseName, clientRequestId }) => {
			const database = await new Promise<IDBDatabase>(
				(resolve, reject) => {
					const request = indexedDB.open(databaseName);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				},
			);
			try {
				if (!database.objectStoreNames.contains("invoice_outbox")) {
					return false;
				}
				return await new Promise<boolean>((resolve, reject) => {
					const transaction = database.transaction(
						"invoice_outbox",
						"readonly",
					);
					const index = transaction
						.objectStore("invoice_outbox")
						.index("client_request_id");
					const request = index.get(clientRequestId);
					request.onsuccess = () => resolve(Boolean(request.result));
					request.onerror = () => reject(request.error);
				});
			} finally {
				database.close();
			}
		},
		{
			databaseName: "posawesome_offline",
			clientRequestId: requestId,
		},
	);
}

async function hasDurableInvoiceIntent(page: Page, requestId: string) {
	const journaled = await page.evaluate(
		(id) =>
			localStorage.getItem(
				`posa_invoice_intent_${encodeURIComponent(id)}`,
			) !== null,
		requestId,
	);
	return journaled || hasInvoiceOutboxEntry(page, requestId);
}

async function resolveInvoiceDoctype(page: Page) {
	const profile = await callFrappe<Record<string, any>>(
		page,
		"frappe.client.get_value",
		{
			doctype: "POS Profile",
			filters: { name: PROFILE },
			fieldname: ["create_pos_invoice_instead_of_sales_invoice"],
		},
	);
	return Number(profile?.create_pos_invoice_instead_of_sales_invoice || 0)
		? "POS Invoice"
		: "Sales Invoice";
}

async function cancelInvoice(page: Page, doctype: string, name: string) {
	if (!name) return;
	await callFrappe(page, "frappe.client.cancel", { doctype, name });
}

function percentile95(values: number[]) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0;
}

function percentile50(values: number[]) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)] || 0;
}

test("warm server-backed item search stays below the p95 target", async ({
	page,
}) => {
	test.setTimeout(5 * 60_000);
	await page.setViewportSize({ width: 1280, height: 720 });
	await waitForPos(page);
	const samples: Array<{
		run: number;
		warmup: boolean;
		latencyMs: number;
		searchDurationMs: number;
		resultCount: number;
	}> = [];

	for (let run = 0; run < WARMUP_COUNT + SAMPLE_COUNT; run += 1) {
		const entry = page.getByTestId("counter-grid-item-entry");
		await entry.fill(SEARCH_QUERY);
		const startedAt = await page.evaluate(() => performance.now());
		await entry.press("Enter");

		const selector = page.locator(".items-selector-shell--counter-dialog");
		await expect(selector).toHaveAttribute(
			"data-search-ready-query",
			SEARCH_QUERY,
			{ timeout: 30_000 },
		);
		const finishedAt = await page.evaluate(() => performance.now());
		const details = await page.evaluate((query) => {
			const rows = document.querySelectorAll(
				'[data-testid^="pos-item-row-"]',
			).length;
			const entries = performance
				.getEntriesByType("resource")
				.filter(
					(entry) =>
						entry.name.includes(
							"posawesome.posawesome.api.items.get_items",
						) &&
						entry.startTime >=
							performance.timeOrigin - performance.timeOrigin,
				);
			const latest = entries.at(-1);
			return {
				query,
				resultCount: rows,
				searchDurationMs: latest?.duration || 0,
			};
		}, SEARCH_QUERY);

		expect(details.resultCount).toBeGreaterThan(0);
		samples.push({
			run: run + 1,
			warmup: run < WARMUP_COUNT,
			latencyMs: Number((finishedAt - startedAt).toFixed(2)),
			searchDurationMs: Number(details.searchDurationMs.toFixed(2)),
			resultCount: details.resultCount,
		});

		await page.getByRole("button", { name: "Close item search" }).click();
		await expect(entry).toBeFocused({ timeout: 15_000 });
	}

	const measured = samples
		.filter((sample) => !sample.warmup)
		.map((sample) => sample.latencyMs);
	const p95Ms = percentile95(measured);
	const report = {
		profile: PROFILE,
		query: SEARCH_QUERY,
		warmupCount: WARMUP_COUNT,
		sampleCount: measured.length,
		p95LimitMs: SEARCH_P95_LIMIT_MS,
		p50Ms: percentile50(measured),
		p95Ms,
		minMs: Math.min(...measured),
		maxMs: Math.max(...measured),
		averageMs: Number(
			(
				measured.reduce((total, value) => total + value, 0) /
				measured.length
			).toFixed(2),
		),
		samples,
	};
	await writeFile(
		"test-results/counter-grid-search-performance.json",
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	);

	expect(
		p95Ms,
		`Warm server-backed search p95 ${p95Ms}ms exceeded ${SEARCH_P95_LIMIT_MS}ms.`,
	).toBeLessThanOrEqual(SEARCH_P95_LIMIT_MS);
});

test("warm one-item cash submission stays below the p95 target", async ({
	page,
}) => {
	test.setTimeout(15 * 60_000);
	await page.setViewportSize({ width: 1280, height: 720 });
	await waitForPos(page);
	const invoiceDoctype = await resolveInvoiceDoctype(page);
	await page.evaluate(() => {
		(window as any).__posaSubmissionPerfEvents = [];
		(window as any).__posaSubmissionDispatchEvents = [];
		window.addEventListener(
			"posa:invoice-submit-dispatched",
			(event: Event) => {
				(window as any).__posaSubmissionDispatchEvents.push(
					(event as CustomEvent).detail,
				);
			},
		);
		window.addEventListener(
			"posa:invoice-submit-response",
			(event: Event) => {
				(window as any).__posaSubmissionPerfEvents.push(
					(event as CustomEvent).detail,
				);
			},
		);
	});
	const samples: Array<{
		run: number;
		warmup: boolean;
		latencyMs: number;
		invoice: string;
		requestId: string;
		dispatchLatencyMs?: number;
		responseLatencyMs?: number;
		uiFinalizeMs?: number;
		wasSubmitted?: boolean;
		queued?: boolean;
		docstatus?: number;
		status?: number;
		ledgerState?: string;
	}> = [];
	const uncancelled = new Set<string>();

	try {
		for (let run = 0; run < WARMUP_COUNT + SAMPLE_COUNT; run += 1) {
			await establishWarmOnlineState(page);
			await addSingleItem(page);
			await unlockTerminalDialogIfVisible(page);
			await clickWithTerminalUnlockRetry(
				page,
				page.getByTestId("invoice-action-pay"),
			);
			const paymentRoot = page.getByTestId("payment-root");
			await expect(paymentRoot).toBeVisible({ timeout: 30_000 });
			const submit = page.getByTestId("payment-submit");
			await expect(submit).toBeEnabled({ timeout: 15_000 });
			await establishWarmOnlineState(page);

			const eventCount = await page.evaluate(
				() => (window as any).__posaSubmissionPerfEvents.length,
			);
			const dispatchCount = await page.evaluate(
				() => (window as any).__posaSubmissionDispatchEvents.length,
			);
			const startedAt = await page.evaluate(() => performance.now());
			await submit.click();
			await expect
				.poll(
					() =>
						page.evaluate(
							() =>
								(window as any).__posaSubmissionDispatchEvents
									.length,
						),
					{ timeout: 15_000 },
				)
				.toBeGreaterThan(dispatchCount);
			await expect
				.poll(
					() =>
						page.evaluate(
							() =>
								(window as any).__posaSubmissionPerfEvents
									.length,
						),
					{ timeout: 30_000 },
				)
				.toBeGreaterThan(eventCount);
			const response = await page.evaluate(
				(index) => (window as any).__posaSubmissionPerfEvents[index],
				eventCount,
			);
			const dispatch = await page.evaluate(
				(index) =>
					(window as any).__posaSubmissionDispatchEvents[index],
				dispatchCount,
			);
			expect(response.requestId).toBeTruthy();
			expect(response.invoice).toBeTruthy();
			await expect(paymentRoot).toBeHidden({ timeout: 30_000 });
			const entry = page.getByTestId("counter-grid-item-entry");
			await expect(entry).toBeVisible({
				timeout: 30_000,
			});
			await expect(entry).toHaveValue("");
			await expect(entry).toBeFocused();
			await expect(
				page.locator('[data-testid^="cart-row-"]'),
			).toHaveCount(0);
			if (!response.wasSubmitted) {
				expect(
					await hasDurableInvoiceIntent(page, response.requestId),
				).toBe(true);
			}
			const finishedAt = await page.evaluate(() => performance.now());

			let submittedInvoice: Awaited<
				ReturnType<typeof findSubmittedInvoiceByRequestId>
			> = null;
			await expect
				.poll(
					async () => {
						submittedInvoice =
							await findSubmittedInvoiceByRequestId(
								page,
								invoiceDoctype,
								response.requestId,
							);
						return submittedInvoice?.name || "";
					},
					{ timeout: 60_000 },
				)
				.toBe(response.invoice);
			const invoiceName = submittedInvoice?.name || "";
			uncancelled.add(invoiceName);

			samples.push({
				run: run + 1,
				warmup: run < WARMUP_COUNT,
				latencyMs: Number((finishedAt - startedAt).toFixed(2)),
				invoice: invoiceName,
				requestId: response.requestId,
				dispatchLatencyMs: Number(
					(dispatch.timestamp - startedAt).toFixed(2),
				),
				responseLatencyMs: Number(
					(response.timestamp - dispatch.timestamp).toFixed(2),
				),
				uiFinalizeMs: Number(
					(finishedAt - response.timestamp).toFixed(2),
				),
				wasSubmitted: response.wasSubmitted,
				queued: response.queued,
				docstatus: response.docstatus,
				status: response.status,
				ledgerState: response.ledgerState,
			});

			await cancelInvoice(page, invoiceDoctype, invoiceName);
			uncancelled.delete(invoiceName);
		}
	} finally {
		for (const invoiceName of uncancelled) {
			await cancelInvoice(page, invoiceDoctype, invoiceName).catch(
				() => {},
			);
		}
	}

	const measured = samples
		.filter((sample) => !sample.warmup)
		.map((sample) => sample.latencyMs);
	const p95Ms = percentile95(measured);
	const report = {
		profile: PROFILE,
		itemCode: ITEM_CODE,
		invoiceDoctype,
		warmupCount: WARMUP_COUNT,
		sampleCount: measured.length,
		p95LimitMs: P95_LIMIT_MS,
		p50Ms: percentile50(measured),
		p95Ms,
		minMs: Math.min(...measured),
		maxMs: Math.max(...measured),
		averageMs: Number(
			(
				measured.reduce((total, value) => total + value, 0) /
				measured.length
			).toFixed(2),
		),
		samples,
	};
	await writeFile(
		"test-results/counter-grid-submission-performance.json",
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	);

	expect(
		p95Ms,
		`Warm one-item submission p95 ${p95Ms}ms exceeded ${P95_LIMIT_MS}ms.`,
	).toBeLessThanOrEqual(P95_LIMIT_MS);
});
