<template>
	<div v-if="enabled && changeDue > 0" class="change-helper">
		<div class="change-helper__header">
			<strong>{{ __("Physical Change Returned") }}</strong>
			<v-btn size="small" variant="tonal" color="primary" @click="$emit('add-row')">
				{{ __("Add Currency") }}
			</v-btn>
		</div>
		<v-row v-for="(row, index) in rows" :key="index" dense class="ma-0 mt-2">
			<v-col cols="4">
				<v-select
					density="compact"
					variant="solo"
					hide-details
					:items="currencies"
					:model-value="row.currency"
					@update:model-value="$emit('update-currency', row, $event)"
				/>
			</v-col>
			<v-col cols="5">
				<v-text-field
					density="compact"
					variant="solo"
					hide-details
					type="number"
					min="0"
					:label="__('Amount')"
					:model-value="row.original_amount"
					:error="Boolean(row._posa_rate_error)"
					@change="$emit('update-amount', row, $event)"
				/>
				<small v-if="!row._posa_rate_error">
					{{ __("Invoice equivalent") }}: {{ formatCurrency(row.invoice_amount || 0) }}
				</small>
				<small v-else class="change-helper__error">{{ __("Rate unavailable") }}</small>
			</v-col>
			<v-col cols="3" class="d-flex align-center justify-end">
				<v-btn icon="mdi-delete-outline" size="small" variant="text" color="error" @click="$emit('remove-row', index)" />
			</v-col>
		</v-row>
		<div class="change-helper__remaining">
			{{ __("Remaining change") }}: {{ formatCurrency(remaining) }}
		</div>
	</div>
</template>

<script setup>
const __ = window.__;
defineProps({
	enabled: Boolean,
	changeDue: Number,
	remaining: Number,
	rows: { type: Array, default: () => [] },
	currencies: { type: Array, default: () => [] },
	formatCurrency: Function,
});
defineEmits(["add-row", "remove-row", "update-amount", "update-currency"]);
</script>

<style scoped>
.change-helper { margin-top: var(--pos-space-3); padding: var(--pos-space-3); border: 1px solid var(--pos-border-light); border-radius: var(--pos-radius-md); }
.change-helper__header { display: flex; align-items: center; justify-content: space-between; gap: var(--pos-space-2); }
.change-helper__remaining { margin-top: var(--pos-space-2); text-align: right; font-weight: 700; }
.change-helper__error { color: rgb(var(--v-theme-error)); }
</style>
