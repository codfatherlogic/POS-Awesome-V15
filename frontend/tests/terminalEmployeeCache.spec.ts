// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
	getTerminalEmployeeCacheKey,
	loadCachedTerminalEmployees,
	saveCachedTerminalEmployees,
} from "../src/posapp/utils/terminalEmployeeCache";

describe("terminal employee cache", () => {
	beforeEach(() => window.localStorage.clear());

	it("restores a profile and session scoped cashier snapshot after reload", () => {
		saveCachedTerminalEmployees(
			"operator@example.com",
			"Main POS",
			[{ user: "cashier@example.com", full_name: "Main Cashier" }],
			window.localStorage,
			1_000,
		);

		expect(
			loadCachedTerminalEmployees(
				"operator@example.com",
				"Main POS",
				window.localStorage,
				2_000,
			),
		).toEqual([
			expect.objectContaining({
				user: "cashier@example.com",
				full_name: "Main Cashier",
			}),
		]);
		expect(
			loadCachedTerminalEmployees(
				"another@example.com",
				"Main POS",
				window.localStorage,
				2_000,
			),
		).toEqual([]);
	});

	it("drops expired or malformed snapshots", () => {
		const key = getTerminalEmployeeCacheKey("operator@example.com", "Main POS");
		window.localStorage.setItem(
			key,
			JSON.stringify({ version: 1, cached_at: 1, employees: [{ user: "old@example.com" }] }),
		);
		expect(
			loadCachedTerminalEmployees(
				"operator@example.com",
				"Main POS",
				window.localStorage,
				24 * 60 * 60 * 1_000 + 2,
			),
		).toEqual([]);
		expect(window.localStorage.getItem(key)).toBeNull();

		window.localStorage.setItem(key, "not-json");
		expect(
			loadCachedTerminalEmployees(
				"operator@example.com",
				"Main POS",
				window.localStorage,
			),
		).toEqual([]);
	});
});
