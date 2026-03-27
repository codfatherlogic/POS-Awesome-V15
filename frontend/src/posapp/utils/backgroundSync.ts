/**
 * Background sync validation utilities.
 */

/**
 * Normalizes the background sync interval to a valid value.
 */
export const normalizeBackgroundSyncInterval = (
    value: any,
    defaultValue: number = 30,
    minValue: number = 10
): number => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return defaultValue;
    }
    return Math.max(minValue, parsed);
};

/**
 * Interface for background sync validation parameters.
 */
export interface BackgroundSyncParams {
    posProfile: any;
    enableBackgroundSync: boolean;
    backgroundSyncInFlight: boolean;
    isOffline: boolean;
    usesLimitSearch: boolean;
}

/**
 * Determines whether background sync should run based on current state.
 */
export const shouldRunBackgroundSync = ({
    posProfile,
    enableBackgroundSync,
    backgroundSyncInFlight,
    isOffline,
    usesLimitSearch,
}: BackgroundSyncParams): boolean => {
    if (!posProfile || !posProfile.name) {
        return false;
    }
    if (!enableBackgroundSync) {
        return false;
    }
    if (backgroundSyncInFlight) {
        return false;
    }
    if (isOffline) {
        return false;
    }
    if (usesLimitSearch) {
        return false;
    }
    return true;
};
