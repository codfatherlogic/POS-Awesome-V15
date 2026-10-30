export const POS_UI_TEMPLATE_CLASSIC = "Classic";
export const POS_UI_TEMPLATE_COUNTER_GRID = "POS Awesome Counter Grid";
export const LEGACY_POS_UI_TEMPLATE_COUNTER_GRID = "RetailMind Counter Grid";
export const COUNTER_GRID_MIN_WIDTH = 1024;

export type PosUiTemplate =
	| typeof POS_UI_TEMPLATE_CLASSIC
	| typeof POS_UI_TEMPLATE_COUNTER_GRID;

export type PosUiTemplateResolution = {
	configuredTemplate: PosUiTemplate;
	effectiveTemplate: PosUiTemplate;
	fallbackReason: "viewport" | null;
};

export function normalizePosUiTemplate(value: unknown): PosUiTemplate {
	const normalizedValue = String(value || "").trim();
	return normalizedValue === POS_UI_TEMPLATE_COUNTER_GRID ||
		normalizedValue === LEGACY_POS_UI_TEMPLATE_COUNTER_GRID
		? POS_UI_TEMPLATE_COUNTER_GRID
		: POS_UI_TEMPLATE_CLASSIC;
}

export function resolvePosUiTemplate(
	profile: { posa_ui_template?: unknown } | null | undefined,
	viewportWidth: number,
): PosUiTemplateResolution {
	const configuredTemplate = normalizePosUiTemplate(
		profile?.posa_ui_template,
	);
	const hasCounterGridViewport =
		Number.isFinite(viewportWidth) &&
		viewportWidth >= COUNTER_GRID_MIN_WIDTH;
	const fallbackReason =
		configuredTemplate === POS_UI_TEMPLATE_COUNTER_GRID &&
		!hasCounterGridViewport
			? "viewport"
			: null;

	return {
		configuredTemplate,
		effectiveTemplate: fallbackReason
			? POS_UI_TEMPLATE_CLASSIC
			: configuredTemplate,
		fallbackReason,
	};
}

export function isCounterGridTemplate(
	profile: { posa_ui_template?: unknown } | null | undefined,
	viewportWidth: number,
): boolean {
	return (
		resolvePosUiTemplate(profile, viewportWidth).effectiveTemplate ===
		POS_UI_TEMPLATE_COUNTER_GRID
	);
}
