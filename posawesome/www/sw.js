const CACHE_PREFIX = "posawesome-cache-";
const CACHE_COMPLETE_KEY = "/__posawesome_cache_complete__";
const VERSION_URL = "/assets/posawesome/dist/js/version.json";
const DEFAULT_CACHE_VERSION = "default";
const MAX_CACHE_ITEMS = 1000;

const STATIC_PRECACHE_URLS = [
	"/app/posapp",
	"/assets/posawesome/dist/js/posapp/workers/itemWorker.js",
	"/assets/posawesome/dist/js/libs/dexie.min.js",
	"/manifest.json",
	"/offline.html",
];

function buildVersionedAssetUrl(url, version) {
	return `${url}?v=${encodeURIComponent(version || DEFAULT_CACHE_VERSION)}`;
}

function pickAssetUrl(assets, key, fallbackPath, version) {
	const value = typeof assets?.[key] === "string" ? assets[key].trim() : "";
	return value || buildVersionedAssetUrl(fallbackPath, version);
}

function getPrecacheUrls(version, assets = {}) {
	const fontAssets = Array.isArray(assets.fonts)
		? assets.fonts.filter((url) => typeof url === "string" && url.trim())
		: [];
	return Array.from(
		new Set([
			pickAssetUrl(
				assets,
				"loader",
				"/assets/posawesome/dist/js/loader.js",
				version,
			),
			pickAssetUrl(
				assets,
				"css",
				"/assets/posawesome/dist/js/posawesome.css",
				version,
			),
			pickAssetUrl(
				assets,
				"posawesome",
				"/assets/posawesome/dist/js/posawesome.js",
				version,
			),
			pickAssetUrl(
				assets,
				"offlineIndex",
				"/assets/posawesome/dist/js/offline/index.js",
				version,
			),
			...fontAssets,
			...STATIC_PRECACHE_URLS,
		]),
	);
}

function requestUrl(value) {
	if (typeof value === "string") {
		return new URL(value, self.location.origin).href;
	}
	return value?.url || "";
}

let candidateSequence = 0;
function createCandidateCacheName(version) {
	candidateSequence += 1;
	const safeVersion = String(version || DEFAULT_CACHE_VERSION).replace(
		/[^a-zA-Z0-9._-]/g,
		"_",
	);
	const randomPart =
		typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
			? crypto.randomUUID()
			: Math.random().toString(16).slice(2);
	return `${CACHE_PREFIX}${safeVersion}-candidate-${Date.now()}-${candidateSequence}-${randomPart}`;
}

let cachedCacheName = null;
let cacheNameInFlight = null;
let currentVersion = null;
let currentAssets = {};
let currentPrecacheUrls = [];

function extractBuildVersion(payload) {
	const version = payload?.version || payload?.buildVersion;
	return typeof version === "string" && version.trim().length
		? version.trim()
		: DEFAULT_CACHE_VERSION;
}

function extractBuildAssets(payload) {
	return payload?.assets && typeof payload.assets === "object"
		? payload.assets
		: {};
}

async function resolveBuildMetadata() {
	try {
		const response = await fetch(VERSION_URL, { cache: "no-store" });
		if (response?.ok) {
			const payload = await response.json();
			return {
				version: extractBuildVersion(payload),
				assets: extractBuildAssets(payload),
			};
		}
	} catch (error) {
		console.warn("SW: failed to fetch build version", error);
	}
	return null;
}

async function readCompleteMarker(cacheName) {
	try {
		const cache = await caches.open(cacheName);
		const response = await cache.match(CACHE_COMPLETE_KEY);
		if (!response) return null;
		const marker = await response.json();
		return marker?.complete === true ? marker : null;
	} catch {
		return null;
	}
}

async function isCompleteVersionCache(cacheName, version, urls) {
	const marker = await readCompleteMarker(cacheName);
	if (!marker || marker.version !== version) return false;

	const requiredUrls = Array.isArray(urls) && urls.length ? urls : marker.urls;
	if (!Array.isArray(requiredUrls) || !requiredUrls.length) return false;

	const cache = await caches.open(cacheName);
	const entries = await Promise.all(
		requiredUrls.map((url) => cache.match(url)),
	);
	return entries.every(Boolean);
}

async function listCompleteCaches(version = null) {
	const keys = (await caches.keys()).filter((key) => key.startsWith(CACHE_PREFIX));
	const candidates = await Promise.all(
		keys.map(async (cacheName) => ({
			cacheName,
			marker: await readCompleteMarker(cacheName),
		})),
	);
	const valid = [];
	for (const candidate of candidates) {
		if (
			candidate.marker &&
			(!version || candidate.marker.version === version) &&
			(await isCompleteVersionCache(
				candidate.cacheName,
				candidate.marker.version,
				candidate.marker.urls,
			))
		) {
			valid.push(candidate);
		}
	}
	return valid.sort(
		(a, b) =>
			Number(b.marker.createdAt || 0) - Number(a.marker.createdAt || 0),
	);
}

async function findLatestCompleteCache(version = null) {
	const [latest] = await listCompleteCaches(version);
	if (!latest) return null;
	return {
		cacheName: latest.cacheName,
		marker: latest.marker,
		metadata: {
			version: latest.marker.version,
			assets: latest.marker.assets || {},
		},
	};
}

async function enforceCacheLimit(cache, protectedUrls = currentPrecacheUrls) {
	const keys = await cache.keys();
	if (keys.length <= MAX_CACHE_ITEMS) return;

	const protectedKeys = new Set(
		[CACHE_COMPLETE_KEY, ...protectedUrls].map(requestUrl),
	);
	let excess = keys.length - MAX_CACHE_ITEMS;
	for (const key of keys) {
		if (excess <= 0) break;
		if (protectedKeys.has(requestUrl(key))) continue;
		await cache.delete(key);
		excess -= 1;
	}
}

async function populateCandidateCache(metadata) {
	const { version, assets = {} } = metadata;
	const urls = getPrecacheUrls(version, assets);
	const candidateCacheName = createCandidateCacheName(version);

	try {
		const fetched = await Promise.all(
			urls.map(async (url) => {
				const response = await fetch(url, { cache: "no-store" });
				if (!response?.ok) {
					throw new Error(`Required POS asset failed to cache: ${url}`);
				}
				return [url, response];
			}),
		);

		const cache = await caches.open(candidateCacheName);
		await Promise.all(
			fetched.map(([url, response]) => cache.put(url, response)),
		);
		await cache.put(
			CACHE_COMPLETE_KEY,
			new Response(
				JSON.stringify({
					complete: true,
					version,
					assets,
					urls,
					createdAt: Date.now(),
					healthAcknowledged: false,
				}),
				{ headers: { "Content-Type": "application/json" } },
			),
		);

		if (!(await isCompleteVersionCache(candidateCacheName, version, urls))) {
			throw new Error(`POS cache generation ${version} failed validation`);
		}
		await enforceCacheLimit(cache, urls);
		return {
			cacheName: candidateCacheName,
			metadata: { version, assets },
		};
	} catch (error) {
		// The candidate has a unique name, so this can never delete the active cache.
		await caches.delete(candidateCacheName);
		throw error;
	}
}

async function prepareVersionCache(metadata, options = {}) {
	if (!options.forceNew) {
		const existing = await findLatestCompleteCache(metadata.version);
		if (existing) return existing;
	}
	return populateCandidateCache(metadata);
}

function activatePreparedCache(prepared) {
	cachedCacheName = prepared.cacheName;
	currentVersion = prepared.metadata.version;
	currentAssets = prepared.metadata.assets || {};
	currentPrecacheUrls = getPrecacheUrls(currentVersion, currentAssets);
}

async function prepareAndActivateCache(metadata, options = {}) {
	const prepared = await prepareVersionCache(metadata, options);
	activatePreparedCache(prepared);
	return prepared.cacheName;
}

async function getCacheName() {
	if (cachedCacheName) return cachedCacheName;
	if (cacheNameInFlight) return cacheNameInFlight;

	cacheNameInFlight = (async () => {
		const metadata = await resolveBuildMetadata();
		if (metadata) return prepareAndActivateCache(metadata);

		const fallback = await findLatestCompleteCache();
		if (!fallback) {
			throw new Error("No complete POS cache generation is available");
		}
		activatePreparedCache(fallback);
		return fallback.cacheName;
	})().finally(() => {
		cacheNameInFlight = null;
	});

	return cacheNameInFlight;
}

async function matchActiveCache(request, options = {}) {
	try {
		const cacheName = await getCacheName();
		const cache = await caches.open(cacheName);
		return (await cache.match(request, options)) || null;
	} catch {
		return null;
	}
}

async function cleanupObsoleteCaches(
	activeCacheName,
	options = { retainRollback: true },
) {
	const ownedKeys = (await caches.keys()).filter((key) =>
		key.startsWith(CACHE_PREFIX),
	);
	const keep = new Set([activeCacheName]);

	if (options.retainRollback !== false) {
		const complete = await listCompleteCaches();
		const previous = complete
			.filter(({ cacheName }) => cacheName !== activeCacheName)
			.sort((a, b) => {
				const aHealthy = a.marker.healthAcknowledged !== false ? 1 : 0;
				const bHealthy = b.marker.healthAcknowledged !== false ? 1 : 0;
				return (
					bHealthy - aHealthy ||
					Number(b.marker.createdAt || 0) -
						Number(a.marker.createdAt || 0)
				);
			})[0];
		if (previous) keep.add(previous.cacheName);
	}

	await Promise.all(
		ownedKeys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)),
	);
	return Array.from(keep);
}

function postVersionMessage(target) {
	if (!currentVersion) return;
	const message = {
		type: "SW_VERSION_INFO",
		version: currentVersion,
		timestamp: Number(currentVersion),
		cacheName: cachedCacheName,
	};
	if (target && typeof target.postMessage === "function") {
		target.postMessage(message);
	}
}

async function refreshCacheVersion(target) {
	const metadata = await resolveBuildMetadata();
	if (!metadata) {
		throw new Error("Unable to resolve the current POS build version");
	}

	// A refresh always writes a unique candidate. The current generation remains
	// selected until the candidate is complete, even when the version is unchanged.
	const activeCacheName = await prepareAndActivateCache(metadata, {
		forceNew: true,
	});
	await cleanupObsoleteCaches(activeCacheName, { retainRollback: true });
	postVersionMessage(target);
	const clients = await self.clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	});
	clients.forEach(postVersionMessage);
	return activeCacheName;
}

async function acknowledgeActiveCache(version, target) {
	if (!cachedCacheName || !currentVersion || version !== currentVersion) {
		return false;
	}
	const marker = await readCompleteMarker(cachedCacheName);
	if (
		!marker ||
		!(await isCompleteVersionCache(
			cachedCacheName,
			currentVersion,
			marker.urls,
		))
	) {
		return false;
	}

	const cache = await caches.open(cachedCacheName);
	await cache.put(
		CACHE_COMPLETE_KEY,
		new Response(
			JSON.stringify({
				...marker,
				healthAcknowledged: true,
				healthAcknowledgedAt: Date.now(),
			}),
			{ headers: { "Content-Type": "application/json" } },
		),
	);
	await cleanupObsoleteCaches(cachedCacheName, { retainRollback: false });
	if (target && typeof target.postMessage === "function") {
		target.postMessage({
			type: "SW_CACHE_HEALTH_ACK",
			version: currentVersion,
			cacheName: cachedCacheName,
		});
	}
	return true;
}

async function forceUnregisterServiceWorker() {
	cachedCacheName = null;
	cacheNameInFlight = null;
	currentVersion = null;
	currentAssets = {};
	currentPrecacheUrls = [];
	const keys = await caches.keys();
	await Promise.all(
		keys
			.filter((key) => key.startsWith(CACHE_PREFIX))
			.map((key) => caches.delete(key)),
	);
	await self.registration.unregister();
}

self.addEventListener("message", (event) => {
	const payload = event.data || {};
	if (payload.type === "CHECK_VERSION") {
		postVersionMessage((event.ports && event.ports[0]) || event.source);
		return;
	}
	if (payload.type === "SKIP_WAITING") {
		self.skipWaiting();
		return;
	}
	if (payload.type === "REFRESH_CACHE_VERSION") {
		const target = (event.ports && event.ports[0]) || event.source || null;
		const task = refreshCacheVersion(target);
		if (typeof event.waitUntil === "function") event.waitUntil(task);
		return;
	}
	if (payload.type === "ACK_CACHE_HEALTH") {
		const target = (event.ports && event.ports[0]) || event.source || null;
		const task = acknowledgeActiveCache(payload.version, target);
		if (typeof event.waitUntil === "function") event.waitUntil(task);
		return;
	}
	if (payload.type === "CLIENT_FORCE_UNREGISTER") {
		const task = forceUnregisterServiceWorker();
		if (typeof event.waitUntil === "function") event.waitUntil(task);
	}
});

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const metadata = await resolveBuildMetadata();
			if (!metadata) {
				throw new Error("Cannot install POS shell without build metadata");
			}
			await prepareVersionCache(metadata);
		})(),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			let activeCacheName = null;
			const metadata = await resolveBuildMetadata();
			if (metadata) {
				try {
					activeCacheName = await prepareAndActivateCache(metadata);
				} catch (error) {
					console.warn(
						"SW: failed to activate the latest complete POS cache",
						error,
					);
				}
			}

			if (!activeCacheName) {
				const fallback = await findLatestCompleteCache();
				if (!fallback) {
					throw new Error("Cannot activate without a complete POS cache generation");
				}
				activatePreparedCache(fallback);
				activeCacheName = fallback.cacheName;
			}

			await cleanupObsoleteCaches(activeCacheName, { retainRollback: true });
			const cache = await caches.open(activeCacheName);
			await enforceCacheLimit(cache);
			await self.clients.claim();
			const clients = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});
			clients.forEach(postVersionMessage);
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;

	const url = new URL(event.request.url);
	if (url.protocol !== "http:" && url.protocol !== "https:") return;
	if (event.request.url.includes("socket.io")) return;

	const assetDestinations = ["style", "script", "worker", "font", "image"];
	const isAssetRequest = assetDestinations.includes(event.request.destination);
	const isPosawesomeAsset = url.pathname.startsWith("/assets/posawesome/");
	const isNavigation = event.request.mode === "navigate";
	if (!isNavigation && !isAssetRequest && !isPosawesomeAsset) return;

	if (isNavigation) {
		event.respondWith(
			(async () => {
				try {
					return await fetch(event.request);
				} catch {
					const cached = await matchActiveCache(event.request, {
						ignoreSearch: true,
					});
					if (cached) return cached;
					const appShell = await matchActiveCache("/app/posapp");
					if (appShell) return appShell;
					const offlinePage = await matchActiveCache("/offline.html");
					if (offlinePage) return offlinePage;
					const recoveryPage = await caches.match("/offline.html");
					return recoveryPage || Response.error();
				}
			})(),
		);
		return;
	}

	event.respondWith(
		(async () => {
			const hasVersionQuery = url.searchParams.has("v");
			try {
				const response = await fetch(event.request);
				const cacheableTypes = ["basic", "default", "cors"];
				if (
					response?.ok &&
					response.status === 200 &&
					cacheableTypes.includes(response.type)
				) {
					try {
						const cacheName = await getCacheName();
						const cache = await caches.open(cacheName);
						await cache.put(event.request, response.clone());
						await enforceCacheLimit(cache);
					} catch (cacheError) {
						// Cache failures never block a healthy online response.
						console.warn("SW cache put failed", cacheError);
					}
				}
				return response;
			} catch {
				const cached =
					(await matchActiveCache(event.request)) ||
					(await caches.match(event.request));
				if (cached) return cached;
				if (!hasVersionQuery) {
					const fallback =
						(await matchActiveCache(event.request, {
							ignoreSearch: true,
							})) ||
							(await caches.match(event.request, {
								ignoreSearch: true,
							}));
					if (fallback) return fallback;
				}
				return Response.error();
			}
		})(),
	);
});
