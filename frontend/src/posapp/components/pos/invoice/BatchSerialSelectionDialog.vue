<template>
	<v-dialog v-model="dialogVisible" max-width="760" scrollable>
		<v-card class="posa-batch-serial-dialog">
			<v-card-title class="d-flex align-center">
				<v-icon class="me-2">mdi-barcode-scan</v-icon>
				<div>
					<div>{{ __("Batch & Serial Selection") }}</div>
					<div class="text-caption text-medium-emphasis">
						{{ item?.item_name || item?.item_code }} - {{ __("Required stock quantity") }}:
						{{ requiredQuantity }}
					</div>
				</div>
			</v-card-title>

			<v-divider />
			<v-card-text>
				<v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />
				<v-alert v-if="errorMessage" type="error" variant="tonal" density="compact" class="mb-4">
					{{ errorMessage }}
				</v-alert>

				<div v-if="item?.has_batch_no" class="mb-4">
					<div class="d-flex align-center mb-2">
						<div>
							<div class="text-subtitle-2">{{ __("Batch allocation") }}</div>
							<div class="text-caption text-medium-emphasis">
								{{ __("Enter the stock quantity to take from each batch.") }}
							</div>
						</div>
						<v-spacer />
						<v-btn size="small" variant="tonal" prepend-icon="mdi-auto-fix" @click="autoAllocate">
							{{ __("Auto Allocate") }}
						</v-btn>
					</div>

					<v-table v-if="batchOptions.length" density="compact" class="posa-batch-allocation-table">
						<thead>
							<tr>
								<th>{{ __("Batch") }}</th>
								<th>{{ __("Available") }}</th>
								<th>{{ __("Expiry") }}</th>
								<th class="posa-batch-allocation-table__qty">{{ __("Allocate") }}</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="batch in batchOptions" :key="batch.batch_no">
								<td>
									<div>{{ batch.batch_no }}</div>
									<div
										v-if="hasPositiveBatchPrice(batch)"
										class="text-caption text-medium-emphasis"
									>
										{{ __("Price") }}: {{ batch.batch_price }}
									</div>
								</td>
								<td>{{ getBatchAvailableQty(batch) }}</td>
								<td>{{ batch.expiry_date || "-" }}</td>
								<td>
									<v-text-field
										:model-value="workingAllocations[batch.batch_no] || ''"
										type="number"
										:min="0"
										:max="isReturnInvoice ? undefined : getBatchAvailableQty(batch)"
										step="any"
										density="compact"
										variant="outlined"
										hide-details
										@update:model-value="setAllocation(batch.batch_no, $event)"
									/>
								</td>
							</tr>
						</tbody>
					</v-table>
					<div
						class="text-caption mt-2"
						:class="allocationComplete ? 'text-success' : 'text-error'"
					>
						{{ __("Allocated") }}: {{ allocationTotal }} / {{ requiredQuantity }}
					</div>
				</div>

				<v-alert
					v-if="item?.has_batch_no && !loading && batchOptions.length === 0"
					type="warning"
					variant="tonal"
					density="compact"
					class="mb-4"
				>
					{{ __("No available batches were found for the POS Profile warehouse.") }}
				</v-alert>

				<v-autocomplete
					v-if="item?.has_serial_no"
					v-model="workingSerials"
					:items="serialOptions"
					item-title="serial_no"
					item-value="serial_no"
					:label="__('Serial Numbers')"
					:placeholder="__('Search or scan a serial number')"
					prepend-inner-icon="mdi-barcode"
					variant="outlined"
					:autofocus="!item?.has_batch_no"
					multiple
					chips
					closable-chips
					:hint="serialSelectionHint"
					persistent-hint
				>
					<template #item="{ props, item: option }">
						<v-list-item v-bind="props">
							<v-list-item-subtitle v-if="getOptionRaw(option).batch_no">
								{{ __("Batch") }}: {{ getOptionRaw(option).batch_no }}
							</v-list-item-subtitle>
						</v-list-item>
					</template>
				</v-autocomplete>

				<div v-if="item?.has_serial_no" class="text-caption mt-1">
					{{ workingSerials.length }} / {{ requiredQuantity }} {{ __("selected") }}
				</div>
			</v-card-text>

			<v-divider />
			<v-card-actions>
				<v-btn
					v-if="item?.has_batch_no && item?.batch_no"
					variant="text"
					@click="restoreAutomaticSelection"
				>
					{{ __("Reset Changes") }}
				</v-btn>
				<v-spacer />
				<v-btn variant="text" @click="cancel">{{ __("Cancel") }}</v-btn>
				<v-btn color="primary" variant="flat" :disabled="loading" @click="save">
					{{ __("Save Selection") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getDisplayableBatchOptions } from "../../../composables/pos/shared/useBatchSerial";
import {
	allocateBatchStockQty,
	batchAllocationEpsilon,
	getBatchAllocationTotal,
	getBatchAvailableStockQty,
	selectSerialsForBatchAllocations,
	type BatchAllocation,
} from "../../../composables/pos/shared/batchAllocation";
import {
	getRequiredStockQuantity,
	getSelectedSerials,
	validateBatchSerialSelection,
} from "../../../composables/pos/shared/batchSerialValidation";

const props = withDefaults(
	defineProps<{
		modelValue: boolean;
		item: any | null;
		cartItems?: any[];
		isReturnInvoice?: boolean;
		loading?: boolean;
	}>(),
	{
		cartItems: () => [],
		isReturnInvoice: false,
		loading: false,
	},
);

const emit = defineEmits<{
	"update:modelValue": [value: boolean];
	save: [selection: { batchNo: string | null; allocations: BatchAllocation[]; serials: string[] }];
}>();

const __ = (window as any).__ || ((text: string) => text);
const workingAllocations = ref<Record<string, number>>({});
const workingSerials = ref<string[]>([]);
const errorMessage = ref("");

const dialogVisible = computed({
	get: () => props.modelValue,
	set: (value: boolean) => emit("update:modelValue", value),
});

const requiredQuantity = computed(() => getRequiredStockQuantity(props.item));

const allocations = computed<BatchAllocation[]>(() =>
	Object.entries(workingAllocations.value)
		.map(([batchNo, stockQty]) => ({ batchNo, stockQty: Number(stockQty) }))
		.filter((allocation) => Number.isFinite(allocation.stockQty) && allocation.stockQty > 0),
);
const allocationTotal = computed(() => getBatchAllocationTotal(allocations.value));
const allocationComplete = computed(
	() => Math.abs(allocationTotal.value - requiredQuantity.value) <= batchAllocationEpsilon,
);
const selectedBatchNos = computed(() => new Set(allocations.value.map((allocation) => allocation.batchNo)));

const batchOptions = computed(() => {
	const available = getDisplayableBatchOptions(props.item?.batch_no_data);
	const currentBatch = String(props.item?.batch_no || "").trim();
	if (!currentBatch || available.some((batch) => batch.batch_no === currentBatch)) {
		return available;
	}
	const currentRow = Array.isArray(props.item?.batch_no_data)
		? props.item.batch_no_data.find((batch: any) => batch?.batch_no === currentBatch)
		: null;
	return currentRow ? [currentRow, ...available] : available;
});

const usedSerialsElsewhere = computed(() => {
	const used = new Set<string>();
	for (const line of props.cartItems || []) {
		if (!line || line.posa_row_id === props.item?.posa_row_id) continue;
		getSelectedSerials(line).forEach((serial) => used.add(serial));
	}
	return used;
});

const serialOptions = computed(() => {
	const rows = Array.isArray(props.item?.serial_no_data) ? props.item.serial_no_data : [];
	return rows.filter((row: any) => {
		const serial = String(row?.serial_no || "").trim();
		if (!serial || usedSerialsElsewhere.value.has(serial)) return false;
		if (selectedBatchNos.value.size && props.item?.has_batch_no) {
			return selectedBatchNos.value.has(String(row?.batch_no || ""));
		}
		return true;
	});
});

const serialSelectionHint = computed(() => {
	if (props.item?.has_batch_no && !selectedBatchNos.value.size) {
		return __("Allocate one or more batches first to filter their serial numbers.");
	}
	return __("Already-used serial numbers are hidden.");
});

const getBatchAvailableQty = (batch: any) => getBatchAvailableStockQty(batch);
const hasPositiveBatchPrice = (batch: any) => Number(batch?.batch_price) > 0;
const getOptionRaw = (option: any) => option?.raw || {};

const initializeDraft = () => {
	workingAllocations.value = {};
	const currentBatch = String(props.item?.batch_no || "").trim();
	if (currentBatch) {
		workingAllocations.value[currentBatch] = requiredQuantity.value;
	}
	workingSerials.value = getSelectedSerials(props.item);
	errorMessage.value = "";
	if (!currentBatch || (!props.isReturnInvoice && !allocationFitsAvailability.value)) {
		autoAllocate();
	} else {
		syncSerialSelection();
	}
};

const allocationFitsAvailability = computed(() =>
	allocations.value.every((allocation) => {
		const batch = batchOptions.value.find((row: any) => row.batch_no === allocation.batchNo);
		return Boolean(batch) && getBatchAvailableQty(batch) + batchAllocationEpsilon >= allocation.stockQty;
	}),
);

const syncSerialSelection = () => {
	if (props.item?.has_serial_no && props.item?.has_batch_no) {
		workingSerials.value = selectSerialsForBatchAllocations(
			props.item,
			allocations.value,
			workingSerials.value,
			usedSerialsElsewhere.value,
		);
	} else {
		const validSerials = new Set(serialOptions.value.map((row: any) => row.serial_no));
		workingSerials.value = workingSerials.value.filter((serial) => validSerials.has(serial));
	}
	errorMessage.value = "";
};

const setAllocation = (batchNo: string, value: any) => {
	const stockQty = Number(value);
	if (Number.isFinite(stockQty) && stockQty > 0) {
		workingAllocations.value = { ...workingAllocations.value, [batchNo]: stockQty };
	} else {
		const next = { ...workingAllocations.value };
		delete next[batchNo];
		workingAllocations.value = next;
	}
	syncSerialSelection();
};

const autoAllocate = () => {
	const result = allocateBatchStockQty(batchOptions.value, requiredQuantity.value);
	workingAllocations.value = Object.fromEntries(
		result.allocations.map((allocation) => [allocation.batchNo, allocation.stockQty]),
	);
	syncSerialSelection();
	if (result.unallocatedStockQty > batchAllocationEpsilon) {
		errorMessage.value = `${__("Insufficient batch stock")}: ${result.unallocatedStockQty} ${__("stock unit(s) remain unallocated")}`;
	}
};

watch(
	() => [props.modelValue, props.item?.posa_row_id],
	([visible]) => {
		if (visible) initializeDraft();
	},
	{ immediate: true },
);

const restoreAutomaticSelection = () => initializeDraft();

const cancel = () => {
	initializeDraft();
	dialogVisible.value = false;
};

const save = () => {
	if (!props.item) return;
	const duplicateInCart = workingSerials.value.find((serial) => usedSerialsElsewhere.value.has(serial));
	if (duplicateInCart) {
		errorMessage.value = `Serial ${duplicateInCart} is already selected on another cart line`;
		return;
	}
	const issues = validateBatchSerialSelection(
		props.item,
		{
			allocations: allocations.value,
			serials: workingSerials.value,
		},
		{ isReturnInvoice: props.isReturnInvoice },
	);
	if (issues.length) {
		errorMessage.value = issues[0]?.message || __("Invalid batch or serial selection");
		return;
	}
	emit("save", {
		batchNo: allocations.value[0]?.batchNo || null,
		allocations: allocations.value,
		serials: [...workingSerials.value],
	});
	dialogVisible.value = false;
};
</script>

<style scoped>
.posa-batch-serial-dialog :deep(.v-card-text) {
	padding-top: 20px;
}

.posa-batch-serial-dialog {
	border-top: 4px solid var(--pos-primary, #1976d2);
}

.posa-batch-serial-dialog :deep(.v-card-title) {
	background: var(--pos-surface-variant, rgba(25, 118, 210, 0.08));
}

.posa-batch-allocation-table__qty {
	width: 150px;
}
</style>
