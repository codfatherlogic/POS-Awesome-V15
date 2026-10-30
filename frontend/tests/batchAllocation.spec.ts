import { describe, expect, it } from "vitest";

import {
	allocateBatchStockQty,
	createBatchAllocationLines,
	selectSerialsForBatchAllocations,
} from "../src/posapp/composables/pos/shared/batchAllocation";

describe("multi-batch allocation", () => {
	it("allocates the requested stock quantity across FEFO-ordered batches", () => {
		const result = allocateBatchStockQty(
			[
				{ batch_no: "B-1", available_qty: 2 },
				{ batch_no: "B-2", available_qty: 4 },
			],
			5,
		);

		expect(result).toEqual({
			allocations: [
				{ batchNo: "B-1", stockQty: 2 },
				{ batchNo: "B-2", stockQty: 3 },
			],
			unallocatedStockQty: 0,
		});
	});

	it("reports an unallocated remainder instead of over-allocating the last batch", () => {
		const result = allocateBatchStockQty(
			[
				{ batch_no: "B-1", available_qty: 1 },
				{ batch_no: "B-2", available_qty: 2 },
			],
			5,
		);

		expect(result.allocations).toEqual([
			{ batchNo: "B-1", stockQty: 1 },
			{ batchNo: "B-2", stockQty: 2 },
		]);
		expect(result.unallocatedStockQty).toBe(2);
	});

	it("splits allocations into ERPNext rows while preserving the sales UOM", () => {
		const lines = createBatchAllocationLines(
			{
				name: "existing-child-row",
				posa_row_id: "ROW-1",
				item_code: "BOXED-ITEM",
				qty: 2,
				conversion_factor: 6,
				rate: 10,
				base_rate: 10,
			},
			[
				{ batchNo: "B-1", stockQty: 5 },
				{ batchNo: "B-2", stockQty: 7 },
			],
		);

		expect(lines).toHaveLength(2);
		expect(
			lines.map((line) => [line.batch_no, line.qty, line.stock_qty]),
		).toEqual([
			["B-1", 5 / 6, 5],
			["B-2", 7 / 6, 7],
		]);
		expect(lines[0].name).toBe("existing-child-row");
		expect(lines[1].name).toBeUndefined();
		expect(lines[1].posa_row_id).not.toBe("ROW-1");
	});

	it("keeps serial numbers on the row for their own batch", () => {
		const lines = createBatchAllocationLines(
			{
				posa_row_id: "ROW-1",
				item_code: "SERIAL-BATCH",
				has_serial_no: 1,
				qty: 2,
				conversion_factor: 1,
				serial_no_data: [
					{ serial_no: "S-1", batch_no: "B-1" },
					{ serial_no: "S-2", batch_no: "B-2" },
				],
			},
			[
				{ batchNo: "B-1", stockQty: 1 },
				{ batchNo: "B-2", stockQty: 1 },
			],
			["S-1", "S-2"],
		);

		expect(lines[0].serial_no_selected).toEqual(["S-1"]);
		expect(lines[1].serial_no_selected).toEqual(["S-2"]);
	});

	it("automatically fills serials for every manually allocated batch", () => {
		const selected = selectSerialsForBatchAllocations(
			{
				serial_no_data: [
					{ serial_no: "S-1", batch_no: "B-1" },
					{ serial_no: "S-2", batch_no: "B-1" },
					{ serial_no: "S-3", batch_no: "B-2" },
					{ serial_no: "S-4", batch_no: "B-2" },
				],
			},
			[
				{ batchNo: "B-1", stockQty: 1 },
				{ batchNo: "B-2", stockQty: 2 },
			],
			["S-2"],
		);

		expect(selected).toEqual(["S-2", "S-3", "S-4"]);
	});

	it("does not reuse serials selected on another cart row", () => {
		const selected = selectSerialsForBatchAllocations(
			{
				serial_no_data: [
					{ serial_no: "S-USED", batch_no: "B-1" },
					{ serial_no: "S-FREE", batch_no: "B-1" },
				],
			},
			[{ batchNo: "B-1", stockQty: 1 }],
			[],
			new Set(["S-USED"]),
		);

		expect(selected).toEqual(["S-FREE"]);
	});
});
