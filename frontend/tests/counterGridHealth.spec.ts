import { describe, expect, it } from "vitest";

import { buildCounterGridHealthItems } from "../src/posapp/utils/counterGridHealth";

const baseInput = {
	connectivityLabel: "Online",
	connectivityTone: "success",
	pendingInvoices: 0,
	capabilitySummaries: [],
	resourceStates: [],
	itemsLoaded: true,
	totalItemCount: 1200,
};

describe("Counter Grid health model", () => {
	it("shows a healthy online terminal from existing store state", () => {
		const items = buildCounterGridHealthItems(baseInput);
		expect(items.map((item) => [item.id, item.label, item.tone])).toEqual([
			["connectivity", "Online", "success"],
			["pending", "Sales synced", "success"],
			["pricing", "Pricing pending", "info"],
			["stock", "Stock pending", "info"],
			["catalog", "1,200 items", "success"],
		]);
	});

	it("surfaces queued sales and policy-backed pricing and stock warnings", () => {
		const items = buildCounterGridHealthItems({
			...baseInput,
			connectivityLabel: "Limited",
			connectivityTone: "warning",
			pendingInvoices: 3,
			capabilitySummaries: [
				{
					id: "pricing_offline",
					status: "degraded",
					message: "Pricing data is incomplete.",
				},
				{
					id: "stock_confidence_offline",
					status: "blocked",
					message: "Stock must be refreshed.",
				},
			],
		});
		expect(items.find((item) => item.id === "pending")).toMatchObject({
			label: "3 pending",
			tone: "warning",
		});
		expect(items.find((item) => item.id === "pricing")).toMatchObject({
			label: "Pricing review",
			tone: "warning",
			detail: "Pricing data is incomplete.",
		});
		expect(items.find((item) => item.id === "stock")).toMatchObject({
			label: "Stock blocked",
			tone: "error",
		});
	});

	it("uses resource lifecycle state when capability summaries are unavailable", () => {
		const items = buildCounterGridHealthItems({
			...baseInput,
			resourceStates: [
				{
					resourceId: "item_prices",
					status: "fresh",
					lastSyncedAt: "2026-07-15",
				},
				{
					resourceId: "pricing_rules",
					status: "stale",
					lastSyncedAt: "2026-07-14",
				},
				{ resourceId: "stock", status: "syncing" },
				{
					resourceId: "items",
					status: "error",
					lastError: "Catalog failed",
				},
			],
		});
		expect(items.find((item) => item.id === "pricing")).toMatchObject({
			label: "Pricing stale",
			tone: "warning",
		});
		expect(items.find((item) => item.id === "stock")).toMatchObject({
			label: "Stock syncing",
			tone: "warning",
		});
		expect(items.find((item) => item.id === "catalog")).toMatchObject({
			label: "Catalog error",
			tone: "error",
			detail: "Catalog failed",
		});
	});
});
