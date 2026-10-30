export type StartupTraceStatus = "start" | "ok" | "error" | "timeout" | "info";

export type StartupTraceEvent = {
	sequence: number;
	sessionId: string;
	phase: string;
	status: StartupTraceStatus;
	atMs: number;
	durationMs?: number;
	details?: Record<string, unknown>;
};

type StartupTraceToken = {
	phase: string;
	startedAt: number;
};

const MAX_EVENTS = 500;
const clock = () =>
	typeof performance !== "undefined" && typeof performance.now === "function"
		? performance.now()
		: Date.now();
const traceOrigin = clock();
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const events: StartupTraceEvent[] = [];
let sequence = 0;

function isTraceEnabled() {
	if (typeof window === "undefined") return false;
	if ((window as any).__POS_STARTUP_TRACE_ENABLED__ === true) return true;
	try {
		return (
			new URLSearchParams(window.location.search).get(
				"posa_startup_trace",
			) === "1"
		);
	} catch {
		return false;
	}
}

function normalizeDetails(details?: Record<string, unknown>) {
	if (!details) return undefined;
	const normalized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(details)) {
		if (value instanceof Error) {
			normalized[key] = { name: value.name, message: value.message };
		} else if (typeof value === "bigint") {
			normalized[key] = value.toString();
		} else {
			normalized[key] = value;
		}
	}
	return normalized;
}

export function traceStartupEvent(
	phase: string,
	status: StartupTraceStatus = "info",
	details?: Record<string, unknown>,
	durationMs?: number,
): StartupTraceEvent {
	const event: StartupTraceEvent = {
		sequence: ++sequence,
		sessionId,
		phase,
		status,
		atMs: Math.round((clock() - traceOrigin) * 10) / 10,
		...(typeof durationMs === "number"
			? { durationMs: Math.round(durationMs * 10) / 10 }
			: {}),
		...(details ? { details: normalizeDetails(details) } : {}),
	};
	events.push(event);
	if (events.length > MAX_EVENTS)
		events.splice(0, events.length - MAX_EVENTS);
	if (isTraceEnabled()) {
		console.info(`[POSA_STARTUP] ${JSON.stringify(event)}`);
	}
	return event;
}

export function startStartupPhase(
	phase: string,
	details?: Record<string, unknown>,
): StartupTraceToken {
	traceStartupEvent(phase, "start", details);
	return { phase, startedAt: clock() };
}

export function finishStartupPhase(
	token: StartupTraceToken,
	status: Exclude<StartupTraceStatus, "start"> = "ok",
	details?: Record<string, unknown>,
) {
	return traceStartupEvent(
		token.phase,
		status,
		details,
		clock() - token.startedAt,
	);
}

export function getStartupTrace(): StartupTraceEvent[] {
	return events.map((event) => ({
		...event,
		details: event.details ? { ...event.details } : undefined,
	}));
}

export function attachStartupTraceHelpers() {
	if (typeof window === "undefined") return;
	(window as any).__POS_STARTUP_TRACE__ = {
		enable() {
			(window as any).__POS_STARTUP_TRACE_ENABLED__ = true;
		},
		disable() {
			(window as any).__POS_STARTUP_TRACE_ENABLED__ = false;
		},
		snapshot: getStartupTrace,
		export() {
			return JSON.stringify(getStartupTrace(), null, 2);
		},
	};
}

attachStartupTraceHelpers();
traceStartupEvent("frappe.page.bootstrap", "start", {
	readyState:
		typeof document !== "undefined" ? document.readyState : "unavailable",
});
