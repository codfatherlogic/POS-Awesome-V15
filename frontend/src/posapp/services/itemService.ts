import api from "./api";
import { unwrapApiResult, type ApiEnvelope } from "./api";
import type { Item } from "../types/models";

export interface ItemGroup {
	name: string;
}

export interface GetItemsArgs {
	pos_profile: string;
	price_list: string;
	item_group?: string;
	search_value?: string;
	customer?: string | null;
	include_image?: number;
	item_groups?: string[];
	limit?: number;
	offset?: number;
	start_after?: string | null;
	modified_after?: string;
}

export interface GetItemsCountArgs {
	pos_profile: string;
	item_groups?: string[];
}

export interface GetHotItemsArgs {
	pos_profile: string;
	price_list?: string;
	customer?: string | null;
	limit?: number;
	days?: number;
	include_description?: number;
	include_image?: number;
	item_groups?: string[];
}

export interface BarcodeLookupArgs {
	selling_price_list: string;
	currency: string;
	barcode: string;
}

export interface ItemQuickEditArgs {
	item_code?: string;
	barcode?: string;
	pos_profile?: string | Record<string, unknown>;
}

export type AlternateGenericField =
	| "retailmind_old_pos_generic_code"
	| "retailmind_old_pos_generic_name";

export type AlternateItemsReason =
	| "missing_generic"
	| "no_same_generic_items"
	| "no_in_stock_priced_alternates";

export type AlternateItemCostSource =
	| "buying_price"
	| "warehouse_valuation"
	| "item_valuation"
	| "last_purchase";

export interface GetAlternateItemsArgs {
	item_code: string;
	pos_profile?: string;
	warehouse?: string;
	price_list?: string;
	company?: string;
	customer?: string | null;
	qty?: number;
	limit?: number;
}

export interface AlternateRequestedItem {
	item_code: string;
	item_name: string | null;
	generic_field: AlternateGenericField | null;
	generic: string | null;
}

export interface AlternateItemsContext {
	pos_profile: string;
	company: string;
	warehouse: string;
	price_list: string;
	currency: string;
	requested_qty: number;
}

export interface AlternateItem {
	item_code: string;
	item_name: string | null;
	item_group: string | null;
	generic_code: string | null;
	generic_name: string | null;
	pack: string | null;
	company: string | null;
	company_code: string | null;
	rack: string | null;
	stock_uom: string | null;
	uom: string | null;
	units_per_pack: number;
	available_qty: number;
	pack_stock: number;
	loose_stock: number;
	rate: number;
	retail_price: number;
	currency: string;
	has_batch_no: number;
	has_serial_no: number;
	can_fulfill_requested_qty: boolean;
	replacement_reason: "same_generic_in_stock";
	profit_display_allowed: boolean;
	cost_rate?: number;
	cost_source?: AlternateItemCostSource;
	profit_per_unit?: number;
	profit_amount?: number;
	margin_percent?: number | null;
}

export interface AlternateItemsResponse {
	requested_item: AlternateRequestedItem;
	context: AlternateItemsContext;
	profit_display_allowed: boolean;
	items: AlternateItem[];
	reason: AlternateItemsReason | null;
	candidate_metadata_ttl_seconds: number;
	candidate_pool_truncated: boolean;
	stock_cached: false;
}

function buildItemDoc(itemData: Partial<Item>) {
	const doc: Record<string, unknown> = {
		doctype: "Item",
		is_stock_item: 1,
		...itemData,
	};
	const normalizedBarcode =
		typeof doc.barcode === "string" ? doc.barcode.trim() : "";

	if (normalizedBarcode) {
		doc.barcodes = [{ barcode: normalizedBarcode }];
	}

	delete doc.barcode;
	return doc;
}

const itemService = {
	getItemGroups(): Promise<ApiEnvelope<ItemGroup[]>> {
		return api.callEnvelope(
			"posawesome.posawesome.api.items.get_items_groups",
		);
	},

	async getItemGroupsData(): Promise<ItemGroup[]> {
		return unwrapApiResult(await this.getItemGroups());
	},

	getItems(
		args: GetItemsArgs,
		signal?: AbortSignal,
	): Promise<ApiEnvelope<Item[]>> {
		return api.callEnvelope(
			"posawesome.posawesome.api.items.get_items",
			args,
			{
				signal,
			},
		);
	},

	async getItemsData(
		args: GetItemsArgs,
		signal?: AbortSignal,
	): Promise<Item[]> {
		return unwrapApiResult(await this.getItems(args, signal));
	},

	getHotItems(
		args: GetHotItemsArgs,
		signal?: AbortSignal,
	): Promise<ApiEnvelope<Item[]>> {
		return api.callEnvelope(
			"posawesome.posawesome.api.items.get_hot_items",
			args,
			{
				signal,
			},
		);
	},

	async getHotItemsData(
		args: GetHotItemsArgs,
		signal?: AbortSignal,
	): Promise<Item[]> {
		return unwrapApiResult(await this.getHotItems(args, signal));
	},

	getItemsCount(
		args: GetItemsCountArgs,
	): Promise<ApiEnvelope<number>> {
		return api.callEnvelope(
			"posawesome.posawesome.api.items.get_items_count",
			args,
		);
	},

	async getItemsCountData(args: GetItemsCountArgs): Promise<number> {
		return unwrapApiResult(await this.getItemsCount(args));
	},

	getItemsFromBarcode(
		args: BarcodeLookupArgs,
	): Promise<ApiEnvelope<Item | null>> {
		return api.callEnvelope(
			"posawesome.posawesome.api.items.get_items_from_barcode",
			args,
		);
	},

	async getItemsFromBarcodeData(
		args: BarcodeLookupArgs,
	): Promise<Item | null> {
		return unwrapApiResult(await this.getItemsFromBarcode(args));
	},

	getAlternateItems(
		args: GetAlternateItemsArgs,
		signal?: AbortSignal,
	): Promise<ApiEnvelope<AlternateItemsResponse>> {
		return api.callEnvelope(
			"posawesome.posawesome.api.items.get_alternate_items",
			args,
			{ signal },
		);
	},

	async getAlternateItemsData(
		args: GetAlternateItemsArgs,
		signal?: AbortSignal,
	): Promise<AlternateItemsResponse> {
		return unwrapApiResult(await this.getAlternateItems(args, signal));
	},

	getItemBrand(itemCode: string): Promise<ApiEnvelope<string>> {
		return api.callEnvelope(
			"posawesome.posawesome.api.items.get_item_brand",
			{ item_code: itemCode },
		);
	},

	async getItemBrandData(itemCode: string): Promise<string> {
		return unwrapApiResult(await this.getItemBrand(itemCode));
	},

	getUOMs(): Promise<ApiEnvelope<{ name: string }[]>> {
		return api.callEnvelope("frappe.client.get_list", {
			doctype: "UOM",
			fields: ["name"],
			limit_page_length: 0,
		});
	},

	async getUOMsData(): Promise<{ name: string }[]> {
		return unwrapApiResult(await this.getUOMs());
	},

	createItem(itemData: Partial<Item>): Promise<ApiEnvelope<Item>> {
		return api.callEnvelope("frappe.client.insert", {
			doc: buildItemDoc(itemData),
		});
	},

	async createItemData(itemData: Partial<Item>): Promise<Item> {
		return unwrapApiResult(await this.createItem(itemData));
	},

	getItemQuickEdit(args: ItemQuickEditArgs): Promise<ApiEnvelope<any>> {
		return api.callEnvelope(
			"posawesome.posawesome.api.item_quick_edit.get_item_quick_edit",
			args,
		);
	},

	async getItemQuickEditData(args: ItemQuickEditArgs): Promise<any> {
		return unwrapApiResult(await this.getItemQuickEdit(args));
	},

	saveItemQuickEdit(data: Record<string, unknown>): Promise<ApiEnvelope<any>> {
		return api.callEnvelope(
			"posawesome.posawesome.api.item_quick_edit.save_item_quick_edit",
			{ data: JSON.stringify(data) },
		);
	},

	async saveItemQuickEditData(data: Record<string, unknown>): Promise<any> {
		return unwrapApiResult(await this.saveItemQuickEdit(data));
	},
};

export default itemService;
