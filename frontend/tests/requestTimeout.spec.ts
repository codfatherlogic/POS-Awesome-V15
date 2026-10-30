import { afterEach, describe, expect, it, vi } from "vitest";

import {
	RequestTimeoutError,
	withRequestTimeout,
} from "../src/posapp/utils/requestTimeout";

describe("withRequestTimeout", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns a response that settles before the deadline", async () => {
		await expect(
			withRequestTimeout(Promise.resolve("ready"), 20),
		).resolves.toBe("ready");
	});

	it("rejects a never-settling request at the configured deadline", async () => {
		vi.useFakeTimers();
		const request = withRequestTimeout(
			new Promise(() => undefined),
			20_000,
			"Timed out loading authorized cashiers.",
		);
		const assertion = expect(request).rejects.toMatchObject({
			name: "RequestTimeoutError",
			message: "Timed out loading authorized cashiers.",
		});

		await vi.advanceTimersByTimeAsync(20_000);
		await assertion;
	});

	it("preserves a transport failure instead of replacing it", async () => {
		const failure = new Error("Server unavailable");
		await expect(
			withRequestTimeout(Promise.reject(failure), 20),
		).rejects.toBe(failure);
	});

	it("exposes a distinct timeout error for recoverable UI handling", () => {
		expect(new RequestTimeoutError()).toBeInstanceOf(Error);
		expect(new RequestTimeoutError().name).toBe("RequestTimeoutError");
	});
});
