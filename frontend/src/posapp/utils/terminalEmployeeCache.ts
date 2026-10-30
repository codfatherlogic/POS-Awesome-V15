import type { TerminalEmployee } from "../stores/employeeStore";

const CACHE_PREFIX = "posa_terminal_employees_v1";
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_EMPLOYEES = 100;

interface TerminalEmployeeCacheEnvelope {
	version: number;
	cached_at: number;
	employees: TerminalEmployee[];
}

const normalizeIdentity = (value: unknown) => String(value || "").trim();

export const getTerminalEmployeeCacheKey = (
	sessionUser: string,
	profileName: string,
) =>
	`${CACHE_PREFIX}:${encodeURIComponent(normalizeIdentity(sessionUser))}:${encodeURIComponent(normalizeIdentity(profileName))}`;

const normalizeCachedEmployees = (value: unknown): TerminalEmployee[] => {
	if (!Array.isArray(value)) return [];
	return value
		.filter((employee) => employee && normalizeIdentity(employee.user))
		.slice(0, MAX_CACHED_EMPLOYEES)
		.map((employee) => ({
			user: normalizeIdentity(employee.user),
			full_name: normalizeIdentity(employee.full_name) || normalizeIdentity(employee.user),
			enabled: Number(employee.enabled ?? 1),
			// Cached identities only make the selector available. Privileged flags
			// are restored exclusively from the live API/PIN verification response.
			is_current: false,
			is_supervisor: false,
		}));
};

export function loadCachedTerminalEmployees(
	sessionUser: string,
	profileName: string,
	storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null,
	now = Date.now(),
): TerminalEmployee[] {
	if (!storage || !normalizeIdentity(sessionUser) || !normalizeIdentity(profileName)) return [];
	const cacheKey = getTerminalEmployeeCacheKey(sessionUser, profileName);
	try {
		const rawValue = storage.getItem(cacheKey);
		if (!rawValue) return [];
		const envelope = JSON.parse(rawValue) as TerminalEmployeeCacheEnvelope;
		if (
			envelope?.version !== CACHE_VERSION ||
			!Number.isFinite(envelope.cached_at) ||
			now - envelope.cached_at > CACHE_TTL_MS
		) {
			storage.removeItem(cacheKey);
			return [];
		}
		return normalizeCachedEmployees(envelope.employees);
	} catch {
		try {
			storage.removeItem(cacheKey);
		} catch {
			// Storage cleanup is best effort only.
		}
		return [];
	}
}

export function saveCachedTerminalEmployees(
	sessionUser: string,
	profileName: string,
	employees: TerminalEmployee[],
	storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null,
	now = Date.now(),
) {
	if (!storage || !normalizeIdentity(sessionUser) || !normalizeIdentity(profileName)) return;
	try {
		storage.setItem(
			getTerminalEmployeeCacheKey(sessionUser, profileName),
			JSON.stringify({
				version: CACHE_VERSION,
				cached_at: now,
				employees: normalizeCachedEmployees(employees),
			} satisfies TerminalEmployeeCacheEnvelope),
		);
	} catch {
		// The server request remains the fallback when browser storage is unavailable.
	}
}
