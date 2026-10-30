<template>
	<v-row justify="center">
		<v-dialog v-model="dialogVisible" max-width="920px">
			<v-card min-height="500px">
				<v-card-title>
					<span class="text-h5 text-primary">{{ __("Select Item") }}</span>
					<v-spacer></v-spacer>
					<v-btn color="error" theme="dark" @click="close_dialog">{{ __("Close") }}</v-btn>
				</v-card-title>
				<v-card-text class="pa-0">
					<v-container v-if="parentItem">
						<div v-for="attr in parentItem.attributes" :key="attr.attribute">
							<v-chip-group
								v-model="filters[attr.attribute]"
								selected-class="green--text text--accent-4"
								column
								@update:model-value="updateFiltredItems"
							>
								<v-chip
									v-for="value in attr.values"
									:key="value.abbr"
									:value="value.attribute_value"
									variant="outlined"
									label
								>
									{{ value.attribute_value }}
								</v-chip>
								<v-chip
									v-if="filters[attr.attribute]"
									:value="null"
									variant="text"
									color="primary"
									@click.stop="clearFilter(attr.attribute)"
								>
									{{ __("Clear") }}
								</v-chip>
							</v-chip-group>
							<v-divider class="p-0 m-0"></v-divider>
						</div>
						<div>
							<v-row density="default" class="variant-grid overflow-y-auto">
								<v-col
									v-for="(item, idx) in displayItems"
									:key="item.item_code || idx"
									md="4"
									sm="6"
									cols="12"
									min-height="50"
								>
									<v-card
										:hover="!isUnavailable(item)"
										:disabled="isUnavailable(item)"
										:aria-disabled="isUnavailable(item)"
										:title="isUnavailable(item) ? __('Out of Stock') : item.item_name"
										class="variant-card"
										:class="{ 'variant-card--unavailable': isUnavailable(item) }"
										@click="add_item(item)"
									>
										<v-img
											:src="item.image || placeholderImage"
											class="text-white align-end"
											gradient="to bottom, rgba(0,0,0,.2), rgba(0,0,0,.7)"
											height="132px"
										>
											<v-card-text
												v-text="item.item_name"
												class="text-subtitle-2 px-1 pb-2"
											></v-card-text>
										</v-img>
										<v-card-text class="text--primary pa-1">
											<div
												class="text-caption text-primary text-accent-3 variant-price"
											>
												{{
													formatCurrencySafe(item.price_list_rate ?? item.rate ?? 0)
												}}
												{{ item.currency || "" }}
											</div>
											<div class="variant-meta-panel">
												<div class="variant-meta-row">
													<v-icon size="x-small">mdi-barcode</v-icon>
													<div class="variant-meta-copy">
														<span class="variant-meta-label">{{
															__("Barcode")
														}}</span>
														<span
															class="variant-meta-value variant-barcode-value"
															:title="variantBarcode(item) || ''"
														>
															{{ variantBarcode(item) || "—" }}
														</span>
													</div>
												</div>
												<div class="variant-meta-row">
													<v-icon size="x-small">mdi-package-variant-closed</v-icon>
													<div class="variant-meta-copy">
														<span class="variant-meta-label">{{
															__("Available Qty")
														}}</span>
														<span class="variant-meta-value">
															{{ formatAvailableQty(item) }}
															{{
																variantAvailableQty(item) === null
																	? ""
																	: item.stock_uom || ""
															}}
														</span>
													</div>
												</div>
											</div>
											<div v-if="isUnavailable(item)" class="variant-out-of-stock">
												{{ __("Out of Stock") }}
											</div>
										</v-card-text>
									</v-card>
								</v-col>
								<div v-intersect="loadMore"></div>
							</v-row>
						</div>
					</v-container>
				</v-card-text>
			</v-card>
		</v-dialog>
	</v-row>
</template>

<script>
import { ensurePosProfile } from "../../../../utils/pos_profile";
import _ from "lodash";
import placeholderImage from "../placeholder-image.png";
import { getCurrentInstance } from "vue";
import { useUIStore } from "../../../stores/uiStore.js";
import { useInvoiceStore } from "../../../stores/invoiceStore.js";
import {
	getVariantCardAvailableQty,
	getVariantCardBarcode,
	isVariantCardUnavailable,
} from "../../../utils/variantCard";
export default {
	setup() {
		const { proxy } = getCurrentInstance();
		const eventBus = proxy?.eventBus;
		const uiStore = useUIStore();
		const invoiceStore = useInvoiceStore();
		return { uiStore, invoiceStore, eventBus };
	},
	data: () => ({
		// varaintsDialog: false, // Removed in favor of store state
		parentItem: null,
		items: null,
		filters: {},
		filterdItems: [],
		pos_profile: null,
		attributes_meta: {},
		displayCount: 100,
		placeholderImage,
	}),

	computed: {
		variantsItems() {
			if (!this.parentItem || !Array.isArray(this.items)) {
				return [];
			}
			return this.items.filter((item) => item.variant_of == this.parentItem.item_code);
		},
		displayItems() {
			return this.filterdItems.slice(0, this.displayCount);
		},
		dialogVisible: {
			get() {
				return this.uiStore.variantsDialog;
			},
			set(val) {
				if (!val) this.uiStore.closeVariants();
			},
		},
	},

	watch: {
		items: {
			handler() {
				this.filterdItems = this.variantsItems;
				this.displayCount = 100;
			},
			deep: true,
		},
		parentItem() {
			this.filterdItems = this.variantsItems;
			this.displayCount = 100;
		},
		attributes_meta: {
			handler(newVal) {
				if (this.parentItem && newVal && Object.keys(newVal).length) {
					this.parentItem.attributes = Object.keys(newVal).map((attr) => ({
						attribute: attr,
						values: newVal[attr].map((v) => ({ attribute_value: v, abbr: v })),
					}));
				} else if (this.parentItem) {
					this.parentItem.attributes = [];
				}
				this.$nextTick(() => {
					this.filterdItems = this.variantsItems;
					this.displayCount = 100;
				});
			},
			deep: true,
		},
		filters: {
			handler() {
				this.updateFiltredItems();
			},
			deep: true,
		},
		// Watch for new data from store
		"uiStore.variantsData": {
			async handler(data) {
				if (!data) return;
				const { item, items, profile, attrsMeta } = data;

				this.parentItem = item || null;
				this.items = Array.isArray(items) ? items : [];
				this.filters = {};
				this.attributes_meta = attrsMeta || this.attributes_meta;

				if (
					!this.parentItem.attributes &&
					this.attributes_meta &&
					Object.keys(this.attributes_meta).length
				) {
					this.parentItem.attributes = Object.keys(this.attributes_meta).map((attr) => ({
						attribute: attr,
						values: this.attributes_meta[attr].map((v) => ({ attribute_value: v, abbr: v })),
					}));
				}

				if (profile) {
					this.pos_profile = profile;
				} else {
					this.pos_profile = await ensurePosProfile();
				}

				if (!this.items || this.items.length === 0) {
					const parentCode = item.item_code || item.code || item.name;
					await this.fetchVariants(parentCode, this.pos_profile);
				}

				this.$nextTick(() => {
					this.filterdItems = this.variantsItems;
					this.displayCount = 100;
				});
			},
			deep: true,
		},
	},

	methods: {
		close_dialog() {
			this.uiStore.closeVariants();
		},
		formatCurrency(value) {
			return this.$options.mixins[0].methods.formatCurrency.call(this, value, 2);
		},
		formatCurrencySafe(val) {
			const mixinFn =
				this.$options.mixins &&
				this.$options.mixins[0] &&
				this.$options.mixins[0].methods &&
				this.$options.mixins[0].methods.formatCurrency;

			if (mixinFn) {
				return mixinFn.call(this, val, 2);
			}
			return new Intl.NumberFormat("en-PK", {
				minimumFractionDigits: 0,
				maximumFractionDigits: 2,
			}).format(val);
		},
		variantBarcode(item) {
			return getVariantCardBarcode(item);
		},
		variantAvailableQty(item) {
			return getVariantCardAvailableQty(item);
		},
		formatAvailableQty(item) {
			const quantity = this.variantAvailableQty(item);
			if (quantity === null) return "—";

			const mixinFn =
				this.$options.mixins &&
				this.$options.mixins[0] &&
				this.$options.mixins[0].methods &&
				this.$options.mixins[0].methods.formatFloat;
			if (mixinFn) return mixinFn.call(this, quantity);

			return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(quantity);
		},
		isUnavailable(item) {
			return isVariantCardUnavailable(item, this.pos_profile, this.uiStore.stockSettings);
		},
		applyCurrencyConversionToItem(item) {
			if (!item) return;
			if (!item.original_rate) {
				item.original_rate = item.price_list_rate ?? item.rate ?? 0;
				item.original_currency = item.currency || (this.pos_profile && this.pos_profile.currency);
			}
			// Use original_rate as price list rate in item's currency
			item.base_price_list_rate = item.price_list_rate ?? item.original_rate ?? 0;
			item.base_rate = item.base_rate || item.base_price_list_rate;
			item.rate = item.price_list_rate ?? item.rate ?? 0;
			item.currency = item.currency || (this.pos_profile && this.pos_profile.currency);
		},
		async fetchVariants(code, profile) {
			try {
				const res = await frappe.call({
					method: "posawesome.posawesome.api.items.get_item_variants",
					args: {
						pos_profile: JSON.stringify(profile || this.pos_profile || {}),
						parent_item_code: code,
					},
				});
				if (res.message) {
					const variants = res.message.variants || res.message;
					this.attributes_meta = res.message.attributes_meta || this.attributes_meta;
					const existingCodes = new Set((this.items || []).map((it) => it.item_code));
					const newItems = variants.filter((it) => !existingCodes.has(it.item_code));
					await Promise.all(newItems.map((it) => this.fetchVariantRate(it)));
					this.items = (this.items || []).concat(newItems);
				}
			} catch (e) {
				console.error("Failed to fetch variants", e);
			}
		},
		updateFiltredItems: _.debounce(function () {
			this.$nextTick(() => {
				const values = [];
				Object.entries(this.filters).forEach(([, value]) => {
					if (value) {
						values.push(value);
					}
				});

				if (!values.length) {
					this.filterdItems = this.variantsItems;
				} else {
					const itemsList = [];
					this.filterdItems = [];
					this.variantsItems.forEach((item) => {
						let apply = true;
						let attrs = [];
						if (Array.isArray(item.item_attributes)) {
							attrs = item.item_attributes;
						} else if (
							typeof item.item_attributes === "string" &&
							item.item_attributes.trim().startsWith("[")
						) {
							try {
								attrs = JSON.parse(item.item_attributes);
							} catch {
								attrs = [];
							}
						}
						for (const [attrName, val] of Object.entries(this.filters)) {
							if (!val) continue;
							const found = attrs.find(
								(a) => a.attribute === attrName && String(a.attribute_value) === String(val),
							);
							if (!found) {
								apply = false;
								break;
							}
						}
						if (apply && !itemsList.includes(item.item_code)) {
							this.filterdItems.push(item);
							itemsList.push(item.item_code);
						}
					});
				}
				this.displayCount = 100;
			});
		}, 200),
		clearFilter(attr) {
			this.filters[attr] = null;
			this.$nextTick(() => {
				this.filterdItems = this.variantsItems;
				this.displayCount = 100;
			});
		},
		loadMore() {
			if (this.displayCount < this.filterdItems.length) {
				this.displayCount += 100;
			}
		},
		async fetchVariantRate(item) {
			if (!this.pos_profile) {
				this.pos_profile = await ensurePosProfile();
			}
			if (!this.pos_profile.warehouse) {
				try {
					const res = await frappe.call({
						method: "posawesome.posawesome.api.utils.get_default_warehouse",
						args: { company: this.pos_profile.company },
					});
					if (res.message) {
						this.pos_profile.warehouse = res.message;
					}
				} catch (e) {
					console.error("Failed to fetch default warehouse", e);
				}
			}
			try {
				const res = await frappe.call({
					method: "posawesome.posawesome.api.items.get_item_detail",
					args: {
						warehouse: item.warehouse || this.pos_profile.warehouse,
						price_list: this.pos_profile.selling_price_list,
						company: this.pos_profile.company,
						item: JSON.stringify({
							item_code: item.item_code,
							pos_profile: this.pos_profile.name,
							qty: item.qty || 1,
							uom: item.uom || item.stock_uom,
							doctype: this.pos_profile.create_pos_invoice_instead_of_sales_invoice
								? "POS Invoice"
								: "Sales Invoice",
						}),
					},
				});
				if (res.message) {
					const data = res.message;
					item.rate = data.price_list_rate;
					item.price_list_rate = data.price_list_rate;
					item.base_rate = data.price_list_rate;
					item.base_price_list_rate = data.price_list_rate;
					item.currency = data.currency || data.price_list_currency || this.pos_profile.currency;
					this.applyCurrencyConversionToItem(item);
				}
			} catch (e) {
				console.error("Failed to fetch variant rate", e);
			}
		},
		async add_item(item) {
			if (this.isUnavailable(item)) return;
			await this.fetchVariantRate(item);
			const payload = { ...item, code: item.item_code };
			// Using event bus to trigger logic-heavy add_item in Invoice.vue
			if (this.eventBus) {
				this.eventBus.emit("add_item", payload);
			} else {
				// Fallback to store if eventBus is missing (should not happen)
				this.invoiceStore.addItem(payload);
			}
			this.close_dialog();
		},
	},

	created() {
		// Event listeners removed - using store watchers
	},
	beforeUnmount() {
		// Cleanup if needed
	},
};
</script>

<style scoped>
.variant-card {
	height: 100%;
	min-height: 270px;
}

.variant-grid {
	max-height: min(68vh, 640px);
}

.variant-price {
	font-weight: 600;
	font-size: 0.86rem;
	margin-bottom: 8px;
}

.variant-meta-panel {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px;
	padding: 8px;
	border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
	border-radius: 8px;
	background: rgba(var(--v-theme-on-surface), 0.045);
}

.variant-meta-row {
	display: grid;
	grid-template-columns: 18px minmax(0, 1fr);
	align-items: start;
	gap: 6px;
	min-width: 0;
	line-height: 1.35;
	color: rgba(var(--v-theme-on-surface), 0.72);
}

.variant-meta-copy {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.variant-meta-label {
	font-weight: 600;
	font-size: 0.66rem;
	letter-spacing: 0.03em;
	text-transform: uppercase;
	color: rgba(var(--v-theme-on-surface), 0.62);
}

.variant-meta-value {
	display: block;
	min-height: 1.25rem;
	font-size: 0.82rem;
	font-weight: 700;
	color: rgb(var(--v-theme-on-surface));
	overflow-wrap: anywhere;
}

.variant-barcode-value {
	font-family: ui-monospace, "Cascadia Mono", "Segoe UI Mono", monospace;
	font-size: 0.76rem;
	letter-spacing: 0.02em;
}

.variant-card--unavailable {
	filter: grayscale(0.8);
	opacity: 0.58;
	cursor: not-allowed;
}

.variant-out-of-stock {
	margin-top: 8px;
	font-size: 0.7rem;
	font-weight: 700;
	color: rgb(var(--v-theme-error));
}

@media (max-width: 700px) {
	.variant-card {
		min-height: 250px;
	}
}
</style>
