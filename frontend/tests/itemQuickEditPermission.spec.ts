import { describe, expect, it } from "vitest";

import { canShowItemQuickEdit } from "../src/posapp/utils/itemQuickEditPermission";

const context = (user: string, roles: string[]) => ({
	session: { user },
	boot: { user: { roles } },
});

describe("item quick edit visibility", () => {
	it("hides quick edit from guests and ordinary cashiers", () => {
		expect(
			canShowItemQuickEdit(
				{ posa_allow_item_quick_edit: 1 },
				context("Guest", ["POS Awesome Supervisor"]),
			),
		).toBe(false);
		expect(
			canShowItemQuickEdit(
				{ posa_allow_item_quick_edit: 1 },
				context("cashier@example.com", ["POS Awesome User"]),
			),
		).toBe(false);
	});

	it("requires the profile flag for a POS supervisor", () => {
		expect(
			canShowItemQuickEdit(
				{ posa_allow_item_quick_edit: 0 },
				context("supervisor@example.com", ["POS Awesome Supervisor"]),
			),
		).toBe(false);
		expect(
			canShowItemQuickEdit(
				{ posa_allow_item_quick_edit: 1 },
				context("supervisor@example.com", ["POS Awesome Supervisor"]),
			),
		).toBe(true);
	});

	it("matches the server privileged-role bypass", () => {
		for (const role of ["System Manager", "Stock Manager", "Item Manager"]) {
			expect(
				canShowItemQuickEdit(
					{ posa_allow_item_quick_edit: 0 },
					context("manager@example.com", [role]),
				),
			).toBe(true);
		}
	});
});
