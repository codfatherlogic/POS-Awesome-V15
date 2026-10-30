<template>
	<footer class="counter-grid-health" aria-label="Counter operational status">
		<div class="counter-grid-health__context" :title="warehouse || undefined">
			<v-icon icon="mdi-warehouse" size="15" />
			<span>{{ warehouse || __("Warehouse not selected") }}</span>
		</div>
		<div
			class="counter-grid-health__context counter-grid-health__context--price"
			:title="priceList || undefined"
		>
			<v-icon icon="mdi-tag-outline" size="15" />
			<span>{{ priceList || __("Price list not selected") }}</span>
		</div>
		<button
			v-for="item in healthItems"
			:key="item.id"
			type="button"
			class="counter-grid-health__item"
			:class="`counter-grid-health__item--${item.tone}`"
			:title="item.detail"
			:data-testid="`counter-grid-health-${item.id}`"
			@click="openStatusPanel"
		>
			<v-icon :icon="item.icon" size="15" />
			<span>{{ item.label }}</span>
		</button>
		<span class="counter-grid-health__template">{{ __("Counter Grid") }}</span>
	</footer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";

import { useItemsStore } from "../../../stores/itemsStore";
import { useOfflineSyncStore } from "../../../stores/offlineSyncStore";
import { buildCounterGridHealthItems } from "../../../utils/counterGridHealth";

defineProps<{
	warehouse?: string | null;
	priceList?: string | null;
}>();

const __ = window.__ || ((value: string) => value);
const offlineSyncStore = useOfflineSyncStore();
const itemsStore = useItemsStore();
const { summary, capabilitySummaries, resourceStates, connectivityLabel, connectivityTone } =
	storeToRefs(offlineSyncStore);
const { itemsLoaded, totalItemCount } = storeToRefs(itemsStore);

const healthItems = computed(() =>
	buildCounterGridHealthItems({
		connectivityLabel: connectivityLabel.value,
		connectivityTone: connectivityTone.value,
		pendingInvoices: summary.value.pendingInvoices,
		capabilitySummaries: capabilitySummaries.value,
		resourceStates: resourceStates.value,
		itemsLoaded: itemsLoaded.value,
		totalItemCount: totalItemCount.value,
		translate: __,
	}),
);

const openStatusPanel = () => offlineSyncStore.setPanelOpen(true);
</script>

<style scoped>
.counter-grid-health {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	height: 34px;
	padding: 3px 8px;
	border-top: 2px solid var(--counter-rugged-navy-raised);
	background: var(--counter-rugged-surface);
	color: var(--pos-text-secondary);
	font-size: 0.72rem;
}

.counter-grid-health__context,
.counter-grid-health__item {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
	height: 25px;
	padding: 0 7px;
	border: 1px solid var(--pos-border);
	border-radius: 3px;
	background: var(--pos-surface-muted);
	color: var(--pos-text-secondary);
	white-space: nowrap;
}

.counter-grid-health__context {
	flex: 1 1 120px;
	max-width: 190px;
}

.counter-grid-health__context span,
.counter-grid-health__item span {
	overflow: hidden;
	text-overflow: ellipsis;
}

.counter-grid-health__item {
	flex: 0 1 auto;
	font: inherit;
	cursor: pointer;
}

.counter-grid-health__item:hover,
.counter-grid-health__item:focus-visible {
	border-color: var(--counter-rugged-blue);
	outline: none;
}

.counter-grid-health__item--success {
	border-color: var(--pos-success);
	color: var(--pos-success);
}

.counter-grid-health__item--warning {
	border-color: var(--pos-warning);
	color: var(--pos-warning);
}

.counter-grid-health__item--error {
	border-color: var(--pos-error);
	color: var(--pos-error);
}

.counter-grid-health__item--info {
	color: var(--counter-rugged-blue);
}

.counter-grid-health__template {
	margin-inline-start: auto;
	font-weight: 700;
	color: var(--counter-rugged-blue);
	white-space: nowrap;
}

@media (max-width: 1199px) {
	.counter-grid-health__context--price,
	.counter-grid-health__template {
		display: none;
	}

	.counter-grid-health__context,
	.counter-grid-health__item {
		padding-inline: 5px;
	}
}
</style>
