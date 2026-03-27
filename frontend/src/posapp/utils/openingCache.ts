export function hasCachedOpeningData(openingData: any): boolean {
	return !!(
		openingData &&
		openingData.pos_profile &&
		openingData.pos_opening_shift
	);
}

export function isCachedOpeningValidForCurrentUser(
	openingData: any,
	currentUser?: string | null,
): boolean {
	if (!hasCachedOpeningData(openingData)) {
		return false;
	}
	const cachedUser = openingData?.pos_opening_shift?.user;
	if (!currentUser || !cachedUser) {
		return false;
	}
	return currentUser === cachedUser;
}

export function getValidCachedOpeningForCurrentUser(
	openingData: any,
	currentUser?: string | null,
) {
	if (!isCachedOpeningValidForCurrentUser(openingData, currentUser)) {
		return null;
	}
	return openingData;
}
