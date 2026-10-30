import { describe, expect, it } from "vitest";

import { installChrome109Polyfills } from "../src/browserCompatibility";

describe("Chrome 109 runtime polyfills", () => {
	it("installs dependency-required copying array methods without mutating inputs", () => {
		const prototype: Record<string, any> = {};
		installChrome109Polyfills(prototype);
		const input = [3, 1, 2];

		expect(prototype.toSorted.call(input, (a: number, b: number) => a - b)).toEqual([
			1, 2, 3,
		]);
		expect(prototype.toReversed.call(input)).toEqual([2, 1, 3]);
		expect(prototype.toSpliced.call(input, 1, 1, 9)).toEqual([3, 9, 2]);
		expect(input).toEqual([3, 1, 2]);
	});

	it("does not replace native implementations", () => {
		const native = () => "native";
		const prototype: Record<string, any> = { toSorted: native };

		installChrome109Polyfills(prototype);

		expect(prototype.toSorted).toBe(native);
	});
});
