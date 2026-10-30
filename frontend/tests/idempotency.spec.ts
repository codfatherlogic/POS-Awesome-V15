import { afterEach, describe, expect, it, vi } from "vitest";

import {
	ensureInvoiceSubmissionIdentity,
	ensureOfflineInvoiceRequest,
	generateClientRequestId,
} from "../src/offline/idempotency";

describe("invoice submission identity", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses getRandomValues when randomUUID is unavailable", () => {
		vi.stubGlobal("crypto", {
			getRandomValues: (words: Uint32Array) => {
				words.set([1, 2, 3, 4]);
				return words;
			},
		});

		expect(generateClientRequestId("inv")).toMatch(
			/^inv-[a-z0-9]+-00000001000000020000000300000004$/,
		);
	});

	it("keeps the invoice identity authoritative and normalizes all aliases", () => {
		const invoice = { posa_client_request_id: " invoice-fixed-001 " };
		const data = {
			idempotency_key: "stale-idempotency-key",
			client_request_id: "stale-client-request-id",
		};

		const requestId = ensureInvoiceSubmissionIdentity(invoice, data);

		expect(requestId).toBe("invoice-fixed-001");
		expect(invoice.posa_client_request_id).toBe("invoice-fixed-001");
		expect(data).toEqual({
			idempotency_key: "invoice-fixed-001",
			client_request_id: "invoice-fixed-001",
		});
	});

	it("promotes a legacy data id when an offline invoice has no identity", () => {
		const entry = {
			invoice: {},
			data: {
				idempotency_key: "legacy-offline-001",
				client_request_id: "stale-client-id",
			},
		};

		expect(ensureOfflineInvoiceRequest(entry)).toBe("legacy-offline-001");
		expect(entry.invoice.posa_client_request_id).toBe("legacy-offline-001");
		expect(entry.data.client_request_id).toBe("legacy-offline-001");
	});
});
