import { describe, expect, it } from "vitest";

import {
	getRequiredStockQuantity,
	validateBatchSerialSelection,
	validateCartBatchSerialAssignments,
} from "../src/posapp/composables/pos/shared/batchSerialValidation";

describe("batch and serial assignment validation", () => {
	it("uses stock quantity when UOM has a conversion factor", () => {
		expect(getRequiredStockQuantity({ qty: 2, conversion_factor: 6 })).toBe(
			12,
		);
		expect(
			getRequiredStockQuantity({ qty: -2, conversion_factor: 6 }),
		).toBe(12);
	});

	it("requires a batch and enough available stock for a sale", () => {
		const item = {
			item_code: "BATCHED",
			item_name: "Batched Item",
			has_batch_no: 1,
			qty: 3,
			conversion_factor: 1,
			batch_no_data: [{ batch_no: "B-1", available_qty: 2 }],
		};

		expect(validateBatchSerialSelection(item)[0]?.code).toBe(
			"batch_required",
		);
		expect(
			validateBatchSerialSelection(item, { batchNo: "B-1" })[0]?.code,
		).toBe("batch_insufficient");
	});

	it("allows return selection without outgoing batch availability", () => {
		const issues = validateBatchSerialSelection(
			{
				item_code: "RETURN-BATCH",
				has_batch_no: 1,
				qty: -3,
				batch_no_data: [{ batch_no: "B-1", available_qty: 0 }],
			},
			{ batchNo: "B-1" },
			{ isReturnInvoice: true },
		);
		expect(issues).toEqual([]);
	});

	it("accepts an exact quantity allocated across multiple batches", () => {
		const issues = validateBatchSerialSelection(
			{
				item_code: "MULTI-BATCH",
				has_batch_no: 1,
				qty: 5,
				conversion_factor: 1,
				batch_no_data: [
					{ batch_no: "B-1", available_qty: 2 },
					{ batch_no: "B-2", available_qty: 3 },
				],
			},
			{
				allocations: [
					{ batchNo: "B-1", stockQty: 2 },
					{ batchNo: "B-2", stockQty: 3 },
				],
			},
		);

		expect(issues).toEqual([]);
	});

	it("rejects incomplete or overdrawn multi-batch allocations", () => {
		const item = {
			item_code: "MULTI-BATCH",
			has_batch_no: 1,
			qty: 5,
			conversion_factor: 1,
			batch_no_data: [
				{ batch_no: "B-1", available_qty: 2 },
				{ batch_no: "B-2", available_qty: 3 },
			],
		};
		const issues = validateBatchSerialSelection(item, {
			allocations: [
				{ batchNo: "B-1", stockQty: 3 },
				{ batchNo: "B-2", stockQty: 1 },
			],
		});

		expect(issues.map((issue) => issue.code)).toContain(
			"batch_allocation_mismatch",
		);
		expect(issues.map((issue) => issue.code)).toContain(
			"batch_insufficient",
		);
	});

	it("validates serial count and batch relationship", () => {
		const item = {
			item_code: "SERIALIZED",
			has_batch_no: 1,
			has_serial_no: 1,
			batch_no: "B-1",
			qty: 2,
			conversion_factor: 1,
			batch_no_data: [{ batch_no: "B-1", available_qty: 5 }],
			serial_no_data: [
				{ serial_no: "S-1", batch_no: "B-1" },
				{ serial_no: "S-2", batch_no: "B-2" },
			],
		};

		const issues = validateBatchSerialSelection(item, {
			batchNo: "B-1",
			serials: ["S-1", "S-2"],
		});
		expect(
			issues.some((issue) => issue.code === "serial_batch_mismatch"),
		).toBe(true);
	});

	it("rejects the same serial on two cart rows", () => {
		const rows = ["ROW-1", "ROW-2"].map((rowId) => ({
			posa_row_id: rowId,
			item_code: "SERIALIZED",
			has_serial_no: 1,
			qty: 1,
			conversion_factor: 1,
			serial_no_selected: ["S-1"],
			serial_no_data: [{ serial_no: "S-1" }],
		}));

		const issues = validateCartBatchSerialAssignments(rows);
		expect(
			issues.some((issue) => issue.code === "serial_used_in_cart"),
		).toBe(true);
	});
});
