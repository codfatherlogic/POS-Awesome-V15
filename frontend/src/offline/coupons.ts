import { memory, persist } from "./db";

export function saveCoupons(customer: string, coupons: unknown) {
	try {
		const cache = memory.coupons_cache || {};
		const clean =
			typeof structuredClone === "function"
				? structuredClone(coupons)
				: JSON.parse(JSON.stringify(coupons));
		cache[customer] = clean;
		memory.coupons_cache = cache;
		persist("coupons_cache", memory.coupons_cache);
	} catch (e) {
		console.error("Failed to cache coupons", e);
	}
}

export function getCachedCoupons(customer: string) {
	try {
		const cache = memory.coupons_cache || {};
		return cache[customer] || [];
	} catch (e) {
		console.error("Failed to get cached coupons", e);
		return [];
	}
}

export function clearCoupons(customer?: string) {
	try {
		const cache = memory.coupons_cache || {};
		if (customer) {
			delete cache[customer];
		} else {
			for (const key in cache) {
				delete cache[key];
			}
		}
		memory.coupons_cache = cache;
		persist("coupons_cache", memory.coupons_cache);
	} catch (e) {
		console.error("Failed to clear coupons cache", e);
	}
}
