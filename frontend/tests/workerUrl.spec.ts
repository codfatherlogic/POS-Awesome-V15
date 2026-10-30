// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { buildPosWorkerUrl } from "../src/posapp/utils/workerUrl";

describe("POS worker URLs", () => {
	it("cache-busts unhashed workers with the current build version", () => {
		expect(
			buildPosWorkerUrl("itemWorker.js", { buildVersion: "build 42" }),
		).toBe(
			"/assets/posawesome/dist/js/posapp/workers/itemWorker.js?v=build+42",
		);
	});

	it("preserves startup tracing alongside the build version", () => {
		window.history.replaceState({}, "", "/?posa_startup_trace=1");
		expect(
			buildPosWorkerUrl("itemWorker.js", {
				buildVersion: "release-7",
				includeStartupTrace: true,
			}),
		).toContain("v=release-7&posa_startup_trace=1");
	});
});
