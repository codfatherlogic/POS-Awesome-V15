import { describe, expect, it } from "vitest";

import {
	COUNTER_GRID_MIN_WIDTH,
	POS_UI_TEMPLATE_CLASSIC,
	POS_UI_TEMPLATE_COUNTER_GRID,
	isCounterGridTemplate,
	normalizePosUiTemplate,
	resolvePosUiTemplate,
} from "../src/posapp/utils/posUiTemplate";

describe("POS UI template resolution", () => {
	it("keeps Classic as the default for missing and unknown values", () => {
		expect(normalizePosUiTemplate(undefined)).toBe(POS_UI_TEMPLATE_CLASSIC);
		expect(normalizePosUiTemplate("Future UI")).toBe(
			POS_UI_TEMPLATE_CLASSIC,
		);
		expect(isCounterGridTemplate({}, 1440)).toBe(false);
	});

	it("enables Counter Grid only at the certified minimum width", () => {
		const profile = { posa_ui_template: POS_UI_TEMPLATE_COUNTER_GRID };

		expect(isCounterGridTemplate(profile, COUNTER_GRID_MIN_WIDTH - 1)).toBe(
			false,
		);
		expect(isCounterGridTemplate(profile, COUNTER_GRID_MIN_WIDTH)).toBe(
			true,
		);
	});

	it("keeps legacy profile values working until migration refreshes cached profiles", () => {
		expect(normalizePosUiTemplate("RetailMind Counter Grid")).toBe(
			POS_UI_TEMPLATE_COUNTER_GRID,
		);
	});

	it("reports the responsive fallback without changing the configured value", () => {
		const resolution = resolvePosUiTemplate(
			{ posa_ui_template: POS_UI_TEMPLATE_COUNTER_GRID },
			768,
		);

		expect(resolution).toEqual({
			configuredTemplate: POS_UI_TEMPLATE_COUNTER_GRID,
			effectiveTemplate: POS_UI_TEMPLATE_CLASSIC,
			fallbackReason: "viewport",
		});
	});
});
