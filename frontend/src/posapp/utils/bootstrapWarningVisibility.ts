import type { BootstrapCapabilitySummary } from "../../offline/bootstrapSnapshot";

export type BootstrapWarningConnectivityState = {
	manualOffline: boolean;
	browserOnline: boolean;
	networkOnline: boolean;
	serverOnline: boolean;
	serverConnecting: boolean;
	serverStatusKnown: boolean;
};

/**
 * Cache readiness is only actionable while the POS is actually selling offline.
 * An uninitialised server status is not evidence of an outage; treating it as one
 * causes a warning flash while the first connectivity probe or socket handshake runs.
 */
export function isOfflineSaleModeConfirmed(
	input: BootstrapWarningConnectivityState,
) {
	if (input.manualOffline || !input.browserOnline || !input.networkOnline) {
		return true;
	}

	if (input.serverConnecting || !input.serverStatusKnown) {
		return false;
	}

	return !input.serverOnline;
}

export function shouldLiftBootstrapWarningStartupGate(input: {
	loadingActive: boolean;
	initialBootstrapSettled: boolean;
	itemsStartupSyncSettled?: boolean;
	startupGateLifted: boolean;
}) {
	if (input.startupGateLifted) {
		return true;
	}

	return (
		!input.loadingActive &&
		input.initialBootstrapSettled &&
		input.itemsStartupSyncSettled !== false
	);
}

export function resolveBootstrapWarningUiState<
	TSummary extends BootstrapCapabilitySummary,
>(input: {
	startupWarningsReady: boolean;
	warningActive: boolean;
	warningTooltip?: string | null;
	capabilitySummaries?: TSummary[] | null;
	offlineSaleModeConfirmed: boolean;
}) {
	if (!input.startupWarningsReady || !input.offlineSaleModeConfirmed) {
		return {
			active: false,
			tooltip: "",
			capabilitySummaries: [] as TSummary[],
		};
	}

	return {
		active: Boolean(input.warningActive),
		tooltip: input.warningActive ? String(input.warningTooltip || "") : "",
		capabilitySummaries: Array.isArray(input.capabilitySummaries)
			? [...input.capabilitySummaries]
			: ([] as TSummary[]),
	};
}
