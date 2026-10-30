// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import invoiceShortcuts from "../src/posapp/components/pos/invoice/invoiceShortcuts";

const createAltEvent = (key: string, code?: string) =>
	new KeyboardEvent("keydown", {
		key,
		code: code || key,
		altKey: true,
		bubbles: true,
		cancelable: true,
	});

const createVm = () => ({
	toastStore: { show: vi.fn() },
	eventBus: { emit: vi.fn() },
	uiStore: {
		setActiveView: vi.fn(),
		triggerItemSearchFocus: vi.fn(),
		selectTopItem: vi.fn(),
		toggleItemSettings: vi.fn(),
	},
	$refs: {
		itemsTable: { focusItemField: vi.fn() },
	},
	items: [{ name: "Test Item" }],
	focusItemTableField: vi.fn(),
	enterInvoiceItemsGrid: vi.fn(),
	openItemWorkspace: vi.fn(),
	openItemQuickEdit: vi.fn(),
	focusItemSearchField: vi.fn(),
	getShortcutPaymentAmount: vi.fn(() => 125),
	confirmPaymentSubmission: vi.fn(async () => 150),
});

describe("invoiceShortcuts", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", { set_route: vi.fn() });
	});

	it("switches compact layout to the selector before focusing item search", async () => {
		const vm = createVm();
		const event = createAltEvent("3", "Digit3");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"set_compact_panel",
			"selector",
		);
		expect(vm.eventBus.emit).toHaveBeenCalledWith("focus_item_search");
		expect(vm.uiStore.setActiveView).toHaveBeenCalledWith("items");
		expect(vm.uiStore.triggerItemSearchFocus).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("queues Alt+X with the entered amount without printing", async () => {
		const vm = {
			...createVm(),
			show_payment: vi.fn(async () => {}),
		};
		const event = createAltEvent("x", "KeyX");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"queue_submit_payment_shortcut",
			{
				print: false,
				amount: 150,
			},
		);
	});

	it("uses F4 to open the employee switch flow", async () => {
		const vm = createVm();
		const event = new KeyboardEvent("keydown", {
			key: "F4",
			bubbles: true,
			cancelable: true,
		});

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith("open_employee_switch");
		expect(vm.toastStore.show).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it("uses F2 to focus the configured item-entry surface", async () => {
		const vm = createVm();
		const event = new KeyboardEvent("keydown", {
			key: "F2",
			bubbles: true,
			cancelable: true,
		});

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.focusItemSearchField).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("routes Alt+3 through the Counter Grid item modal", async () => {
		const vm = { ...createVm(), isCounterGridPresentation: true };
		const event = createAltEvent("3", "Digit3");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.focusItemSearchField).toHaveBeenCalledTimes(1);
		expect(vm.eventBus.emit).not.toHaveBeenCalledWith("focus_item_search");
		expect(event.defaultPrevented).toBe(true);
	});

	it("uses Alt or Option+G for unavailable cart alternates without replacing F9 pay", async () => {
		const vm = { ...createVm(), isCounterGridPresentation: true };
		const event = createAltEvent("g", "KeyG");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith("open_cart_alternates");
		expect(event.defaultPrevented).toBe(true);
	});

	it("does not consume Alt or Option+G outside Counter Grid", async () => {
		const vm = createVm();
		const event = createAltEvent("g", "KeyG");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).not.toHaveBeenCalledWith(
			"open_cart_alternates",
		);
		expect(event.defaultPrevented).toBe(false);
	});

	it("uses F8 to lock the POS screen", async () => {
		const vm = createVm();
		const event = new KeyboardEvent("keydown", {
			key: "F8",
			bubbles: true,
			cancelable: true,
		});

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith("lock_pos_screen");
		expect(vm.toastStore.show).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it("uses F12 to open the selected item workspace", async () => {
		const vm = createVm();
		const event = new KeyboardEvent("keydown", {
			key: "F12",
			bubbles: true,
			cancelable: true,
		});

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.openItemWorkspace).toHaveBeenCalledTimes(1);
		expect(vm.openItemQuickEdit).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it("uses Option+7 on macOS to open the selected item workspace", async () => {
		const originalPlatform = navigator.platform;
		const originalUserAgent = navigator.userAgent;
		Object.defineProperty(navigator, "platform", {
			value: "MacIntel",
			configurable: true,
		});
		Object.defineProperty(navigator, "userAgent", {
			value: "Macintosh",
			configurable: true,
		});
		const vm = {
			...createVm(),
			get_draft_orders: vi.fn(),
		};
		const event = createAltEvent("7", "Digit7");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.openItemWorkspace).toHaveBeenCalledTimes(1);
		expect(vm.openItemQuickEdit).not.toHaveBeenCalled();
		expect(vm.get_draft_orders).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);

		Object.defineProperty(navigator, "platform", {
			value: originalPlatform,
			configurable: true,
		});
		Object.defineProperty(navigator, "userAgent", {
			value: originalUserAgent,
			configurable: true,
		});
	});

	it("switches compact layout to the invoice before focusing cart quantity fields", async () => {
		const vm = createVm();
		const event = createAltEvent("q", "KeyQ");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"set_compact_panel",
			"invoice",
		);
		expect(vm.focusItemTableField).toHaveBeenCalledWith("qty");
		expect(event.defaultPrevented).toBe(true);
	});

	it("switches compact layout to the invoice before entering invoice table grid mode", async () => {
		const vm = createVm();
		const event = createAltEvent("ArrowRight", "ArrowRight");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"set_compact_panel",
			"invoice",
		);
		expect(vm.enterInvoiceItemsGrid).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("uses plain arrow keys outside text inputs to enter invoice table grid mode", async () => {
		const vm = createVm();
		const event = new KeyboardEvent("keydown", {
			key: "ArrowDown",
			code: "ArrowDown",
			bubbles: true,
			cancelable: true,
		});

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"set_compact_panel",
			"invoice",
		);
		expect(vm.enterInvoiceItemsGrid).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("does not steal plain arrow keys from text inputs", async () => {
		const vm = createVm();
		const input = document.createElement("input");
		const event = new KeyboardEvent("keydown", {
			key: "ArrowDown",
			code: "ArrowDown",
			bubbles: true,
			cancelable: true,
		});
		Object.defineProperty(event, "target", {
			value: input,
			configurable: true,
		});

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.enterInvoiceItemsGrid).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it("does not steal plain arrow keys from the item search field", async () => {
		const vm = createVm();
		const shell = document.createElement("div");
		shell.className = "search-field-shell";
		const field = document.createElement("div");
		field.setAttribute("data-pos-keyboard-target", "item-search");
		const input = document.createElement("input");
		field.appendChild(input);
		shell.appendChild(field);
		document.body.appendChild(shell);
		const event = new KeyboardEvent("keydown", {
			key: "ArrowDown",
			code: "ArrowDown",
			bubbles: true,
			cancelable: true,
		});
		Object.defineProperty(event, "target", {
			value: input,
			configurable: true,
		});

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.enterInvoiceItemsGrid).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
		shell.remove();
	});

	it("uses plain arrow keys from marked search fields to enter invoice table grid mode", async () => {
		const vm = createVm();
		const shell = document.createElement("div");
		shell.setAttribute("data-pos-arrow-enters-invoice-grid", "");
		const input = document.createElement("input");
		shell.appendChild(input);
		document.body.appendChild(shell);
		const event = new KeyboardEvent("keydown", {
			key: "ArrowDown",
			code: "ArrowDown",
			bubbles: true,
			cancelable: true,
		});
		Object.defineProperty(event, "target", {
			value: input,
			configurable: true,
		});

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"set_compact_panel",
			"invoice",
		);
		expect(vm.enterInvoiceItemsGrid).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
		shell.remove();
	});

	it("enters invoice table grid mode on the latest cart row", () => {
		const enterKeyboardGrid = vi.fn();
		const vm = {
			...createVm(),
			items: [{ name: "First Item" }, { name: "Second Item" }],
			$refs: {
				itemsTableRef: { enterKeyboardGrid },
			},
		};

		(invoiceShortcuts as any).enterInvoiceItemsGrid.call(vm);

		expect(enterKeyboardGrid).toHaveBeenCalledWith({
			rowIndex: 1,
			mode: "row",
		});
	});

	it("does not enter invoice table grid mode when the cart is empty", () => {
		const enterKeyboardGrid = vi.fn();
		const vm = {
			...createVm(),
			items: [],
			$refs: {
				itemsTableRef: { enterKeyboardGrid },
			},
		};

		(invoiceShortcuts as any).enterInvoiceItemsGrid.call(vm);

		expect(enterKeyboardGrid).not.toHaveBeenCalled();
	});

	it.each([["r", "KeyR", "rate"]])(
		"switches compact layout to the invoice before focusing %s cart fields",
		async (key, code, field) => {
			const vm = createVm();
			const event = createAltEvent(key, code);

			await (invoiceShortcuts as any).handleInvoiceShortcut.call(
				vm,
				event,
			);

			expect(vm.eventBus.emit).toHaveBeenCalledWith(
				"set_compact_panel",
				"invoice",
			);
			expect(vm.focusItemTableField).toHaveBeenCalledWith(field);
			expect(event.defaultPrevented).toBe(true);
		},
	);

	it("switches compact layout to the invoice and opens the uom selector", async () => {
		const vm = {
			...createVm(),
		};
		const event = createAltEvent("u", "KeyU");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"set_compact_panel",
			"invoice",
		);
		expect(vm.focusItemTableField).toHaveBeenCalledWith("uom");
		expect(event.defaultPrevented).toBe(true);
	});

	it("switches compact layout to the invoice and focuses the invoice item search field", async () => {
		const focusSearch = vi.fn();
		const vm = {
			...createVm(),
			$refs: {
				actionToolbar: {
					focusSearch,
				},
			},
		};
		const event = createAltEvent("f", "KeyF");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"set_compact_panel",
			"invoice",
		);
		expect(focusSearch).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("switches compact layout to payments before queueing submit and print", async () => {
		const vm = {
			...createVm(),
			show_payment: vi.fn(async () => {}),
			flushBackgroundUpdates: vi.fn(async () => {}),
			triggerBackgroundFlush: { flush: vi.fn() },
			schedulePricingRuleApplication: { flush: vi.fn() },
		};
		const event = createAltEvent("p", "KeyP");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"set_compact_panel",
			"selector",
		);
		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"queue_submit_payment_shortcut",
			{
				print: true,
				amount: 150,
			},
		);
		expect(vm.confirmPaymentSubmission).toHaveBeenCalledWith(125);
		expect(vm.show_payment).toHaveBeenCalledTimes(1);
		expect(vm.show_payment.mock.invocationCallOrder[0]).toBeLessThan(
			vm.eventBus.emit.mock.invocationCallOrder.find(
				(_: number, index: number) =>
					vm.eventBus.emit.mock.calls[index]?.[0] ===
					"queue_submit_payment_shortcut",
			) ?? Number.MAX_SAFE_INTEGER,
		);
		expect(event.defaultPrevented).toBe(true);
	});

	it("uses the rounded invoice total as the shortcut amount default", () => {
		const vm = {
			...createVm(),
			get_invoice_doc: vi.fn(() => ({
				rounded_total: 124.6,
				grand_total: 124.55,
			})),
		};

		const amount = (invoiceShortcuts as any).getShortcutPaymentAmount.call(
			vm,
		);

		expect(amount).toBe(124.6);
	});

	it("uses the customer section ref when selecting the first customer", async () => {
		const selectFirstCustomer = vi.fn();
		const vm = {
			...createVm(),
			$refs: {
				customerSection: {
					selectFirstCustomer,
				},
			},
		};
		const event = createAltEvent("6", "Digit6");

		await (invoiceShortcuts as any).handleInvoiceShortcut.call(vm, event);

		expect(vm.eventBus.emit).toHaveBeenCalledWith(
			"set_compact_panel",
			"invoice",
		);
		expect(selectFirstCustomer).toHaveBeenCalledTimes(1);
	});

	it("falls back to itemsTableRef when cycling cart field focus", () => {
		const focusItemField = vi.fn();
		const vm = {
			...createVm(),
			$refs: {
				itemsTableRef: { focusItemField },
			},
			shortcutCycle: { qty: 0, uom: 0, rate: 0 },
		};

		(invoiceShortcuts as any).focusItemTableField.call(vm, "qty");

		expect(focusItemField).toHaveBeenCalledWith(0, "qty");
	});
});
