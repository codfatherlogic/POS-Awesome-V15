import { ref, onUnmounted } from "vue";
import { checkDbHealth } from "../../../../offline/index";
import {
	finishStartupPhase,
	startStartupPhase,
} from "../../../../utils/startupTrace";
import { buildPosWorkerUrl } from "../../../utils/workerUrl";

declare const __: (_text: string) => string;
declare const frappe: any;

/**
 * useItemStorageSafety Composable
 *
 * Manages storage health checks (IndexedDB/LocalStorage) and the background item worker.
 * Ensuring storage is available before attempting heavy operations prevents crashes.
 */
export function useItemStorageSafety() {
	const STORAGE_RECHECK_COOLDOWN_MS = 5 * 1000;
	// State
	const storageAvailable = ref(true);
	const itemWorker = ref<Worker | null>(null);
	let lastFailedHealthCheckAt = 0;

	/**
	 * Checks if the database is healthy and actionable.
	 * @returns {Promise<boolean>}
	 */
	async function ensureStorageHealth() {
		if (!storageAvailable.value) {
			const now = Date.now();
			if (now - lastFailedHealthCheckAt < STORAGE_RECHECK_COOLDOWN_MS) {
				return false;
			}
		}

		const isHealthy = await checkDbHealth();
		if (isHealthy) {
			if (!storageAvailable.value) {
				markStorageAvailable();
			}
			return true;
		}

		lastFailedHealthCheckAt = Date.now();
		if (!isHealthy) {
			console.warn("Storage health check failed");
			markStorageUnavailable({
				error: "Storage health check failed",
				details: "Database could not be accessed or recovered.",
			});
		}
		return false;
	}

	function markStorageAvailable() {
		storageAvailable.value = true;
		lastFailedHealthCheckAt = 0;
		startItemWorker();

		if (window.frappe) {
			frappe.show_alert({
				message: __(
					"Local item storage recovered. Background sync resumed.",
				),
				indicator: "green",
			});
		}
	}

	/**
	 * Marks storage as unavailable and stops related workers.
	 * @param {Object} args - Error details
	 */
	function markStorageUnavailable(args: Record<string, unknown> = {}) {
		if (!storageAvailable.value) return; // Already marked

		console.error("Marking storage as unavailable", args);
		storageAvailable.value = false;
		lastFailedHealthCheckAt = Date.now();

		// Terminate worker to prevent it from trying to access broken DB
		if (itemWorker.value) {
			console.log("Terminating item worker due to storage failure");
			itemWorker.value.terminate();
			itemWorker.value = null;
		}

		if (window.frappe) {
			frappe.show_alert({
				message: __(
					"Local storage is unavailable. Switching to online-only mode.",
				),
				indicator: "orange",
			});
		}
	}

	/**
	 * Starts the background item worker if storage is available.
	 */
	function startItemWorker() {
		if (!storageAvailable.value) {
			console.warn("Skipping worker start - storage unavailable");
			return;
		}

		if (itemWorker.value) {
			// Already running
			return;
		}

		const phase = startStartupPhase("items.worker_creation");
		try {
			// Correct path to the worker file
			const workerUrl = buildPosWorkerUrl("itemWorker.js", {
				includeStartupTrace: true,
			});

			try {
				// Try initializing with classic type first (better compatibility)
				itemWorker.value = new Worker(workerUrl, { type: "classic" });
			} catch {
				// Fallback to module type
				itemWorker.value = new Worker(workerUrl, { type: "module" });
			}

			itemWorker.value.onmessage = (e: MessageEvent) => {
				// Handle generic worker messages if needed
				// Most worker comms might be request/response based, handled by specific managers
				// or just fire-and-forget syncs.
				if (e.data && e.data.type === "error") {
					console.error("Item worker error:", e.data.payload);
				}
			};

			itemWorker.value.onerror = (e: ErrorEvent) => {
				console.error("Item worker system error:", e);
				// If the worker crashes, we might not want to kill the whole storage flag
				// unless it's a persistent DB error.
			};

			console.log("Item Worker started");
			finishStartupPhase(phase, "ok");
		} catch (e: unknown) {
			console.error("Failed to start item worker", e);
			finishStartupPhase(phase, "error", { error: e });
		}
	}

	// Cleanup on unmount
	onUnmounted(() => {
		if (itemWorker.value) {
			itemWorker.value.terminate();
			itemWorker.value = null;
		}
	});

	return {
		// State
		storageAvailable,
		itemWorker,

		// Methods
		ensureStorageHealth,
		markStorageUnavailable,
		markStorageAvailable,
		startItemWorker,
	};
}
