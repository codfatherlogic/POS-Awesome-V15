<template>
	<v-dialog
		:model-value="modelValue"
		:max-width="1120"
		:fullscreen="useFullscreenDialog"
		scrollable
		content-class="item-quick-edit-dialog"
		persistent
		@update:model-value="emit('update:modelValue', $event)"
		@after-leave="emit('after-leave')"
	>
		<v-card
			ref="modalRoot"
			class="item-quick-edit pos-themed-card"
			:class="{ 'item-quick-edit--fullscreen': useFullscreenDialog }"
			data-testid="item-quick-edit-modal"
			data-pos-keyboard-root="item-quick-edit"
			tabindex="0"
			@keydown.capture="handleQuickEditKeydown"
			@click.capture="handleQuickEditClick"
		>
			<v-card-title class="item-quick-edit__title">
				<div class="item-quick-edit__identity">
					<div class="text-h6">{{ __("Update Item") }}</div>
					<div v-if="form.item_code" class="text-caption text-medium-emphasis">
						{{ form.item_name || form.item_code }} - {{ form.item_code }}
					</div>
				</div>
				<v-spacer></v-spacer>
				<v-btn
					icon="mdi-close"
					variant="text"
					:disabled="saving"
					:aria-label="__('Close item quick edit')"
					data-quick-edit-keytarget
					data-quick-edit-key="close"
					@click="close"
				></v-btn>
			</v-card-title>

			<v-card-text class="item-quick-edit__body">
				<v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-3">
					{{ errorMessage }}
				</v-alert>
				<v-alert
					v-if="loaded && !canSave"
					type="warning"
					density="compact"
					variant="tonal"
					class="mb-3"
				>
					{{ __("A POS supervisor with Item Quick Edit enabled is required to save changes.") }}
				</v-alert>

				<v-form ref="formRef" @submit.prevent="save">
					<div class="item-quick-edit__lookup">
						<v-text-field
							ref="lookupField"
							v-model.trim="lookupValue"
							data-testid="item-quick-edit-lookup"
							data-quick-edit-keytarget
							data-quick-edit-key="lookup"
							:label="__('Item Code or Barcode')"
							density="compact"
							variant="outlined"
							hide-details
							prepend-inner-icon="mdi-barcode-scan"
							:disabled="loading || saving"
							@keydown.enter.prevent="loadByLookup"
						></v-text-field>
						<v-btn
							color="primary"
							variant="tonal"
							data-quick-edit-keytarget
							data-quick-edit-key="load"
							:loading="loading"
							:disabled="!lookupValue || saving"
							@click="loadByLookup"
						>
							{{ __("Load") }}
						</v-btn>
					</div>

					<div class="item-quick-edit__grid mt-4">
						<div class="item-quick-edit__section item-quick-edit__section--identity">
							<div class="item-quick-edit__section-title">{{ __("Identity") }}</div>
							<v-row dense>
								<v-col cols="12" md="4">
									<v-text-field
										v-model="form.item_code"
										data-quick-edit-keytarget
										data-quick-edit-key="item-code"
										:label="__('Item Code')"
										density="compact"
										variant="outlined"
										readonly
									></v-text-field>
								</v-col>
								<v-col cols="12" md="8">
									<v-text-field
										ref="nameField"
										v-model="form.item_name"
										data-testid="item-quick-edit-name"
										data-quick-edit-keytarget
										data-quick-edit-key="name"
										:label="__('Name')"
										density="compact"
										variant="outlined"
										:rules="[(v) => !!v || __('* Required')]"
										:disabled="!loaded"
										@keydown.tab.exact.prevent="focusShortName"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="6">
									<v-text-field
										ref="shortNameField"
										v-model="form.retailmind_short_name"
										data-testid="item-quick-edit-short-name"
										data-quick-edit-keytarget
										data-quick-edit-key="short-name"
										:label="__('Short Name')"
										density="compact"
										variant="outlined"
										:disabled="!loaded"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="6">
									<v-text-field
										v-model="form.barcode"
										data-quick-edit-keytarget
										data-quick-edit-key="barcode"
										:label="__('Barcode')"
										density="compact"
										variant="outlined"
										:disabled="!loaded"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="6">
									<v-autocomplete
										v-model="form.item_group"
										data-quick-edit-keytarget
										data-quick-edit-key="item-group"
										:items="options.item_groups"
										:label="__('Item Group')"
										density="compact"
										variant="outlined"
										:rules="[(v) => !!v || __('* Required')]"
										:disabled="!loaded"
									></v-autocomplete>
								</v-col>
								<v-col cols="12" md="6">
									<v-autocomplete
										v-model="form.brand"
										data-quick-edit-keytarget
										data-quick-edit-key="brand"
										:items="options.brands"
										:label="__('Company / Brand')"
										density="compact"
										variant="outlined"
										clearable
										:disabled="!loaded"
									></v-autocomplete>
								</v-col>
								<v-col cols="12" md="4">
									<v-text-field
										v-model="form.retailmind_old_pos_company_code"
										data-quick-edit-keytarget
										data-quick-edit-key="company-code"
										:label="__('Legacy Company Code')"
										density="compact"
										variant="outlined"
										:disabled="!loaded"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="4">
									<v-text-field
										v-model="form.retailmind_old_pos_generic_name"
										data-quick-edit-keytarget
										data-quick-edit-key="generic"
										:label="__('Generic')"
										density="compact"
										variant="outlined"
										:disabled="!loaded"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="4">
									<v-text-field
										v-model="form.retailmind_old_pos_generic_code"
										data-quick-edit-keytarget
										data-quick-edit-key="generic-code"
										:label="__('Generic Code')"
										density="compact"
										variant="outlined"
										:disabled="!loaded"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="4">
									<v-text-field
										v-model="form.retailmind_old_pos_pack"
										data-quick-edit-keytarget
										data-quick-edit-key="pack"
										:label="__('Pack')"
										density="compact"
										variant="outlined"
										:disabled="!loaded"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="4">
									<v-text-field
										v-model="form.retailmind_old_pos_rack"
										data-quick-edit-keytarget
										data-quick-edit-key="rack"
										:label="__('Rack')"
										density="compact"
										variant="outlined"
										:disabled="!loaded"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="4">
									<v-autocomplete
										v-model="form.primary_supplier"
										data-quick-edit-keytarget
										data-quick-edit-key="supplier"
										:items="options.suppliers"
										:label="__('Primary Supplier')"
										density="compact"
										variant="outlined"
										clearable
										:disabled="!loaded"
									></v-autocomplete>
								</v-col>
							</v-row>
						</div>

						<div class="item-quick-edit__section">
							<div class="item-quick-edit__section-title">{{ __("Pricing") }}</div>
							<v-row dense>
								<v-col cols="12" md="4">
									<v-text-field
										:model-value="form.retail_price"
										data-testid="item-quick-edit-retail-price"
										data-quick-edit-keytarget
										data-quick-edit-key="retail-price"
										:label="__('Retail Price')"
										type="number"
										min="0"
										step="0.01"
										density="compact"
										variant="outlined"
										prefix="Rs"
										:disabled="!loaded"
										@update:model-value="handleRetailPriceUpdate"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="4">
									<v-text-field
										:model-value="form.trade_discount_percent"
										data-testid="item-quick-edit-trade-discount"
										data-quick-edit-keytarget
										data-quick-edit-key="trade-discount"
										:label="__('Discount')"
										type="number"
										min="0"
										max="100"
										step="0.01"
										density="compact"
										variant="outlined"
										suffix="%"
										:disabled="!loaded"
										@update:model-value="handleTradeDiscountUpdate"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="4">
									<v-text-field
										:model-value="form.trade_price"
										data-quick-edit-keytarget
										data-quick-edit-key="trade-price"
										:label="__('Trade Price')"
										type="number"
										min="0"
										step="0.01"
										density="compact"
										variant="outlined"
										prefix="Rs"
										:disabled="!loaded"
										@update:model-value="handleTradePriceUpdate"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="6">
									<v-text-field
										v-model.number="form.retailmind_units_per_pack"
										data-quick-edit-keytarget
										data-quick-edit-key="units-per-pack"
										:label="__('Unit in a Pack')"
										type="number"
										min="0"
										step="1"
										density="compact"
										variant="outlined"
										:disabled="!loaded"
									></v-text-field>
								</v-col>
								<v-col cols="12" md="6">
									<v-text-field
										v-model.number="form.max_discount"
										data-quick-edit-keytarget
										data-quick-edit-key="max-discount"
										:label="__('Disc. on Retail')"
										type="number"
										min="0"
										max="100"
										step="0.01"
										density="compact"
										variant="outlined"
										suffix="%"
										:disabled="!loaded"
									></v-text-field>
								</v-col>
							</v-row>
						</div>

						<div class="item-quick-edit__section item-quick-edit__section--controls">
							<div class="item-quick-edit__section-title">{{ __("Controls") }}</div>
							<v-checkbox
								v-model="form.retailmind_controlled_item"
								data-testid="item-quick-edit-controlled"
								data-quick-edit-keytarget
								data-quick-edit-key="controlled"
								:label="__('Steroid/Narcotics Item')"
								density="compact"
								hide-details
								:disabled="!loaded"
							></v-checkbox>
							<v-checkbox
								v-model="form.retailmind_non_discountable"
								data-quick-edit-keytarget
								data-quick-edit-key="non-discountable"
								:label="__('Imported/Non Discounted Item')"
								density="compact"
								hide-details
								:disabled="!loaded"
							></v-checkbox>
							<v-checkbox
								v-model="form.retailmind_locked_for_sale"
								data-quick-edit-keytarget
								data-quick-edit-key="locked"
								:label="__('Lock for Sale')"
								density="compact"
								hide-details
								color="error"
								:disabled="!loaded"
							></v-checkbox>
						</div>
					</div>
				</v-form>
			</v-card-text>

			<v-card-actions class="item-quick-edit__actions px-5 py-3">
				<v-spacer></v-spacer>
				<v-btn
					class="item-quick-edit__cancel"
					variant="text"
					color="error"
					:disabled="saving"
					data-quick-edit-keytarget
					data-quick-edit-key="cancel"
					@click="close"
				>
					{{ __("Cancel") }}
				</v-btn>
				<v-btn
					class="item-quick-edit__update"
					color="primary"
					variant="tonal"
					data-testid="item-quick-edit-update"
					data-quick-edit-keytarget
					data-quick-edit-key="update"
					:loading="saving"
					:disabled="!loaded || !canSave || !isOnline || loading"
					@click="save"
				>
					{{ __("Update") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useResponsive } from "../../../composables/core/useResponsive";
import itemService from "../../../services/itemService";
import {
	calculateTradeDiscountPercent,
	calculateTradePriceFromDiscount,
	toNullableNumber,
} from "./itemQuickEditPricing";

declare const __: (_text: string, _args?: any[]) => string;

const props = withDefaults(
	defineProps<{
		modelValue: boolean;
		itemCode?: string;
		posProfile?: any;
		cashier?: string;
		isOnline?: boolean;
	}>(),
	{
		itemCode: "",
		isOnline: true,
	},
);

const emit = defineEmits<{
	"update:modelValue": [value: boolean];
	"after-leave": [];
	saved: [payload: any];
}>();

const arrowKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
let generatedKeyboardTargetId = 0;
const quickEditKeyboardSelector = "[data-quick-edit-keytarget]";
const responsive = useResponsive();
const useFullscreenDialog = computed(
	() => responsive.windowWidth.value <= 1100 || responsive.windowHeight.value <= 760,
);

const modalRoot = ref<any>(null);
const lookupField = ref<any>(null);
const nameField = ref<any>(null);
const shortNameField = ref<any>(null);
const formRef = ref<any>(null);
const lookupValue = ref("");
const loading = ref(false);
const saving = ref(false);
const loaded = ref(false);
const canSave = ref(false);
const errorMessage = ref("");
const keyboardEditing = ref(false);
const activeKeyboardTarget = ref<HTMLElement | null>(null);
const options = reactive({
	item_groups: [] as string[],
	brands: [] as string[],
	suppliers: [] as string[],
});

const blankForm = () => ({
	item_code: "",
	item_name: "",
	description: "",
	item_group: "",
	brand: "",
	barcode: "",
	primary_supplier: "",
	retail_price: null as number | null,
	trade_discount_percent: null as number | null,
	trade_price: null as number | null,
	selling_price_list: "",
	buying_price_list: "",
	max_discount: 0,
	retailmind_short_name: "",
	retailmind_old_pos_generic_code: "",
	retailmind_old_pos_generic_name: "",
	retailmind_old_pos_company_code: "",
	retailmind_old_pos_pack: "",
	retailmind_old_pos_rack: "",
	retailmind_units_per_pack: 1,
	retailmind_controlled_item: false,
	retailmind_non_discountable: false,
	retailmind_locked_for_sale: false,
});

const form = reactive(blankForm());

const getRootElement = (): HTMLElement | null => {
	const candidate = modalRoot.value?.$el || modalRoot.value || null;
	return candidate instanceof HTMLElement ? candidate : null;
};

const isElementVisible = (element: HTMLElement) => {
	if (!element.isConnected) return false;
	const style = window.getComputedStyle(element);
	if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
		return false;
	}
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
};

const isKeyboardTargetDisabled = (element: HTMLElement) =>
	element.hasAttribute("disabled") ||
	element.getAttribute("aria-disabled") === "true" ||
	element.classList.contains("v-btn--disabled") ||
	element.classList.contains("v-input--disabled") ||
	Boolean(element.closest("[disabled], [aria-disabled='true'], .v-btn--disabled, .v-input--disabled"));

const ensureKeyboardTargetKey = (element: HTMLElement) => {
	if (!element.dataset.quickEditKeyboardId) {
		generatedKeyboardTargetId += 1;
		element.dataset.quickEditKeyboardId = `quick-edit-target-${generatedKeyboardTargetId}`;
	}
	return element.dataset.quickEditKeyboardId;
};

const getKeyboardTargets = () => {
	const root = getRootElement();
	if (!root) return [];
	const targets: HTMLElement[] = [];
	const seen = new Set<HTMLElement>();
	for (const node of Array.from(root.querySelectorAll<HTMLElement>(quickEditKeyboardSelector))) {
		if (seen.has(node) || isKeyboardTargetDisabled(node) || !isElementVisible(node)) {
			continue;
		}
		ensureKeyboardTargetKey(node);
		seen.add(node);
		targets.push(node);
	}
	return targets;
};

const clearKeyboardBox = () => {
	getRootElement()
		?.querySelectorAll(".posa-quick-edit-keyboard-box")
		.forEach((node) => node.classList.remove("posa-quick-edit-keyboard-box"));
};

const setKeyboardTarget = (target: HTMLElement | null) => {
	clearKeyboardBox();
	activeKeyboardTarget.value = target;
	if (!target) return;
	target.classList.add("posa-quick-edit-keyboard-box");
	target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
};

const sortTargetsByPosition = (targets: HTMLElement[]) =>
	[...targets].sort((a, b) => {
		const aRect = a.getBoundingClientRect();
		const bRect = b.getBoundingClientRect();
		return aRect.top - bRect.top || aRect.left - bRect.left;
	});

const getTargetCenter = (element: HTMLElement) => {
	const rect = element.getBoundingClientRect();
	return {
		x: rect.left + rect.width / 2,
		y: rect.top + rect.height / 2,
	};
};

const scoreTargetForArrow = (
	key: string,
	current: ReturnType<typeof getTargetCenter>,
	target: HTMLElement,
) => {
	const candidate = getTargetCenter(target);
	const dx = candidate.x - current.x;
	const dy = candidate.y - current.y;
	if (key === "ArrowRight" && dx <= 1) return null;
	if (key === "ArrowLeft" && dx >= -1) return null;
	if (key === "ArrowDown" && dy <= 1) return null;
	if (key === "ArrowUp" && dy >= -1) return null;
	const primary = key === "ArrowRight" || key === "ArrowLeft" ? Math.abs(dx) : Math.abs(dy);
	const secondary = key === "ArrowRight" || key === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);
	return secondary * 1000 + primary;
};

const setDefaultKeyboardTarget = async (preferredKey = "lookup") => {
	await nextTick();
	const targets = getKeyboardTargets();
	if (!targets.length) {
		setKeyboardTarget(null);
		return;
	}
	const preferred =
		targets.find((target) => target.dataset.quickEditKey === preferredKey) ||
		sortTargetsByPosition(targets)[0] ||
		null;
	setKeyboardTarget(preferred);
	getRootElement()?.focus?.({ preventScroll: true });
};

const moveKeyboardTarget = (key: string) => {
	const targets = getKeyboardTargets();
	if (!targets.length) return false;
	if (!activeKeyboardTarget.value || !targets.includes(activeKeyboardTarget.value)) {
		const activeElement = document.activeElement as HTMLElement | null;
		const activeTarget = activeElement?.closest?.(quickEditKeyboardSelector) as HTMLElement | null;
		setKeyboardTarget(
			activeTarget && targets.includes(activeTarget)
				? activeTarget
				: sortTargetsByPosition(targets)[0] || null,
		);
		return true;
	}

	const current = getTargetCenter(activeKeyboardTarget.value);
	let bestTarget: HTMLElement | null = null;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const target of targets) {
		if (target === activeKeyboardTarget.value) continue;
		const score = scoreTargetForArrow(key, current, target);
		if (score !== null && score < bestScore) {
			bestScore = score;
			bestTarget = target;
		}
	}
	if (!bestTarget) {
		const ordered = sortTargetsByPosition(targets);
		const currentIndex = ordered.indexOf(activeKeyboardTarget.value);
		const delta = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
		bestTarget = ordered[Math.max(0, Math.min(currentIndex + delta, ordered.length - 1))] || null;
	}
	if (!bestTarget || bestTarget === activeKeyboardTarget.value) return false;
	setKeyboardTarget(bestTarget);
	return true;
};

const findFocusableWithinTarget = (target: HTMLElement) => {
	if (target.matches("input, textarea, select, button, [role='button'], [contenteditable='true']")) {
		return target;
	}
	return target.querySelector<HTMLElement>(
		"input, textarea, select, button, [role='button'], [contenteditable='true'], [tabindex]:not([tabindex='-1'])",
	);
};

const isEditableTarget = (target: EventTarget | null) => {
	const element = target as HTMLElement | null;
	return Boolean(element?.closest?.("input, textarea, select, [contenteditable='true']"));
};

const stopKeyboardEditing = () => {
	const activeKey = activeKeyboardTarget.value?.dataset.quickEditKey || "";
	keyboardEditing.value = false;
	(document.activeElement as HTMLElement | null)?.blur?.();
	void nextTick(() => {
		const targets = getKeyboardTargets();
		const replacement =
			targets.find((target) => target.dataset.quickEditKey === activeKey) ||
			(activeKeyboardTarget.value?.isConnected ? activeKeyboardTarget.value : null) ||
			targets[0] ||
			null;
		setKeyboardTarget(replacement);
		getRootElement()?.focus?.({ preventScroll: true });
	});
};

const activateKeyboardTarget = () => {
	const target = activeKeyboardTarget.value;
	if (!target) {
		void setDefaultKeyboardTarget(loaded.value ? "name" : "lookup");
		return;
	}
	const focusable = findFocusableWithinTarget(target);
	if (!focusable) return;
	focusable.focus?.();
	if (focusable.matches("input, textarea, select, [contenteditable='true']")) {
		keyboardEditing.value = true;
		if (focusable instanceof HTMLInputElement) {
			focusable.select?.();
		}
		return;
	}
	focusable.click?.();
	void nextTick(() => {
		if (target.isConnected && isElementVisible(target)) {
			setKeyboardTarget(target);
		} else {
			void setDefaultKeyboardTarget(loaded.value ? "name" : "lookup");
		}
		getRootElement()?.focus?.({ preventScroll: true });
	});
};

const resetForm = () => {
	Object.assign(form, blankForm());
	loaded.value = false;
	canSave.value = false;
	errorMessage.value = "";
	keyboardEditing.value = false;
	clearKeyboardBox();
	activeKeyboardTarget.value = null;
};

const normalizeItem = (item: any = {}) => ({
	...item,
	retailmind_controlled_item: Boolean(Number(item.retailmind_controlled_item || 0)),
	retailmind_non_discountable: Boolean(Number(item.retailmind_non_discountable || 0)),
	retailmind_locked_for_sale: Boolean(Number(item.retailmind_locked_for_sale || 0)),
	retailmind_units_per_pack: Number(item.retailmind_units_per_pack || 1),
	max_discount: Number(item.max_discount || 0),
	retail_price:
		item.retail_price === null || item.retail_price === undefined ? null : Number(item.retail_price),
	trade_price:
		item.trade_price === null || item.trade_price === undefined ? null : Number(item.trade_price),
});

const focusLookup = () => {
	nextTick(() => {
		const input = lookupField.value?.$el?.querySelector?.("input");
		input?.focus?.();
		input?.select?.();
		void setDefaultKeyboardTarget("lookup");
	});
};

const focusShortName = () => {
	nextTick(() => {
		const input = shortNameField.value?.$el?.querySelector?.("input");
		input?.focus?.();
		input?.select?.();
	});
};

const syncTradeDiscountFromPrices = () => {
	form.trade_discount_percent = calculateTradeDiscountPercent(form.retail_price, form.trade_price);
};

const handleRetailPriceUpdate = (value: unknown) => {
	form.retail_price = toNullableNumber(value);
	syncTradeDiscountFromPrices();
};

const handleTradePriceUpdate = (value: unknown) => {
	form.trade_price = toNullableNumber(value);
	syncTradeDiscountFromPrices();
};

const handleTradeDiscountUpdate = (value: unknown) => {
	form.trade_discount_percent = toNullableNumber(value);
	const tradePrice = calculateTradePriceFromDiscount(form.retail_price, form.trade_discount_percent);
	if (tradePrice !== null) {
		form.trade_price = tradePrice;
	}
};

const loadItem = async (value: string) => {
	const query = String(value || "").trim();
	if (!query || !props.posProfile) {
		focusLookup();
		return;
	}

	loading.value = true;
	errorMessage.value = "";
	try {
		const payload = await itemService.getItemQuickEditData({
			item_code: query,
			barcode: query,
			pos_profile: props.posProfile,
		});
		const item = normalizeItem(payload?.item || {});
		Object.assign(form, blankForm(), item);
		syncTradeDiscountFromPrices();
		options.item_groups = payload?.options?.item_groups || [];
		options.brands = payload?.options?.brands || [];
		options.suppliers = payload?.options?.suppliers || [];
		canSave.value = Boolean(payload?.can_save);
		loaded.value = true;
		lookupValue.value = form.item_code || query;
		keyboardEditing.value = false;
		void setDefaultKeyboardTarget("name");
	} catch (error: any) {
		resetForm();
		lookupValue.value = query;
		errorMessage.value = error?.message || __("Item was not found.");
		focusLookup();
	} finally {
		loading.value = false;
	}
};

const loadByLookup = () => loadItem(lookupValue.value);

const handleQuickEditKeydown = (event: KeyboardEvent) => {
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		if (keyboardEditing.value) {
			stopKeyboardEditing();
			return;
		}
		close();
		return;
	}

	if (arrowKeys.has(event.key)) {
		event.preventDefault();
		event.stopPropagation();
		if (keyboardEditing.value) {
			stopKeyboardEditing();
			void nextTick(() => moveKeyboardTarget(event.key));
			return;
		}
		moveKeyboardTarget(event.key);
		return;
	}

	if (event.key === "Tab") {
		event.preventDefault();
		event.stopPropagation();
		if (keyboardEditing.value) {
			stopKeyboardEditing();
			void nextTick(() => moveKeyboardTarget(event.shiftKey ? "ArrowLeft" : "ArrowRight"));
			return;
		}
		moveKeyboardTarget(event.shiftKey ? "ArrowLeft" : "ArrowRight");
		return;
	}

	if (event.key !== "Enter") {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	if (keyboardEditing.value && isEditableTarget(event.target)) {
		const activeKey = activeKeyboardTarget.value?.dataset.quickEditKey || "";
		stopKeyboardEditing();
		if (activeKey === "lookup") {
			void loadByLookup();
		}
		return;
	}
	if (keyboardEditing.value) {
		keyboardEditing.value = false;
	}
	activateKeyboardTarget();
};

const handleQuickEditClick = (event: MouseEvent) => {
	const target = (event.target as HTMLElement | null)?.closest?.(
		quickEditKeyboardSelector,
	) as HTMLElement | null;
	if (target) {
		setKeyboardTarget(target);
		keyboardEditing.value = isEditableTarget(event.target);
	}
};

const save = async () => {
	if (!loaded.value || saving.value) {
		return;
	}
	const validation = await formRef.value?.validate?.();
	if (validation && validation.valid === false) {
		return;
	}

	saving.value = true;
	errorMessage.value = "";
	try {
		const { trade_discount_percent: _tradeDiscountPercent, ...formPayload } = form;
		const payload = await itemService.saveItemQuickEditData({
			...formPayload,
			pos_profile: props.posProfile,
			cashier: props.cashier,
			retailmind_controlled_item: form.retailmind_controlled_item ? 1 : 0,
			retailmind_non_discountable: form.retailmind_non_discountable ? 1 : 0,
			retailmind_locked_for_sale: form.retailmind_locked_for_sale ? 1 : 0,
		});
		emit("saved", payload);
		emit("update:modelValue", false);
	} catch (error: any) {
		errorMessage.value = error?.message || __("Unable to update item.");
	} finally {
		saving.value = false;
	}
};

const close = () => {
	keyboardEditing.value = false;
	clearKeyboardBox();
	activeKeyboardTarget.value = null;
	emit("update:modelValue", false);
};

watch(
	() => props.modelValue,
	(open) => {
		if (!open) {
			return;
		}
		resetForm();
		lookupValue.value = props.itemCode || "";
		if (lookupValue.value) {
			void loadItem(lookupValue.value);
		} else {
			focusLookup();
			void setDefaultKeyboardTarget("lookup");
		}
	},
);
</script>

<style scoped>
.item-quick-edit {
	--counter-rugged-navy: #09253d;
	--counter-rugged-navy-raised: #174a70;
	--counter-rugged-blue: #0f70d7;
	--counter-rugged-cyan: #38bdf8;
	--counter-rugged-line: var(--pos-outline);
	--counter-rugged-soft-line: var(--pos-border);
	display: grid;
	grid-template-rows: auto minmax(0, 1fr) auto;
	width: 100%;
	max-height: calc(100dvh - 24px);
	overflow: hidden;
	border: 3px solid var(--counter-rugged-navy);
	border-radius: 5px !important;
	background: var(--pos-dialog-bg) !important;
	box-shadow: 0 5px 14px rgba(4, 22, 37, 0.34);
}

.item-quick-edit--fullscreen {
	height: 100dvh;
	max-height: 100dvh;
	border-radius: 0 !important;
}

.item-quick-edit__title {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 68px;
	padding: 10px 10px 10px 16px;
	border-bottom: 2px solid var(--counter-rugged-cyan);
	background: var(--counter-rugged-navy);
	color: #ffffff;
}

.item-quick-edit__identity {
	min-width: 0;
}

.item-quick-edit__identity .text-caption {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: #d6e7f3 !important;
}

.item-quick-edit__title :deep(.v-btn) {
	border-radius: 3px !important;
	color: #ffffff !important;
}

.item-quick-edit__body {
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 14px 16px;
	background: var(--pos-surface-muted);
}

.item-quick-edit__lookup {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 10px;
	align-items: start;
}

.item-quick-edit__lookup :deep(.v-field) {
	border-radius: 3px;
	background: var(--pos-input-bg);
}

.item-quick-edit__lookup :deep(.v-label),
.item-quick-edit__lookup :deep(.v-field-label),
.item-quick-edit__section :deep(.v-label),
.item-quick-edit__section :deep(.v-field-label) {
	color: var(--pos-text-secondary) !important;
	opacity: 1;
}

.item-quick-edit__lookup :deep(.v-btn) {
	min-height: 40px;
	border: 1px solid #084d96;
	border-radius: 3px !important;
	background: var(--counter-rugged-blue) !important;
	color: #ffffff !important;
}

.item-quick-edit__grid {
	display: grid;
	grid-template-columns: minmax(0, 1.1fr) minmax(260px, 0.8fr);
	gap: 14px;
}

.item-quick-edit__section {
	border: 1px solid var(--counter-rugged-line);
	border-radius: 3px;
	padding: 0 12px 12px;
	background: var(--pos-card-bg);
	box-shadow: 0 1px 3px rgba(9, 37, 61, 0.14);
}

.item-quick-edit__section--controls {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.item-quick-edit__section--identity {
	grid-column: 1 / -1;
}

.item-quick-edit__section-title {
	margin: 0 -12px 12px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--counter-rugged-cyan);
	background: var(--counter-rugged-navy-raised);
	color: #ffffff;
	font-size: 0.78rem;
	font-weight: 800;
	text-transform: uppercase;
}

.item-quick-edit__section :deep(.v-field) {
	border-radius: 3px;
	background: var(--pos-input-bg);
}

.item-quick-edit__section :deep(.v-field__outline) {
	color: var(--counter-rugged-line);
	--v-field-border-opacity: 1;
}

.item-quick-edit__actions {
	border-top: 2px solid var(--counter-rugged-navy-raised);
	background: var(--pos-card-bg);
}

.item-quick-edit__actions :deep(.v-btn) {
	min-width: 110px;
	border-radius: 3px !important;
}

.item-quick-edit__actions :deep(.v-btn.text-error),
.item-quick-edit__actions :deep(.text-error.v-btn),
.item-quick-edit__actions :deep(.item-quick-edit__cancel) {
	border: 1px solid #b7202a;
	background: #dc343d !important;
	color: #ffffff !important;
}

.item-quick-edit__actions :deep(.v-btn.text-primary),
.item-quick-edit__actions :deep(.text-primary.v-btn),
.item-quick-edit__actions :deep(.item-quick-edit__update) {
	border: 1px solid #084d96;
	background: var(--counter-rugged-blue) !important;
	color: #ffffff !important;
}

:deep(.posa-quick-edit-keyboard-box) {
	position: relative;
	outline: 3px solid rgb(var(--v-theme-primary));
	outline-offset: 3px;
	border-radius: 3px;
	box-shadow: 0 0 0 5px rgba(var(--v-theme-primary), 0.16);
	z-index: 1;
}

:deep(.posa-quick-edit-keyboard-box .v-field) {
	box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}

@media (max-width: 820px) {
	.item-quick-edit__grid,
	.item-quick-edit__lookup {
		grid-template-columns: 1fr;
	}

	.item-quick-edit__section--identity {
		grid-column: auto;
	}
}
</style>
