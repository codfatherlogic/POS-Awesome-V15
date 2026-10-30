import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../src/offline/index", () => ({
	isOffline: vi.fn(() => false),
	memoryInitPromise: Promise.resolve(),
	savePricingRulesSnapshot: vi.fn(),
	getCachedPricingRulesSnapshot: vi.fn(() => null),
	clearPricingRulesSnapshot: vi.fn(),
}));

import {
	getCachedPricingRulesSnapshot,
	isOffline,
} from "../src/offline/index";
import { usePricingRulesStore } from "../src/posapp/stores/pricingRulesStore";

describe("pricing rules store request coordination", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isOffline).mockReturnValue(false);
		vi.mocked(getCachedPricingRulesSnapshot).mockReturnValue(null);
		setActivePinia(createPinia());
	});

	it("hydrates the durable pricing snapshot before an offline refresh lookup", async () => {
		(globalThis as any).frappe = { call: vi.fn() };
		const context = JSON.stringify({
			company: "Test Co",
			price_list: "Retail",
			currency: "USD",
			customer: "",
			customer_group: "",
			territory: "",
			date: "2026-07-21",
		});
		vi.mocked(isOffline).mockReturnValue(true);
		vi.mocked(getCachedPricingRulesSnapshot).mockReturnValue({
			snapshot: [{ name: "OFFLINE-TXN", apply_on: "Transaction" }],
			context,
			lastSync: "2026-07-21T00:00:00.000Z",
			staleAt: "2026-07-22T00:00:00.000Z",
		} as any);

		const store = usePricingRulesStore();
		await store.ensureActiveRules({
			company: "Test Co",
			price_list: "Retail",
			currency: "USD",
			date: "2026-07-21",
		});

		expect(store.rules.map((rule) => rule.name)).toEqual(["OFFLINE-TXN"]);
		expect((globalThis as any).frappe?.call).not.toHaveBeenCalled();
	});

	it("deduplicates concurrent requests for the same pricing context", async () => {
		let resolveRequest: ((_value: unknown) => void) | null = null;
		const call = vi.fn(
			() =>
				new Promise((resolve) => {
					resolveRequest = resolve as (_value: unknown) => void;
				}),
		);
		(globalThis as any).frappe = { call };
		const store = usePricingRulesStore();
		const context = {
			company: "Test Co",
			price_list: "Retail",
			currency: "USD",
		};

		const first = store.ensureActiveRules(context);
		const second = store.ensureActiveRules(context);

		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
		resolveRequest?.({ message: [{ name: "RULE-1" }] });
		await Promise.all([first, second]);
		expect(store.rules).toHaveLength(1);
	});

	it("does not let an older context response overwrite the latest snapshot", async () => {
		const resolvers: Array<(_value: unknown) => void> = [];
		const call = vi.fn(
			() =>
				new Promise((resolve) => {
					resolvers.push(resolve as (_value: unknown) => void);
				}),
		);
		(globalThis as any).frappe = { call };
		const store = usePricingRulesStore();

		const first = store.ensureActiveRules({
			company: "Test Co",
			price_list: "Retail",
			currency: "USD",
			customer: "CUST-OLD",
		});
		const second = store.ensureActiveRules({
			company: "Test Co",
			price_list: "Retail",
			currency: "USD",
			customer: "CUST-NEW",
		});

		await vi.waitFor(() => expect(resolvers).toHaveLength(2));
		resolvers[1]({ message: [{ name: "NEW-RULE" }] });
		await second;
		resolvers[0]({ message: [{ name: "OLD-RULE" }] });
		await first;

		expect(store.rules.map((rule) => rule.name)).toEqual(["NEW-RULE"]);
		expect(store.contextKey).toContain("CUST-NEW");
	});
});
