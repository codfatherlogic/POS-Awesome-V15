export interface BatchAllocation {
	batchNo: string;
	stockQty: number;
}

export interface BatchAllocationResult {
	allocations: BatchAllocation[];
	unallocatedStockQty: number;
}

const EPSILON = 1e-9;

export const getBatchAvailableStockQty = (batch: any): number => {
	const value = Number(
		batch?.available_qty ??
			batch?.remaining_qty ??
			batch?.batch_qty ??
			batch?.original_batch_qty,
	);
	return Number.isFinite(value) ? Math.max(value, 0) : 0;
};

export const getItemConversionFactor = (item: any): number => {
	const value = Number(item?.conversion_factor || 1);
	return Number.isFinite(value) && value > 0 ? value : 1;
};

export const getItemRequiredStockQty = (item: any): number => {
	const qty = Number(item?.qty);
	return Number.isFinite(qty)
		? Math.abs(qty) * getItemConversionFactor(item)
		: 0;
};

export const allocateBatchStockQty = (
	batches: any[],
	requiredStockQty: number,
): BatchAllocationResult => {
	let remaining = Math.max(Number(requiredStockQty) || 0, 0);
	const allocations: BatchAllocation[] = [];

	for (const batch of Array.isArray(batches) ? batches : []) {
		if (remaining <= EPSILON) break;
		const batchNo = String(batch?.batch_no || "").trim();
		if (!batchNo || batch?.is_expired) continue;
		const available = getBatchAvailableStockQty(batch);
		if (available <= EPSILON) continue;
		const stockQty = Math.min(available, remaining);
		allocations.push({ batchNo, stockQty });
		remaining -= stockQty;
	}

	return {
		allocations,
		unallocatedStockQty: remaining <= EPSILON ? 0 : remaining,
	};
};

export const normalizeBatchAllocations = (
	allocations: BatchAllocation[] | undefined | null,
): BatchAllocation[] => {
	const totals = new Map<string, number>();
	for (const allocation of Array.isArray(allocations) ? allocations : []) {
		const batchNo = String(allocation?.batchNo || "").trim();
		const stockQty = Number(allocation?.stockQty);
		if (!batchNo || !Number.isFinite(stockQty) || stockQty <= EPSILON)
			continue;
		totals.set(batchNo, (totals.get(batchNo) || 0) + stockQty);
	}
	return Array.from(totals, ([batchNo, stockQty]) => ({ batchNo, stockQty }));
};

export const getBatchAllocationTotal = (
	allocations: BatchAllocation[] | undefined | null,
): number =>
	normalizeBatchAllocations(allocations).reduce(
		(total, allocation) => total + allocation.stockQty,
		0,
	);

export const selectSerialsForBatchAllocations = (
	item: any,
	allocations: BatchAllocation[],
	currentSerials: string[] = [],
	unavailableSerials: Set<string> = new Set(),
): string[] => {
	const serialRows = Array.isArray(item?.serial_no_data)
		? item.serial_no_data
		: [];
	const normalizedCurrent = currentSerials
		.map((serial) => String(serial || "").trim())
		.filter(Boolean);
	const rowBySerial = new Map(
		serialRows
			.filter((row: any) => row?.serial_no)
			.map((row: any) => [String(row.serial_no), row]),
	);
	const selected: string[] = [];
	const selectedSet = new Set<string>();

	for (const allocation of normalizeBatchAllocations(allocations)) {
		const requiredCount = Number.isInteger(allocation.stockQty)
			? allocation.stockQty
			: 0;
		if (requiredCount <= 0) continue;

		const candidates = serialRows
			.filter(
				(row: any) =>
					String(row?.batch_no || "") === allocation.batchNo,
			)
			.map((row: any) => String(row.serial_no || "").trim())
			.filter(
				(serial: string) =>
					serial &&
					!unavailableSerials.has(serial) &&
					!selectedSet.has(serial),
			);
		const candidateSet = new Set(candidates);
		const preserved = normalizedCurrent.filter((serial) => {
			const row: any = rowBySerial.get(serial);
			return (
				String(row?.batch_no || "") === allocation.batchNo &&
				candidateSet.has(serial) &&
				!selectedSet.has(serial)
			);
		});
		const chosen = preserved.slice(0, requiredCount);
		for (const serial of candidates) {
			if (chosen.length >= requiredCount) break;
			if (!chosen.includes(serial)) chosen.push(serial);
		}
		for (const serial of chosen) {
			selected.push(serial);
			selectedSet.add(serial);
		}
	}

	return selected;
};

const createRowId = () =>
	Math.random().toString(36).substring(2, 12) +
	Math.random().toString(36).substring(2, 12);

const serialsForBatch = (item: any, serials: string[], batchNo: string) => {
	const serialRows = Array.isArray(item?.serial_no_data)
		? item.serial_no_data
		: [];
	const serialBatch = new Map(
		serialRows
			.filter((row: any) => row?.serial_no)
			.map((row: any) => [
				String(row.serial_no),
				String(row.batch_no || ""),
			]),
	);
	return serials.filter((serial) => {
		const knownBatch = serialBatch.get(serial);
		return knownBatch === batchNo;
	});
};

/**
 * ERPNext accepts one batch per invoice-item row. Convert a multi-batch
 * selection into independent cart rows while preserving the sales UOM and
 * monetary values of the source row.
 */
export const createBatchAllocationLines = (
	item: any,
	allocations: BatchAllocation[],
	serials: string[] = [],
): any[] => {
	const normalized = normalizeBatchAllocations(allocations);
	const conversionFactor = getItemConversionFactor(item);
	const sign = Number(item?.qty) < 0 ? -1 : 1;
	const cleanSerials = serials
		.map((serial) => String(serial || "").trim())
		.filter(Boolean);

	return normalized.map((allocation, index) => {
		const qty = sign * (allocation.stockQty / conversionFactor);
		const line = {
			...item,
			batch_no: allocation.batchNo,
			qty,
			stock_qty: sign * allocation.stockQty,
			amount: qty * Number(item?.rate || 0),
			base_amount: qty * Number(item?.base_rate ?? item?.rate ?? 0),
			serial_no_selected: item?.has_serial_no
				? serialsForBatch(item, cleanSerials, allocation.batchNo)
				: [],
			_batch_serial_assignment_source: "manual",
		};
		line.serial_no = line.serial_no_selected.join("\n");

		if (index > 0) {
			line.posa_row_id = createRowId();
			// A split row is a new ERPNext child row, even when the source cart line
			// came from a saved draft.
			delete line.name;
			delete line.idx;
			delete line.parent;
			delete line.parentfield;
			delete line.parenttype;
			delete line.docstatus;
		}
		return line;
	});
};

export const batchAllocationEpsilon = EPSILON;
