const EMPTY_SENTINELS = new Set([
	"",
	"-",
	".",
	"n/a",
	"na",
	"none",
	"null",
	"undefined",
]);

export function cleanPharmacyText(value: unknown): string {
	const withoutControls = Array.from(String(value ?? ""), (character) => {
		const code = character.charCodeAt(0);
		return code <= 31 || code === 127 ? " " : character;
	}).join("");
	const cleaned = withoutControls.replace(/\s+/g, " ").trim();
	return EMPTY_SENTINELS.has(cleaned.toLowerCase()) ? "" : cleaned;
}

export function resolvePackLabel(item: Record<string, any>): string {
	const explicit = cleanPharmacyText(
		item?.retailmind_old_pos_pack ?? item?.pack,
	);
	if (explicit) return explicit;
	const units = Number(
		item?.retailmind_units_per_pack ?? item?.units_per_pack,
	);
	return Number.isFinite(units) && units > 1
		? `${units} ${item?.stock_uom || "Nos"}`
		: "";
}

export function resolveRetailPrice(item: Record<string, any>): number {
	for (const value of [
		item?.original_rate,
		item?.rate,
		item?.price_list_rate,
		item?.standard_rate,
	]) {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) return numeric;
	}
	return 0;
}

export type PackLooseProjection = {
	canSplit: boolean;
	packQty: number | null;
	looseQty: number | null;
	availableQty: number;
	uom: string;
};

export function projectPackLooseStock(
	item: Record<string, any>,
): PackLooseProjection {
	const availableQty = Number(
		item?.actual_qty ?? item?.available_qty ?? item?.stock_qty ?? 0,
	);
	const normalizedQty = Number.isFinite(availableQty) ? availableQty : 0;
	const unitsPerPack = Number(
		item?.retailmind_units_per_pack ?? item?.units_per_pack,
	);
	const uom = cleanPharmacyText(item?.stock_uom || item?.uom) || "Nos";
	const canSplit =
		uom.toLowerCase() === "nos" &&
		normalizedQty >= 0 &&
		Number.isInteger(unitsPerPack) &&
		unitsPerPack > 1;

	if (!canSplit) {
		return {
			canSplit: false,
			packQty: null,
			looseQty: null,
			availableQty: normalizedQty,
			uom,
		};
	}

	const packQty = Math.floor(normalizedQty / unitsPerPack);
	const looseQty = Number(
		(normalizedQty - packQty * unitsPerPack).toFixed(6),
	);
	return {
		canSplit: true,
		packQty,
		looseQty,
		availableQty: normalizedQty,
		uom,
	};
}

export function pharmacySearchFieldValue(
	item: Record<string, any>,
	field: string,
): string {
	const fieldValues: Record<string, unknown[]> = {
		code: [item?.item_code],
		product: [item?.item_name, item?.retailmind_short_name],
		pack: [
			item?.retailmind_old_pos_pack,
			item?.pack,
			item?.retailmind_units_per_pack,
			item?.units_per_pack,
		],
		company: [
			item?.brand,
			item?.company,
			item?.retailmind_old_pos_company_code,
			item?.company_code,
		],
		group: [item?.item_group],
		generic: [
			item?.retailmind_old_pos_generic_name,
			item?.retailmind_old_pos_generic_code,
			item?.generic_name,
			item?.generic_code,
		],
		rack: [item?.retailmind_old_pos_rack, item?.rack],
	};
	return (fieldValues[field] || Object.values(fieldValues).flat())
		.map(cleanPharmacyText)
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
}

export function filterPharmacySearchItems(
	items: Record<string, any>[],
	options: {
		searchTerm?: string;
		searchField?: string;
		includeZeroStock?: boolean;
	} = {},
) {
	const searchWords = cleanPharmacyText(options.searchTerm)
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	const searchField = options.searchField || "all";

	return (Array.isArray(items) ? items : []).filter((item) => {
		const stock = Number(
			item?.actual_qty ?? item?.available_qty ?? item?.stock_qty ?? 0,
		);
		if (
			!options.includeZeroStock &&
			Number(item?.is_stock_item) !== 0 &&
			(!Number.isFinite(stock) || stock <= 0)
		) {
			return false;
		}
		if (searchField === "all" || !searchWords.length) return true;
		const searchable = pharmacySearchFieldValue(item, searchField);
		return searchWords.every((word) => searchable.includes(word));
	});
}
