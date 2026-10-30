import { describe, expect, it } from "vitest";

import {
	isOfflineSaleModeConfirmed,
	resolveBootstrapWarningUiState,
	shouldLiftBootstrapWarningStartupGate,
} from "../src/posapp/utils/bootstrapWarningVisibility";

const unavailableOfflineSale = {
	id: "sell_offline" as const,
	label: "Sell Offline",
	status: "unavailable" as const,
	severity: "error" as const,
	message: "Offline selling is unavailable until caches are refreshed.",
	action: "Reconnect and refresh offline sell prerequisites.",
	warningCodes: ["items_cache_ready"],
	prerequisites: ["items_cache_ready"],
	policy: null,
};

const confirmedOffline = {
	manualOffline: false,
	browserOnline: false,
	networkOnline: false,
	serverOnline: false,
	serverConnecting: false,
	serverStatusKnown: true,
};

describe("bootstrap warning startup deferral", () => {
	it("keeps warnings hidden during startup even when validation already found a warning", () => {
		const state = resolveBootstrapWarningUiState({
			startupWarningsReady: false,
			warningActive: true,
			warningTooltip: "Sell Offline\nOffline selling is unavailable.",
			capabilitySummaries: [unavailableOfflineSale],
			offlineSaleModeConfirmed: true,
		});

		expect(state.active).toBe(false);
		expect(state.tooltip).toBe("");
		expect(state.capabilitySummaries).toEqual([]);
	});

	it("shows warnings after startup completes when they are still valid", () => {
		const shouldLift = shouldLiftBootstrapWarningStartupGate({
			loadingActive: false,
			initialBootstrapSettled: true,
			startupGateLifted: false,
		});

		const state = resolveBootstrapWarningUiState({
			startupWarningsReady: shouldLift,
			warningActive: true,
			warningTooltip: "Stock Confidence Offline",
			capabilitySummaries: [],
			offlineSaleModeConfirmed: true,
		});

		expect(shouldLift).toBe(true);
		expect(state.active).toBe(true);
		expect(state.tooltip).toBe("Stock Confidence Offline");
	});

	it.each([
		["empty", "Offline item cache is incomplete."],
		["warming", "Offline item cache is still warming."],
		["stale", "Cached offline data belongs to a different app build."],
		[
			"quota failure",
			"QuotaExceededError: offline data could not be stored.",
		],
	])(
		"hides %s cache warnings while online selling is available",
		(_state, tooltip) => {
			const state = resolveBootstrapWarningUiState({
				startupWarningsReady: true,
				warningActive: true,
				warningTooltip: tooltip,
				capabilitySummaries: [unavailableOfflineSale],
				offlineSaleModeConfirmed: false,
			});

			expect(state.active).toBe(false);
			expect(state.tooltip).toBe("");
			expect(state.capabilitySummaries).toEqual([]);
		},
	);

	it("treats an unknown or probing server state as startup, not an outage", () => {
		expect(
			isOfflineSaleModeConfirmed({
				...confirmedOffline,
				browserOnline: true,
				networkOnline: true,
				serverStatusKnown: false,
			}),
		).toBe(false);
		expect(
			isOfflineSaleModeConfirmed({
				...confirmedOffline,
				browserOnline: true,
				networkOnline: true,
				serverConnecting: true,
			}),
		).toBe(false);
	});

	it.each([
		[
			"manual offline",
			{
				...confirmedOffline,
				browserOnline: true,
				networkOnline: true,
				manualOffline: true,
			},
		],
		["browser offline", confirmedOffline],
		[
			"confirmed server outage",
			{ ...confirmedOffline, browserOnline: true, networkOnline: true },
		],
	])(
		"shows an unavailable-cache warning in %s mode",
		(_state, connectivity) => {
			const state = resolveBootstrapWarningUiState({
				startupWarningsReady: true,
				warningActive: true,
				warningTooltip:
					"Sell Offline\nOffline item cache is incomplete.",
				capabilitySummaries: [unavailableOfflineSale],
				offlineSaleModeConfirmed:
					isOfflineSaleModeConfirmed(connectivity),
			});

			expect(state.active).toBe(true);
			expect(state.tooltip).toContain("Offline item cache is incomplete");
			expect(state.capabilitySummaries).toEqual([unavailableOfflineSale]);
		},
	);

	it("does not warn while offline when the durable offline capability is ready", () => {
		const state = resolveBootstrapWarningUiState({
			startupWarningsReady: true,
			warningActive: false,
			warningTooltip: "",
			capabilitySummaries: [],
			offlineSaleModeConfirmed: true,
		});

		expect(state.active).toBe(false);
		expect(state.tooltip).toBe("");
	});

	it("keeps startup warnings hidden until item background sync settles", () => {
		const shouldLift = shouldLiftBootstrapWarningStartupGate({
			loadingActive: false,
			initialBootstrapSettled: true,
			itemsStartupSyncSettled: false,
			startupGateLifted: false,
		});

		const state = resolveBootstrapWarningUiState({
			startupWarningsReady: shouldLift,
			warningActive: true,
			warningTooltip: "Stock Confidence Offline",
			capabilitySummaries: [],
			offlineSaleModeConfirmed: true,
		});

		expect(shouldLift).toBe(false);
		expect(state.active).toBe(false);
		expect(state.tooltip).toBe("");
	});

	it("never surfaces a startup warning if the data becomes healthy before the gate lifts", () => {
		const state = resolveBootstrapWarningUiState({
			startupWarningsReady: true,
			warningActive: false,
			warningTooltip: "Sell Offline",
			capabilitySummaries: [],
			offlineSaleModeConfirmed: true,
		});

		expect(state.active).toBe(false);
		expect(state.tooltip).toBe("");
	});

	it("keeps post-startup warnings enabled even if later activity toggles loading again", () => {
		const shouldLift = shouldLiftBootstrapWarningStartupGate({
			loadingActive: true,
			initialBootstrapSettled: false,
			startupGateLifted: true,
		});

		const state = resolveBootstrapWarningUiState({
			startupWarningsReady: shouldLift,
			warningActive: true,
			warningTooltip: "Sell Offline",
			capabilitySummaries: [],
			offlineSaleModeConfirmed: true,
		});

		expect(shouldLift).toBe(true);
		expect(state.active).toBe(true);
		expect(state.tooltip).toBe("Sell Offline");
	});
});
