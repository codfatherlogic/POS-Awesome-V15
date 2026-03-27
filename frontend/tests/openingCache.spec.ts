import { describe, expect, it } from "vitest";

import {
	getValidCachedOpeningForCurrentUser,
	hasCachedOpeningData,
	isCachedOpeningValidForCurrentUser,
} from "../src/posapp/utils/openingCache";

describe("opening cache helpers", () => {
	const openingData = {
		pos_profile: { name: "POS-1" },
		pos_opening_shift: { name: "SHIFT-1", user: "test@example.com" },
	};

	it("accepts cached opening data only for the matching user", () => {
		expect(
			isCachedOpeningValidForCurrentUser(
				openingData,
				"test@example.com",
			),
		).toBe(true);
		expect(
			isCachedOpeningValidForCurrentUser(
				openingData,
				"other@example.com",
			),
		).toBe(false);
	});

	it("returns the cached opening payload when it is valid", () => {
		expect(
			getValidCachedOpeningForCurrentUser(
				openingData,
				"test@example.com",
			),
		).toEqual(openingData);
		expect(
			getValidCachedOpeningForCurrentUser(
				openingData,
				"other@example.com",
			),
		).toBeNull();
	});

	it("requires both pos profile and opening shift data", () => {
		expect(hasCachedOpeningData(openingData)).toBe(true);
		expect(hasCachedOpeningData({ pos_profile: openingData.pos_profile })).toBe(
			false,
		);
	});
});
