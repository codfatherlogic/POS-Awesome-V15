const DEFAULT_POSAPP_BASE_PATH = "/app/posapp";

export function resolvePosAppNormalizedPath(
	pathname: string,
	basePath = DEFAULT_POSAPP_BASE_PATH,
): string | null {
	if (!pathname || !basePath) {
		return null;
	}

	const normalizedBasePath =
		basePath.length > 1 ? basePath.replace(/\/+$/, "") : basePath;

	if (!pathname.toLowerCase().startsWith(`${normalizedBasePath.toLowerCase()}/`)) {
		return null;
	}

	if (pathname === normalizedBasePath) {
		return null;
	}

	return normalizedBasePath;
}
