import {
	computed,
	getCurrentScope,
	onScopeDispose,
	ref,
	shallowRef,
} from "vue";

import { isApiEnvelopeError } from "../../../services/api";
import itemService, {
	type AlternateItemsResponse,
	type GetAlternateItemsArgs,
} from "../../../services/itemService";

export interface AlternateItemsLoadError {
	code: string;
	message: string;
	retryable: boolean;
}

export type AlternateItemsRequest = (
	args: GetAlternateItemsArgs,
	signal?: AbortSignal,
) => Promise<AlternateItemsResponse>;

export interface UseAlternateItemsOptions {
	request?: AlternateItemsRequest;
}

function normalizeLoadError(error: unknown): AlternateItemsLoadError {
	if (isApiEnvelopeError(error) && !error.envelope.ok) {
		return { ...error.envelope.error };
	}

	return {
		code: "UNKNOWN",
		message:
			error instanceof Error && error.message
				? error.message
				: "Unable to load alternate items",
		retryable: false,
	};
}

export function useAlternateItems(options: UseAlternateItemsOptions = {}) {
	const request =
		options.request || itemService.getAlternateItemsData.bind(itemService);
	const response = shallowRef<AlternateItemsResponse | null>(null);
	const lastArgs = shallowRef<GetAlternateItemsArgs | null>(null);
	const error = shallowRef<AlternateItemsLoadError | null>(null);
	const loading = ref(false);
	let requestVersion = 0;
	let abortController: AbortController | null = null;

	const items = computed(() => response.value?.items || []);
	const reason = computed(() => response.value?.reason || null);
	const hasItems = computed(() => items.value.length > 0);
	const profitDisplayAllowed = computed(
		() => response.value?.profit_display_allowed === true,
	);

	function invalidateActiveRequest() {
		requestVersion += 1;
		abortController?.abort();
		abortController = null;
		loading.value = false;
	}

	async function load(
		args: GetAlternateItemsArgs,
	): Promise<AlternateItemsResponse | null> {
		invalidateActiveRequest();
		const version = requestVersion;
		const controller = new AbortController();
		abortController = controller;
		lastArgs.value = { ...args };
		response.value = null;
		error.value = null;
		loading.value = true;

		try {
			const result = await request(lastArgs.value, controller.signal);
			if (version !== requestVersion || controller.signal.aborted) {
				return null;
			}
			response.value = result;
			return result;
		} catch (requestError) {
			if (version !== requestVersion || controller.signal.aborted) {
				return null;
			}
			const normalized = normalizeLoadError(requestError);
			if (normalized.code !== "ABORTED") {
				error.value = normalized;
			}
			return null;
		} finally {
			if (version === requestVersion) {
				loading.value = false;
				abortController = null;
			}
		}
	}

	function cancel() {
		invalidateActiveRequest();
	}

	function clear() {
		invalidateActiveRequest();
		response.value = null;
		lastArgs.value = null;
		error.value = null;
	}

	if (getCurrentScope()) {
		onScopeDispose(cancel);
	}

	// This module owns request/result state only. Cart effects belong to the caller.
	return {
		response,
		items,
		reason,
		hasItems,
		profitDisplayAllowed,
		lastArgs,
		error,
		loading,
		load,
		cancel,
		clear,
	};
}
