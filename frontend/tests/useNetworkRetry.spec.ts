// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/offline/index", () => ({
	isManualOffline: vi.fn(() => false),
}));

import {
	checkNetworkConnectivity,
	manualNetworkRetry,
	resolvesAnyTrue,
} from "../src/posapp/composables/core/useNetwork";

describe("manual network retry", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it("forces an immediate connectivity probe when retried from the UI", async () => {
		const vm: any = {
			serverConnecting: false,
			$forceUpdate: vi.fn(),
			checkNetworkConnectivity: vi.fn(() => Promise.resolve()),
		};

		await manualNetworkRetry(vm);

		expect(vm.checkNetworkConnectivity).toHaveBeenCalledWith({
			forceImmediate: true,
		});
		expect(vm.serverConnecting).toBe(false);
	});

	it("marks the app offline after one forced failed probe", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn((input: RequestInfo | URL) => {
				const url = String(input);
				if (url.includes("google.com") || url.includes("httpbin.org")) {
					return Promise.reject(new Error("offline"));
				}
				return Promise.resolve({ status: 503, ok: false });
			}),
		);

		const vm: any = {
			networkOnline: true,
			serverOnline: true,
			serverConnecting: false,
			internetReachable: true,
			$forceUpdate: vi.fn(),
		};

		await checkNetworkConnectivity.call(vm, { forceImmediate: true });

		expect(vm.networkOnline).toBe(false);
		expect(vm.serverOnline).toBe(false);
		expect(vm.internetReachable).toBe(false);
	});

	it("invokes the recovery callback when live connectivity is restored", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve({
					status: 200,
					ok: true,
				}),
			),
		);

		const vm: any = {
			networkOnline: false,
			serverOnline: false,
			serverConnecting: false,
			internetReachable: false,
			onConnectivityRecovered: vi.fn(() => Promise.resolve()),
			$forceUpdate: vi.fn(),
		};

		await checkNetworkConnectivity.call(vm, { forceImmediate: true });

		expect(vm.networkOnline).toBe(true);
		expect(vm.serverOnline).toBe(true);
		expect(vm.onConnectivityRecovered).toHaveBeenCalledTimes(1);
	});

	it("forces current HTTP health to replace stale optimistic state", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn((input: RequestInfo | URL) =>
				String(input).includes("google.com")
					? Promise.reject(new Error("internet unavailable"))
					: Promise.resolve({ status: 200, ok: true }),
			),
		);
		const vm: any = {
			networkOnline: true,
			serverOnline: true,
			serverConnecting: true,
			internetReachable: true,
			onConnectivityRecovered: vi.fn(),
			$forceUpdate: vi.fn(),
		};

		await checkNetworkConnectivity.call(vm, { forceImmediate: true });

		expect(vm.networkOnline).toBe(true);
		expect(vm.serverOnline).toBe(true);
		expect(vm.internetReachable).toBe(false);
		expect(vm.onConnectivityRecovered).not.toHaveBeenCalled();
	});

	it("uses a local timeout fallback when AbortSignal.timeout is unavailable", async () => {
		const timeoutDescriptor = Object.getOwnPropertyDescriptor(
			AbortSignal,
			"timeout",
		);
		Object.defineProperty(AbortSignal, "timeout", {
			configurable: true,
			value: undefined,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve({ status: 200, ok: true })),
		);
		const vm: any = {
			networkOnline: false,
			serverOnline: false,
			serverConnecting: false,
			internetReachable: false,
			$forceUpdate: vi.fn(),
		};

		try {
			await checkNetworkConnectivity.call(vm, { forceImmediate: true });
			expect(vm.serverOnline).toBe(true);
		} finally {
			if (timeoutDescriptor) {
				Object.defineProperty(AbortSignal, "timeout", timeoutDescriptor);
			}
		}
	});

	it("treats one successful LAN probe as connected even when another returns false", async () => {
		await expect(
			resolvesAnyTrue([
				Promise.resolve(false),
				Promise.resolve(true),
				Promise.reject(new Error("unreachable")),
			]),
		).resolves.toBe(true);
	});
});
