import { describe, expect, it, vi } from "vitest";

import { validate } from "../src/posapp/components/pos/invoice_utils/validation";

(globalThis as any).__ = (text: string) => text;

describe("invoice batch/serial payment validation", () => {
	it("blocks payment and opens the selector for the first incomplete row", async () => {
		const show = vi.fn();
		const emit = vi.fn();
		const item = {
			posa_row_id: "ROW-1",
			item_code: "TRACKED",
			has_batch_no: 1,
			qty: 1,
			conversion_factor: 1,
			batch_no_data: [{ batch_no: "B-1", available_qty: 2 }],
		};
		const result = await validate({
			invoiceType: "Invoice",
			isReturnInvoice: false,
			items: [item],
			toastStore: { show },
			eventBus: { emit },
		});

		expect(result).toBe(false);
		expect(show).toHaveBeenCalled();
		expect(emit).toHaveBeenCalledWith(
			"open_batch_serial_selector",
			"ROW-1",
		);
	});

	it("does not require stock assignment for an order", async () => {
		const result = await validate({
			invoiceType: "Order",
			isReturnInvoice: false,
			items: [{ item_code: "TRACKED", has_batch_no: 1, qty: 1 }],
			toastStore: { show: vi.fn() },
			eventBus: { emit: vi.fn() },
		});

		expect(result).toBe(true);
	});
});
