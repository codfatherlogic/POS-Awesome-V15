import { describe, expect, it, vi } from "vitest";

import { resolveOfflineQueueReadiness } from "../src/posapp/utils/offlineQueueReadiness";

describe("offline queue boot readiness", () => {
	it("reports a ready durable queue", async () => {
		const ensureReady = vi.fn().mockResolvedValue(undefined);

		await expect(
			resolveOfflineQueueReadiness(ensureReady),
		).resolves.toEqual({
			ready: true,
			error: null,
		});
		expect(ensureReady).toHaveBeenCalledTimes(1);
	});

	it.each([
		[
			"quota failure",
			new DOMException("Quota exceeded", "QuotaExceededError"),
		],
		[
			"private-mode denial",
			new DOMException("Access denied", "SecurityError"),
		],
		["stale schema", new DOMException("Schema changed", "VersionError")],
	])("turns %s into non-throwing readiness state", async (_state, error) => {
		const ensureReady = vi.fn().mockRejectedValue(error);

		const result = await resolveOfflineQueueReadiness(ensureReady);

		expect(result).toEqual({ ready: false, error });
	});
});
