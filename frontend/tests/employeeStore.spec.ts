import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useEmployeeStore } from "../src/posapp/stores/employeeStore";

describe("employeeStore", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		(globalThis as any).frappe = {
			session: {
				user: "cashier@example.com",
				user_fullname: "Main Cashier",
			},
		};
	});

	it("starts locked and accepts cashier identity only from server terminal state", () => {
		const store = useEmployeeStore();

		store.setTerminalEmployees([
			{
				user: "cashier@example.com",
				full_name: "Main Cashier",
			},
			{
				user: "backup@example.com",
				full_name: "Backup Cashier",
			},
		]);

		expect(store.currentCashier).toBeNull();
		expect(store.isLocked).toBe(true);

		store.applyTerminalState({
			pos_profile: "Main POS",
			active_cashier: "backup@example.com",
			locked: false,
		});

		expect(store.currentCashier?.user).toBe("backup@example.com");
		expect(store.currentCashierDisplay).toBe("Backup Cashier");
	});

	it("opens switch flow only after authoritative unlock and fails closed", () => {
		const store = useEmployeeStore();
		store.setTerminalEmployees([
			{ user: "cashier@example.com", full_name: "Main Cashier" },
		]);

		store.openEmployeeSwitch();
		expect(store.switchDialogOpen).toBe(false);

		store.applyTerminalState({
			active_cashier: "cashier@example.com",
			locked: false,
		});
		store.openEmployeeSwitch();
		expect(store.switchDialogOpen).toBe(true);

		store.lockTerminal();
		expect(store.switchDialogOpen).toBe(false);
		expect(store.lockDialogOpen).toBe(true);
		expect(store.isLocked).toBe(true);

		store.applyTerminalState(null);
		expect(store.lockDialogOpen).toBe(true);
		expect(store.isLocked).toBe(true);
	});

	it("does not derive authority from the browser session or employee list", () => {
		const store = useEmployeeStore();

		store.setTerminalEmployees([
			{
				user: "cashier@example.com",
				full_name: "Main Cashier",
				is_supervisor: true,
			},
		]);

		expect(store.currentCashier).toBeNull();
		expect(store.isLocked).toBe(true);

		expect(() =>
			store.applyVerifiedCashier({
				user: "cashier@example.com",
				full_name: "Main Cashier",
				is_supervisor: true,
				terminal_state: {
					active_cashier: "attacker@example.com",
					locked: false,
				},
			}),
		).toThrow("server did not confirm");
	});

	it("fails closed while loading cashiers and ignores stale profile results", () => {
		const store = useEmployeeStore();

		store.beginTerminalEmployeesLoad("Main POS");
		expect(store.terminalEmployeesLoadStatus).toBe("loading");
		expect(store.terminalEmployees).toEqual([]);
		expect(store.isLocked).toBe(true);

		store.beginTerminalEmployeesLoad("Backup POS");
		expect(
			store.completeTerminalEmployeesLoad("Main POS", [
				{
					user: "stale@example.com",
					full_name: "Stale Cashier",
				},
			]),
		).toBe(false);
		expect(store.terminalEmployees).toEqual([]);

		expect(
			store.completeTerminalEmployeesLoad("Backup POS", [
				{
					user: "backup@example.com",
					full_name: "Backup Cashier",
				},
			]),
		).toBe(true);
		expect(store.terminalEmployeesLoadStatus).toBe("ready");
		expect(store.terminalEmployees.map((cashier) => cashier.user)).toEqual([
			"backup@example.com",
		]);

		store.resetTerminalEmployeesLoad();
		expect(store.terminalEmployeesLoadStatus).toBe("idle");
		expect(store.terminalEmployeesProfile).toBe("");
		expect(store.terminalEmployees).toEqual([]);
	});

	it("clears cashier identities when loading fails", () => {
		const store = useEmployeeStore();
		store.setTerminalEmployees([
			{ user: "cashier@example.com", full_name: "Main Cashier" },
		]);
		store.beginTerminalEmployeesLoad("Main POS");

		expect(
			store.failTerminalEmployeesLoad(
				"Main POS",
				"Unable to load authorized cashiers.",
			),
		).toBe(true);
		expect(store.terminalEmployees).toEqual([]);
		expect(store.currentCashier).toBeNull();
		expect(store.terminalEmployeesLoadStatus).toBe("error");
		expect(store.terminalEmployeesLoadError).toContain("Unable to load");
	});

	it("keeps the last successful cashier list usable while the same profile refreshes", () => {
		const store = useEmployeeStore();
		store.beginTerminalEmployeesLoad("Main POS");
		store.completeTerminalEmployeesLoad("Main POS", [
			{ user: "cashier@example.com", full_name: "Main Cashier" },
		]);

		store.beginTerminalEmployeesLoad("Main POS");

		expect(store.terminalEmployeesLoadStatus).toBe("loading");
		expect(store.terminalEmployees.map((cashier) => cashier.user)).toEqual([
			"cashier@example.com",
		]);
		expect(store.isLocked).toBe(true);

		store.failTerminalEmployeesLoad("Main POS", "Refresh failed.");
		expect(store.terminalEmployees.map((cashier) => cashier.user)).toEqual([
			"cashier@example.com",
		]);
		expect(store.terminalEmployeesLoadStatus).toBe("error");
	});

	it("hydrates a cached cashier list when a profile starts after a page reload", () => {
		const store = useEmployeeStore();

		store.beginTerminalEmployeesLoad("Main POS", [
			{ user: "cached@example.com", full_name: "Cached Cashier" },
		]);

		expect(store.terminalEmployeesLoadStatus).toBe("loading");
		expect(store.terminalEmployees.map((cashier) => cashier.user)).toEqual([
			"cached@example.com",
		]);
		expect(store.isLocked).toBe(true);
	});

	it("resolves a pending invoice unlock only after unlock or explicit cancellation", async () => {
		const store = useEmployeeStore();
		store.setTerminalEmployees([
			{
				user: "cashier@example.com",
				full_name: "Main Cashier",
				pin_length: 4,
			},
		]);

		const cancelledUnlock = store.requestTerminalUnlock();
		expect(store.invoiceUnlockPending).toBe(true);
		store.cancelPendingInvoiceSubmission();
		await expect(cancelledUnlock).resolves.toBe(false);
		expect(store.isLocked).toBe(true);

		const successfulUnlock = store.requestTerminalUnlock();
		store.unlockTerminal({
			user: "cashier@example.com",
			full_name: "Main Cashier",
			terminal_state: {
				active_cashier: "cashier@example.com",
				locked: false,
			},
		});
		await expect(successfulUnlock).resolves.toBe(true);
		expect(store.invoiceUnlockPending).toBe(false);
		expect(store.isLocked).toBe(false);
	});
});
