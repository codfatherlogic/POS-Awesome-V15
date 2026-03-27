import { setActivePinia } from "pinia";
import { pinia, useUpdateStore } from "./posapp/stores/index.js";

const VERSION_ENDPOINT = "/assets/posawesome/dist/js/version.json";
const SERVICE_WORKER_SCOPE = "/sw.js";
const VERSION_CACHE_TTL = 30 * 1000;

let cachedVersionInfo: {
	version: string | null;
	timestamp: number | null;
} | null = null;
let cachedVersionTimestamp = 0;
let pendingVersionRequest: Promise<any> | null = null;

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
	setActivePinia(pinia);
	const updateStore = useUpdateStore();
	updateStore.initializeFromStorage();
	updateStore.setReloadAction(triggerServiceWorkerUpdate);

	let lastKnownActiveVersion = updateStore.currentVersion || null;
	let hasRequestedInitialVersion = false;
	let reloadScheduled = false;

	navigator.serviceWorker.addEventListener("message", (event) => {
		const data: any = event.data || {};
		if (data.type === "SW_VERSION_INFO") {
			handleActiveVersion(data.version, data.timestamp);
		}
	});

	navigator.serviceWorker.ready
		.then(async (registration) => {
			monitorRegistration(registration);
			await ensureActiveVersion();
			await checkWaitingWorker(registration);
			registration.update().catch(() => {});
		})
		.catch((err) => {
			console.warn("SW ready rejected", err);
		});

	navigator.serviceWorker.addEventListener("controllerchange", () => {
		reloadScheduled = true;
		updateStore.reloading = true;
		updateStore.resetSnooze();
		void requestVersionFromController();
	});

	async function ensureActiveVersion() {
		if (!navigator.serviceWorker.controller) {
			return;
		}

		if (!hasRequestedInitialVersion) {
			hasRequestedInitialVersion = true;
			await requestVersionFromController();
		}
	}

	async function postMessageToController(
		message: Record<string, unknown>,
		timeoutMs = 4000,
	) {
		const controller = navigator.serviceWorker.controller;
		if (!controller) return null;

		return new Promise((resolve) => {
			const channel = new MessageChannel();
			const timeout = window.setTimeout(() => resolve(null), timeoutMs);
			channel.port1.onmessage = (event) => {
				window.clearTimeout(timeout);
				resolve(event.data || null);
			};
			try {
				controller.postMessage(message, [channel.port2]);
			} catch (err) {
				window.clearTimeout(timeout);
				console.warn("Failed to post message to service worker", err);
				resolve(null);
			}
		});
	}

	async function requestVersionFromController() {
		const payload: any = await postMessageToController({
			type: "CHECK_VERSION",
		});
		if (payload?.type === "SW_VERSION_INFO") {
			handleActiveVersion(payload.version, payload.timestamp);
		}
		return payload;
	}

	async function refreshControllerCacheVersion() {
		const payload: any = await postMessageToController({
			type: "REFRESH_CACHE_VERSION",
		});
		if (payload?.type === "SW_VERSION_INFO") {
			handleActiveVersion(payload.version, payload.timestamp);
		}
		return payload;
	}

	async function checkWaitingWorker(registration: ServiceWorkerRegistration) {
		if (registration.waiting) {
			await announceAvailableUpdate(true);
		}
	}

	function monitorRegistration(registration: ServiceWorkerRegistration) {
		registration.addEventListener("updatefound", () => {
			const newWorker = registration.installing;
			if (!newWorker) return;
			newWorker.addEventListener("statechange", async () => {
				if (
					newWorker.state === "installed" &&
					navigator.serviceWorker.controller
				) {
					await announceAvailableUpdate(true);
				}
			});
		});
	}

	async function announceAvailableUpdate(force = false) {
		const info = await fetchBuildInfo(force);
		if (!info || !info.version) {
			return;
		}
		updateStore.setAvailableVersion(info.version, info.timestamp || null);
		lastKnownActiveVersion = lastKnownActiveVersion || info.version;
	}

	async function fetchBuildInfo(force = false) {
		if (pendingVersionRequest) {
			return pendingVersionRequest;
		}
		const now = Date.now();
		if (
			!force &&
			cachedVersionInfo &&
			now - cachedVersionTimestamp < VERSION_CACHE_TTL
		) {
			return cachedVersionInfo;
		}
		pendingVersionRequest = (async () => {
			try {
				const response = await fetch(VERSION_ENDPOINT, {
					cache: "no-store",
					headers: {
						"Cache-Control": "no-cache",
						Pragma: "no-cache",
						Expires: "0",
					},
				});

				if (!response.ok) {
					return null;
				}
				const data: any = await response.json();
				const version = data.version || data.buildVersion || null;
				const timestamp = Number(data.timestamp || data.buildTimestamp);
				const parsed = {
					version,
					timestamp: Number.isNaN(timestamp) ? null : timestamp,
				};
				cachedVersionInfo = parsed;
				cachedVersionTimestamp = Date.now();
				return parsed;
			} catch (err) {
				console.warn("Failed to fetch build info", err);
				return null;
			} finally {
				pendingVersionRequest = null;
			}
		})();
		return pendingVersionRequest;
	}

	function handleActiveVersion(version: string, timestamp: number) {
		if (!version) return;
		if (timestamp) {
			cachedVersionInfo = {
				version,
				timestamp,
			};
			cachedVersionTimestamp = Date.now();
		}
		if (!lastKnownActiveVersion) {
			lastKnownActiveVersion = version;
			updateStore.setCurrentVersion(version, timestamp || null);
			return;
		}

		if (version !== lastKnownActiveVersion) {
			lastKnownActiveVersion = version;
			updateStore.markUpdateApplied(version, timestamp || null);
			if (reloadScheduled) {
				reloadScheduled = false;
				setTimeout(() => window.location.reload(), 50);
			}
		} else {
			updateStore.setCurrentVersion(version, timestamp || null);
			if (reloadScheduled) {
				reloadScheduled = false;
				updateStore.reloading = false;
			}
		}
	}

	async function triggerServiceWorkerUpdate() {
		try {
			reloadScheduled = true;
			updateStore.reloading = true;
			updateStore.resetSnooze();
			const registration =
				await navigator.serviceWorker.getRegistration(
					SERVICE_WORKER_SCOPE,
				);
			if (!registration) {
				updateStore.reloading = false;
				return;
			}
			if (registration.waiting) {
				registration.waiting.postMessage({ type: "SKIP_WAITING" });
				return;
			}
			if (registration.installing) {
				const installingWorker = registration.installing;
				installingWorker.addEventListener("statechange", () => {
					if (installingWorker.state === "installed") {
						registration.waiting?.postMessage({
							type: "SKIP_WAITING",
						});
					}
				});
				return;
			}
			await registration.update();
			const waitingWorker = registration.waiting as ServiceWorker | null;
			if (waitingWorker) {
				waitingWorker.postMessage({ type: "SKIP_WAITING" });
				return;
			}

			const refreshedPayload = await refreshControllerCacheVersion();
			if (refreshedPayload?.type === "SW_VERSION_INFO") {
				return;
			}

			const currentPayload = await requestVersionFromController();
			if (!currentPayload) {
				reloadScheduled = false;
				updateStore.reloading = false;
			}
		} catch (err) {
			console.warn("Failed to trigger service worker update", err);
			updateStore.reloading = false;
		}
	}
}
