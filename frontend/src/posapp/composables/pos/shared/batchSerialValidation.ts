import {
	batchAllocationEpsilon,
	getBatchAllocationTotal,
	getBatchAvailableStockQty,
	getItemRequiredStockQty,
	normalizeBatchAllocations,
	type BatchAllocation,
} from "./batchAllocation";

export interface BatchSerialValidationIssue {
	code: string;
	message: string;
	item?: any;
}

export interface BatchSerialSelection {
	batchNo?: string | null;
	allocations?: BatchAllocation[];
	serials?: string[];
}

const normalizeSerials = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value
			.map((serial) => String(serial || "").trim())
			.filter(Boolean);
	}
	return String(value || "")
		.split("\n")
		.map((serial) => serial.trim())
		.filter(Boolean);
};

export const getSelectedSerials = (item: any): string[] => {
	if (Array.isArray(item?.serial_no_selected)) {
		return normalizeSerials(item.serial_no_selected);
	}
	return normalizeSerials(item?.serial_no);
};

export const getRequiredStockQuantity = (item: any): number => {
	return getItemRequiredStockQty(item);
};

const getBatchAvailableQuantity = getBatchAvailableStockQty;

export const validateBatchSerialSelection = (
	item: any,
	selection: BatchSerialSelection = {},
	options: { isReturnInvoice?: boolean } = {},
): BatchSerialValidationIssue[] => {
	const issues: BatchSerialValidationIssue[] = [];
	const batchNo = String(selection.batchNo ?? item?.batch_no ?? "").trim();
	const allocations = selection.allocations
		? normalizeBatchAllocations(selection.allocations)
		: [];
	const serials = normalizeSerials(
		selection.serials ?? getSelectedSerials(item),
	);
	const requiredStockQty = getRequiredStockQuantity(item);

	if (item?.has_batch_no) {
		if (selection.allocations) {
			if (!allocations.length) {
				issues.push({
					code: "batch_required",
					message: `Batch is required for ${item.item_name || item.item_code}`,
					item,
				});
			} else {
				const allocationTotal = getBatchAllocationTotal(allocations);
				if (
					Math.abs(allocationTotal - requiredStockQty) >
					batchAllocationEpsilon
				) {
					issues.push({
						code: "batch_allocation_mismatch",
						message: `${item.item_name || item.item_code}: allocate ${requiredStockQty} stock unit(s); ${allocationTotal} allocated`,
						item,
					});
				}

				const batchRows = Array.isArray(item.batch_no_data)
					? item.batch_no_data
					: [];
				for (const allocation of allocations) {
					const selectedBatch = batchRows.find(
						(batch: any) =>
							String(batch?.batch_no || "") ===
							allocation.batchNo,
					);
					if (!selectedBatch) {
						issues.push({
							code: "batch_unavailable",
							message: `Batch ${allocation.batchNo} is not available for ${item.item_name || item.item_code}`,
							item,
						});
						continue;
					}
					if (selectedBatch.is_expired) {
						issues.push({
							code: "batch_expired",
							message: `Batch ${allocation.batchNo} is expired`,
							item,
						});
					}
					if (
						!options.isReturnInvoice &&
						getBatchAvailableQuantity(selectedBatch) +
							batchAllocationEpsilon <
							allocation.stockQty
					) {
						issues.push({
							code: "batch_insufficient",
							message: `Batch ${allocation.batchNo} has only ${getBatchAvailableQuantity(selectedBatch)} available; ${allocation.stockQty} allocated`,
							item,
						});
					}
				}
			}
		} else if (!batchNo) {
			issues.push({
				code: "batch_required",
				message: `Batch is required for ${item.item_name || item.item_code}`,
				item,
			});
		} else {
			const batchRows = Array.isArray(item.batch_no_data)
				? item.batch_no_data
				: [];
			const selectedBatch = batchRows.find(
				(batch: any) => String(batch?.batch_no || "") === batchNo,
			);
			if (selectedBatch?.is_expired || item.batch_no_is_expired) {
				issues.push({
					code: "batch_expired",
					message: `Batch ${batchNo} is expired`,
					item,
				});
			}
			if (
				selectedBatch &&
				!options.isReturnInvoice &&
				getBatchAvailableQuantity(selectedBatch) + Number.EPSILON <
					requiredStockQty
			) {
				issues.push({
					code: "batch_insufficient",
					message: `Batch ${batchNo} has only ${getBatchAvailableQuantity(selectedBatch)} available; ${requiredStockQty} required`,
					item,
				});
			}
		}
	}

	if (item?.has_serial_no) {
		if (!Number.isInteger(requiredStockQty)) {
			issues.push({
				code: "serial_quantity_invalid",
				message: `Serialized item ${item.item_name || item.item_code} requires a whole-number stock quantity`,
				item,
			});
		} else if (serials.length !== requiredStockQty) {
			issues.push({
				code: "serial_count_mismatch",
				message: `${item.item_name || item.item_code}: select ${requiredStockQty} serial number(s); ${serials.length} selected`,
				item,
			});
		}

		if (new Set(serials).size !== serials.length) {
			issues.push({
				code: "serial_duplicate",
				message: `${item.item_name || item.item_code}: duplicate serial numbers are not allowed`,
				item,
			});
		}

		const serialRows = Array.isArray(item.serial_no_data)
			? item.serial_no_data
			: [];
		if (serialRows.length) {
			const bySerial = new Map(
				serialRows
					.filter((row: any) => row?.serial_no)
					.map((row: any) => [String(row.serial_no), row]),
			);
			for (const serial of serials) {
				const row: any = bySerial.get(serial);
				if (!row) {
					issues.push({
						code: "serial_unavailable",
						message: `Serial ${serial} is not available for ${item.item_name || item.item_code}`,
						item,
					});
					continue;
				}
				const selectedBatchNos = selection.allocations
					? new Set(
							allocations.map((allocation) => allocation.batchNo),
						)
					: new Set(batchNo ? [batchNo] : []);
				if (
					selectedBatchNos.size &&
					row.batch_no &&
					!selectedBatchNos.has(String(row.batch_no))
				) {
					issues.push({
						code: "serial_batch_mismatch",
						message: `Serial ${serial} does not belong to a selected batch`,
						item,
					});
				}
			}

			if (selection.allocations) {
				for (const allocation of allocations) {
					const selectedForBatch = serials.filter((serial) => {
						const row: any = bySerial.get(serial);
						return (
							String(row?.batch_no || "") === allocation.batchNo
						);
					}).length;
					if (selectedForBatch !== allocation.stockQty) {
						issues.push({
							code: "serial_batch_count_mismatch",
							message: `Batch ${allocation.batchNo}: select ${allocation.stockQty} serial number(s); ${selectedForBatch} selected`,
							item,
						});
					}
				}
			}
		}
	}

	return issues;
};

export const validateCartBatchSerialAssignments = (
	items: any[],
	options: { isReturnInvoice?: boolean } = {},
): BatchSerialValidationIssue[] => {
	const issues: BatchSerialValidationIssue[] = [];
	const usedSerials = new Map<string, any>();

	for (const item of Array.isArray(items) ? items : []) {
		issues.push(...validateBatchSerialSelection(item, {}, options));
		if (!item?.has_serial_no) continue;
		for (const serial of getSelectedSerials(item)) {
			const previous = usedSerials.get(serial);
			if (previous && previous?.posa_row_id !== item?.posa_row_id) {
				issues.push({
					code: "serial_used_in_cart",
					message: `Serial ${serial} is already selected on another cart line`,
					item,
				});
			} else {
				usedSerials.set(serial, item);
			}
		}
	}

	return issues;
};
