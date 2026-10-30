declare const __BUILD_VERSION__: string;

const WORKER_ROOT = "/assets/posawesome/dist/js/posapp/workers";

function runtimeBuildVersion() {
	return typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : "";
}

export function buildPosWorkerUrl(
	workerFile: string,
	options: {
		buildVersion?: string | null;
		includeStartupTrace?: boolean;
	} = {},
) {
	const params = new URLSearchParams();
	const buildVersion = options.buildVersion ?? runtimeBuildVersion();
	if (buildVersion) params.set("v", buildVersion);
	if (
		options.includeStartupTrace &&
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).get(
			"posa_startup_trace",
		) === "1"
	) {
		params.set("posa_startup_trace", "1");
	}
	const query = params.toString();
	return `${WORKER_ROOT}/${workerFile}${query ? `?${query}` : ""}`;
}
