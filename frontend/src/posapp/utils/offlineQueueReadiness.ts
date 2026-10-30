export type OfflineQueueReadinessResult =
	| { ready: true; error: null }
	| { ready: false; error: unknown };

/**
 * The durable offline queue is optional for a healthy online session. Return its
 * readiness as data so a storage failure cannot reject the whole POS bootstrap.
 */
export async function resolveOfflineQueueReadiness(
	ensureReady: () => Promise<unknown>,
): Promise<OfflineQueueReadinessResult> {
	try {
		await ensureReady();
		return { ready: true, error: null };
	} catch (error) {
		return { ready: false, error };
	}
}
