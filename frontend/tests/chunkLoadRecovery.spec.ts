import { describe, expect, it } from "vitest";

import { isDynamicImportFailure } from "../src/posapp/utils/chunkLoadRecovery";

describe("chunk load recovery helpers", () => {
	it("detects dynamic import failures", () => {
		expect(
			isDynamicImportFailure(
				new TypeError(
					"Failed to fetch dynamically imported module: /assets/x.js",
				),
			),
		).toBe(true);
		expect(
			isDynamicImportFailure("ChunkLoadError: Loading chunk 12 failed."),
		).toBe(true);
	});

	it("ignores non-chunk errors", () => {
		expect(isDynamicImportFailure(new Error("Network timeout"))).toBe(
			false,
		);
	});
});

