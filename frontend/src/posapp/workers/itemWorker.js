/* eslint-env worker */
/* global Dexie */

let db;
const BASE_SCHEMA = {
	keyval: "&key",
	queue: "&key",
	write_queue:
		"++queue_id,entity_type,status,resource,next_attempt_at,created_at,last_attempt_at,retry_count,&idempotency_key,[entity_type+status],[status+next_attempt_at]",
	invoice_outbox:
		"++outbox_id,&client_request_id,status,resource,created_at,next_retry_at,nextAttemptAt,retry_count,[status+next_retry_at],[resource+status],[status+nextAttemptAt]",
	cache: "&key",
	items: "&item_code,item_name,item_group,*barcodes,*name_keywords,*serials,*batches",
	item_prices: "&[price_list+item_code],price_list,item_code",
	customers: "&name,customer_name,mobile_no,email_id,tax_id",
	pos_profiles: "&name",
	opening_shifts: "&name,user,pos_profile",
	local_stock: "&key",
	coupons: "&key",
	item_groups: "&key",
	translations: "&key",
	pricing_rules: "&key",
	settings: "&key",
	sync_state: "&key,resourceId,status,nextRetryAt,lastAttemptAt,updated_at",
};

const SCHEMA_V14 = {
	...BASE_SCHEMA,
	item_price_records:
		"&name,price_list,item_code,uom,currency,customer,modified,[price_list+item_code],[price_list+item_code+uom]",
	pricing_rule_records: "&key,rule_name,target_type,target_value,modified,[target_type+target_value]",
	currency_rate_records:
		"&name,profile_name,company,from_currency,to_currency,date,modified,[profile_name+company+from_currency+to_currency]",
};

const SCHEMA_V15 = {
	...SCHEMA_V14,
	write_queue:
		"++queue_id,entity_type,status,resource,next_attempt_at,created_at,last_attempt_at,retry_count,&idempotency_key,[entity_type+status],[status+next_attempt_at],[status+last_attempt_at],[status+created_at]",
	invoice_outbox:
		"++outbox_id,&client_request_id,status,resource,created_at,updated_at,acknowledged_at,next_retry_at,nextAttemptAt,retry_count,[status+next_retry_at],[resource+status],[status+nextAttemptAt],[status+acknowledged_at],[status+updated_at],[status+created_at]",
};

const SCHEMA_V16 = {
	...SCHEMA_V15,
	items: "&item_code,item_name,item_group,profile_scope,item_code_lc,item_name_lc,*barcodes,*barcodes_lc,*name_keywords,*name_keywords_lc,*serials,*batches",
};

const SCHEMA_V17 = {
	...SCHEMA_V16,
	item_catalog_rows:
		"&[profile_scope+catalog_generation+item_code],[profile_scope+catalog_generation],profile_scope,catalog_generation,item_code,item_name,item_group,item_code_lc,item_name_lc,*barcodes,*barcodes_lc,*name_keywords,*name_keywords_lc,*serials,*batches",
	item_catalog_state: "&profile_scope,active_generation,updated_at",
};

const SCHEMA_V18 = {
	...SCHEMA_V17,
	customers: "&name,customer_name,mobile_no,email_id,tax_id,*_mobile_search_keys",
};

const SCHEMA_SIGNATURE = JSON.stringify(SCHEMA_V18);

const normalizeSearchValue = (value) =>
	String(value || "")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();

const uniqueStrings = (values) =>
	Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));

const deriveItemSearchFields = (it) => {
	const barcodes = uniqueStrings([
		...(Array.isArray(it.item_barcode)
			? it.item_barcode.map((b) => b && b.barcode)
			: it.item_barcode
				? [String(it.item_barcode)]
				: []),
		...(Array.isArray(it.barcodes)
			? it.barcodes.map((entry) => (entry && typeof entry === "object" ? entry.barcode : entry))
			: []),
	]);
	const nameKeywords = uniqueStrings(it.item_name ? normalizeSearchValue(it.item_name).split(/\s+/) : []);
	const itemCodeLc = normalizeSearchValue(it.item_code);
	const itemNameLc = normalizeSearchValue(it.item_name);
	const barcodesLc = barcodes.map(normalizeSearchValue).filter(Boolean);
	const nameKeywordsLc = nameKeywords.map(normalizeSearchValue).filter(Boolean);

	return {
		barcodes,
		name_keywords: nameKeywords,
		item_code_lc: itemCodeLc,
		item_name_lc: itemNameLc,
		barcodes_lc: barcodesLc,
		name_keywords_lc: nameKeywordsLc,
		search_text: [itemCodeLc, itemNameLc, ...barcodesLc, ...nameKeywordsLc].filter(Boolean).join(" "),
	};
};

const workerStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
const workerTraceEnabled = (() => {
	try {
		return new URL(self.location.href).searchParams.get("posa_startup_trace") === "1";
	} catch {
		return false;
	}
})();
const workerNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const workerTrace = (phase, status, details = {}) => {
	if (!workerTraceEnabled) return;
	console.info(
		`[POSA_STARTUP] ${JSON.stringify({
			phase,
			status,
			atMs: Math.round((workerNow() - workerStartedAt) * 10) / 10,
			details,
		})}`,
	);
};

const dbReady = (async () => {
	const openStartedAt = workerNow();
	workerTrace("persistence_worker.indexeddb_open", "start", { requestedVersion: 18 });
	let DexieLib;
	try {
		importScripts("/assets/posawesome/dist/js/libs/dexie.min.js?v=1");
		DexieLib = { default: Dexie };
	} catch {
		// Fallback to dynamic import when importScripts fails
		DexieLib = await import("/assets/posawesome/dist/js/libs/dexie.min.js?v=1");
	}
	db = new DexieLib.default("posawesome_offline");
	// Keep the worker schema declarations identical to the main Dexie owner. The
	// worker must never run historical full-table migrations during application
	// startup; normalized search fields are written by current catalog sync paths.
	db.version(1).stores(BASE_SCHEMA);
	db.version(7).stores(BASE_SCHEMA);
	db.version(8).stores(BASE_SCHEMA);
	db.version(9).stores(BASE_SCHEMA);
	db.version(10).stores(BASE_SCHEMA);
	db.version(11).stores(BASE_SCHEMA);
	db.version(12).stores(BASE_SCHEMA);
	db.version(13).stores(BASE_SCHEMA);
	db.version(14).stores(SCHEMA_V14);
	db.version(15).stores(SCHEMA_V15);
	db.version(16).stores(SCHEMA_V16);
	db.version(17)
		.stores(SCHEMA_V17)
		.upgrade((tx) =>
			tx.table("settings").put({
				key: "schema_signature",
				value: SCHEMA_SIGNATURE,
			}),
		);
	db.version(18)
		.stores(SCHEMA_V18)
		.upgrade((tx) =>
			tx.table("settings").put({
				key: "schema_signature",
				value: SCHEMA_SIGNATURE,
			}),
		);
	try {
		await db.open();
		const openDurationMs = workerNow() - openStartedAt;
		workerTrace("persistence_worker.indexeddb_open", "ok", {
			databaseVersion: db.verno,
			openDurationMs,
		});
		self.postMessage({
			type: "persistence_worker_ready",
			databaseVersion: db.verno,
			openDurationMs,
		});
	} catch (err) {
		console.error("Failed to open IndexedDB in worker", err);
		workerTrace("persistence_worker.indexeddb_open", "error", {
			name: err?.name,
			message: err?.message || String(err),
		});
	}
	return db;
})();

const KEY_TABLE_MAP = {
	offline_invoices: "queue",
	offline_customers: "queue",
	offline_payments: "queue",
	offline_cash_movements: "queue",
	item_details_cache: "cache",
	stored_value_snapshot_cache: "cache",
	gift_card_snapshot_cache: "cache",
	delivery_charges_cache: "cache",
	currency_options_cache: "cache",
	exchange_rate_cache: "cache",
	price_list_meta_cache: "cache",
	customer_addresses_cache: "cache",
	payment_method_currency_cache: "cache",
	local_stock_cache: "local_stock",
	coupons_cache: "coupons",
	item_groups_cache: "item_groups",
	translation_cache: "translations",
	pricing_rules_snapshot: "pricing_rules",
	pricing_rules_context: "pricing_rules",
	pricing_rules_last_sync: "pricing_rules",
	pricing_rules_stale_at: "pricing_rules",
	cache_version: "settings",
	cache_ready: "settings",
	stock_cache_ready: "settings",
	manual_offline: "settings",
	invoice_outbox_mode: "settings",
	bootstrap_snapshot: "settings",
	bootstrap_snapshot_status: "settings",
	bootstrap_limited_mode: "settings",
	schema_signature: "settings",
	items_last_sync: "sync_state",
	customers_last_sync: "sync_state",
	payment_methods_last_sync: "sync_state",
	pos_last_sync_totals: "sync_state",
};

// customer_storage is only an in-process hot cache. Durable customers live in
// the IndexedDB `customers` table, so the worker never persists this key.
const MEMORY_ONLY_KEYS = new Set(["customer_storage"]);
let persistBatchChain = Promise.resolve();

function tableForKey(key) {
	return KEY_TABLE_MAP[key] || "keyval";
}

async function safeBulkPut(tableName, rows) {
	if (!rows.length) {
		return;
	}

	const table = db.table(tableName);
	try {
		await db.transaction("rw", table, async () => {
			await table.bulkPut(rows);
		});
	} catch (error) {
		console.warn(`Worker bulkPut failed for ${tableName}; retrying row-by-row`, error);
		await db.transaction("rw", table, async () => {
			for (const row of rows) {
				await table.put(row);
			}
		});
	}
}

async function persistBatch(entries) {
	const startedAt = workerNow();
	await dbReady;
	if (!db.isOpen()) {
		await db.open();
	}
	const rowsByTable = new Map();
	for (const entry of entries || []) {
		if (!entry || MEMORY_ONLY_KEYS.has(entry.key)) {
			continue;
		}
		const tableName = tableForKey(entry.key);
		const rows = rowsByTable.get(tableName) || [];
		rows.push({ key: entry.key, value: entry.value });
		rowsByTable.set(tableName, rows);
	}

	await Promise.all(
		Array.from(rowsByTable.entries()).map(([tableName, rows]) => safeBulkPut(tableName, rows)),
	);
	return {
		durationMs: workerNow() - startedAt,
		tables: Array.from(rowsByTable, ([tableName, rows]) => ({
			tableName,
			recordCount: rows.length,
		})),
		recordCount: Array.from(rowsByTable.values()).reduce((total, rows) => total + rows.length, 0),
	};
}

async function bulkPutItems(items, syncedAt = Date.now()) {
	try {
		await dbReady;
		if (!db.isOpen()) {
			await db.open();
		}
		const CHUNK_SIZE = 1000;
		await db.transaction("rw", db.table("items"), async () => {
			for (let i = 0; i < items.length; i += CHUNK_SIZE) {
				const chunk = items.slice(i, i + CHUNK_SIZE).map((item) => ({
					...item,
					synced_at: syncedAt,
				}));
				await db.table("items").bulkPut(chunk);
			}
		});
	} catch (e) {
		console.error("Worker bulkPut items failed", e);
	}
}

async function bulkPutPrices(priceList, items, syncedAt = Date.now()) {
	try {
		if (!priceList) {
			return;
		}
		await dbReady;
		if (!db.isOpen()) {
			await db.open();
		}
		const records = items.map((it) => {
			const price = it.price_list_rate ?? it.rate ?? 0;
			return {
				price_list: priceList,
				item_code: it.item_code,
				rate: price,
				price_list_rate: price,
				timestamp: syncedAt,
			};
		});
		await db.table("item_prices").bulkPut(records);
	} catch (e) {
		console.error("Worker bulkPut prices failed", e);
	}
}

self.onmessage = async (event) => {
	// Logging every message can flood the console and increase memory usage
	// when the worker is used for frequent persistence operations. Remove
	// the noisy log to keep the console clean.
	const data = event.data || {};
	if (data.type === "parse_and_cache") {
		try {
			let parsed = JSON.parse(data.json);
			let itemsRaw = parsed.message || parsed;
			let items;
			const syncTimestamp = data.syncedAt || Date.now();
			try {
				if (typeof structuredClone === "function") {
					items = structuredClone(itemsRaw);
				} else {
					// Fallback for older browsers
					items = JSON.parse(JSON.stringify(itemsRaw));
				}
			} catch (e) {
				console.error("Failed to clone items", e);
				self.postMessage({ type: "error", error: e.message });
				return;
			}
			let trimmed = items.map((it) => ({
				item_code: it.item_code,
				item_name: it.item_name,
				description: it.description,
				stock_uom: it.stock_uom,
				image: it.image,
				item_group: it.item_group,
				rate: it.rate,
				price_list_rate: it.price_list_rate,
				currency: it.currency,
				item_barcode: it.item_barcode,
				item_uoms: it.item_uoms,
				actual_qty: it.actual_qty,
				has_batch_no: it.has_batch_no,
				has_serial_no: it.has_serial_no,
				// Keep the complete assignment metadata for offline manual selection.
				// The flattened arrays below remain search indexes only.
				batch_no_data: Array.isArray(it.batch_no_data)
					? it.batch_no_data
					: [],
				serial_no_data: Array.isArray(it.serial_no_data)
					? it.serial_no_data
					: [],
				has_variants: !!it.has_variants,
				...deriveItemSearchFields(it),
				serials: Array.isArray(it.serial_no_data)
					? it.serial_no_data.map((s) => s.serial_no).filter(Boolean)
					: [],
				batches: Array.isArray(it.batch_no_data)
					? it.batch_no_data.map((b) => b.batch_no).filter(Boolean)
					: [],
			}));
			await bulkPutItems(trimmed, syncTimestamp);
			await bulkPutPrices(data.priceList, trimmed, syncTimestamp);
			// Clear references to release memory before posting back
			items = null;
			itemsRaw = null;
			data.json = null;
			parsed = null;
			let out = trimmed;
			self.postMessage({ type: "parsed", items: out });
			trimmed.length = 0;
			trimmed = null;
		} catch (err) {
			console.log(err);
			self.postMessage({ type: "error", error: err.message });
		}
	} else if (data.type === "persist_batch") {
		try {
			const operation = persistBatchChain.then(() => persistBatch(data.entries));
			persistBatchChain = operation.catch(() => undefined);
			const diagnostics = await operation;
			self.postMessage({
				type: "persisted_batch",
				batchId: data.batchId,
				...diagnostics,
			});
		} catch (error) {
			console.error("Worker persist batch failed", error);
			self.postMessage({
				type: "persist_batch_failed",
				batchId: data.batchId,
				error: error?.message || String(error),
			});
		}
	} else if (data.type === "bulk_put_items") {
		await bulkPutItems(data.items || [], data.syncedAt || Date.now());
		self.postMessage({ type: "items_saved" });
	}
};
