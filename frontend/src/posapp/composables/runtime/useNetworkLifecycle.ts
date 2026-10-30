import type { Ref } from "vue";
import { watch } from "vue";

type EventBusLike = {
	emit?: (event: string, ...args: any[]) => void;
};

type RealtimeLike = {
	on?: (event: string, handler: (...args: any[]) => void) => void;
	off?: (event: string, handler?: (...args: any[]) => void) => void;
	socket?: {
		readyState?: number;
		connected?: boolean;
		disconnected?: boolean;
		active?: boolean;
	} | null;
};

type UseNetworkLifecycleOptions = {
	networkOnline: Ref<boolean>;
	serverOnline: Ref<boolean>;
	serverConnecting: Ref<boolean>;
	internetReachable: Ref<boolean>;
	isIpHost?: Ref<boolean>;
	eventBus?: EventBusLike | null;
	realtime?: RealtimeLike | null;
	isManualOffline: () => boolean;
	onSyncInvoices?: () => void | Promise<void>;
	onConnectivityRecovered?: () => void | Promise<void>;
	onEvaluateBootstrap?: (options?: { allowPrompt?: boolean }) => void;
	onRefreshTaxInclusive?: () => void | Promise<void>;
	checkNetworkConnectivity?: (options?: {
		forceImmediate?: boolean;
	}) => Promise<void>;
	connectingWatchdogMs?: number;
};

const DEFAULT_CONNECTING_WATCHDOG_MS = 9_000;

export function useNetworkLifecycle(options: UseNetworkLifecycleOptions) {
	let started = false;
	let stopWatchers: Array<() => void> = [];
	let connectingWatchdog: ReturnType<typeof setTimeout> | null = null;
	let connectivityCheckInFlight: Promise<void> | null = null;
	const realtimeHandlers: Array<[string, (...args: any[]) => void]> = [];

	function clearConnectingWatchdog() {
		if (connectingWatchdog) {
			clearTimeout(connectingWatchdog);
			connectingWatchdog = null;
		}
	}

	function setConnecting(value: boolean) {
		clearConnectingWatchdog();
		options.serverConnecting.value = value;
		if (!value) return;
		connectingWatchdog = setTimeout(() => {
			connectingWatchdog = null;
			// A hung probe must not monopolize all later lifecycle checks.
			// Its eventual finally handler is identity-guarded and cannot clear a
			// newer probe's state.
			connectivityCheckInFlight = null;
			options.serverConnecting.value = false;
		}, options.connectingWatchdogMs || DEFAULT_CONNECTING_WATCHDOG_MS);
	}

	const networkProxy = {
		get networkOnline() {
			return options.networkOnline.value;
		},
		set networkOnline(value) {
			options.networkOnline.value = Boolean(value);
		},
		get serverOnline() {
			return options.serverOnline.value;
		},
		set serverOnline(value) {
			options.serverOnline.value = Boolean(value);
		},
		get serverConnecting() {
			return options.serverConnecting.value;
		},
		set serverConnecting(value) {
			setConnecting(Boolean(value));
		},
		get internetReachable() {
			return options.internetReachable.value;
		},
		set internetReachable(value) {
			options.internetReachable.value = Boolean(value);
		},
		get isIpHost() {
			return options.isIpHost?.value || false;
		},
		set isIpHost(value) {
			if (options.isIpHost) {
				options.isIpHost.value = Boolean(value);
			}
		},
		onConnectivityRecovered: async () => {
			await options.onConnectivityRecovered?.();
		},
		$forceUpdate: () => {},
		checkNetworkConnectivity: async (checkOptions = {}) => {
			if (options.checkNetworkConnectivity) {
				await options.checkNetworkConnectivity(checkOptions);
				return;
			}
			const { checkNetworkConnectivity: utilsCheckNetworkConnectivity } =
				await import("../core/useNetwork");
			await utilsCheckNetworkConnectivity.call(
				networkProxy as any,
				checkOptions,
			);
		},
	};

	function runConnectivityCheck(
		checkOptions: { forceImmediate?: boolean } = {},
	) {
		if (connectivityCheckInFlight) return connectivityCheckInFlight;
		setConnecting(true);
		const operation = networkProxy
			.checkNetworkConnectivity(checkOptions)
			.finally(() => {
				if (connectivityCheckInFlight === operation) {
					connectivityCheckInFlight = null;
					setConnecting(false);
				}
			});
		connectivityCheckInFlight = operation;
		return operation;
	}

	function reconcileCurrentState() {
		if (options.isManualOffline()) {
			options.networkOnline.value = false;
			options.internetReachable.value = false;
			options.serverOnline.value = false;
			(window as any).serverOnline = false;
			setConnecting(false);
			return;
		}

		options.networkOnline.value = navigator.onLine;
		const socket = options.realtime?.socket;
		const socketState =
			socket?.connected === true
				? 1
				: socket?.disconnected === true
					? 3
					: socket?.active === true
						? 0
						: socket?.readyState;
		if (socketState === 1) {
			options.serverOnline.value = true;
			(window as any).serverOnline = true;
			setConnecting(false);
		} else if (socketState === 0 && navigator.onLine) {
			setConnecting(true);
		} else if (socketState === 2 || socketState === 3) {
			options.serverOnline.value = false;
			(window as any).serverOnline = false;
		}

		if (navigator.onLine) {
			void runConnectivityCheck({ forceImmediate: true }).catch(
				(error) => {
					console.warn("Initial network health check failed", error);
				},
			);
		} else {
			options.internetReachable.value = false;
			options.serverOnline.value = false;
			(window as any).serverOnline = false;
			setConnecting(false);
		}
	}

	const handleOnline = () => {
		if (options.isManualOffline()) {
			return;
		}
		const wasOnline = options.networkOnline.value;
		options.networkOnline.value = true;
		options.internetReachable.value = true;
		void runConnectivityCheck({ forceImmediate: true }).catch((error) => {
			console.warn("Online network health check failed", error);
		});
		if (!wasOnline) {
			void options.onConnectivityRecovered?.();
		}
	};

	const handleOffline = () => {
		if (options.isManualOffline()) {
			return;
		}
		options.networkOnline.value = false;
		options.internetReachable.value = false;
		options.serverOnline.value = false;
		(window as any).serverOnline = false;
		setConnecting(false);
	};

	const handleVisibilityChange = () => {
		if (
			!document.hidden &&
			navigator.onLine &&
			!options.isManualOffline()
		) {
			void runConnectivityCheck({ forceImmediate: true }).catch(
				(error) => {
					console.warn("Visible network health check failed", error);
				},
			);
		}
	};

	function registerRealtime(
		event: string,
		handler: (...args: any[]) => void,
	) {
		options.realtime?.on?.(event, handler);
		realtimeHandlers.push([event, handler]);
	}

	function start() {
		if (started) {
			return;
		}
		started = true;
		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
		document.addEventListener("visibilitychange", handleVisibilityChange);

		stopWatchers = [
			watch(options.networkOnline, (newVal, oldVal) => {
				if (newVal && !oldVal) {
					void options.onRefreshTaxInclusive?.();
					options.eventBus?.emit?.("network-online");
					void options.onSyncInvoices?.();
					options.onEvaluateBootstrap?.({ allowPrompt: false });
				}
			}),
			watch(options.serverOnline, (newVal, oldVal) => {
				if (newVal && !oldVal) {
					options.eventBus?.emit?.("server-online");
					void options.onSyncInvoices?.();
					options.onEvaluateBootstrap?.({ allowPrompt: false });
				}
			}),
		];

		registerRealtime("connect", () => {
			options.serverOnline.value = true;
			(window as any).serverOnline = true;
			setConnecting(false);
		});
		registerRealtime("disconnect", () => {
			options.serverOnline.value = false;
			(window as any).serverOnline = false;
			setConnecting(false);
		});
		registerRealtime("connecting", () => {
			setConnecting(true);
		});
		registerRealtime("reconnect", () => {
			options.serverOnline.value = true;
			(window as any).serverOnline = true;
			setConnecting(false);
			void options.onConnectivityRecovered?.();
		});
		reconcileCurrentState();
	}

	function stop() {
		if (!started) {
			return;
		}
		started = false;
		clearConnectingWatchdog();
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
		document.removeEventListener(
			"visibilitychange",
			handleVisibilityChange,
		);
		stopWatchers.forEach((stopWatcher) => stopWatcher());
		stopWatchers = [];
		connectivityCheckInFlight = null;
		realtimeHandlers.splice(0).forEach(([event, handler]) => {
			options.realtime?.off?.(event, handler);
		});
	}

	async function retry() {
		const { manualNetworkRetry } = await import("../core/useNetwork");
		await manualNetworkRetry(networkProxy as any);
	}

	return {
		start,
		stop,
		retry,
		networkProxy,
		options,
	};
}
