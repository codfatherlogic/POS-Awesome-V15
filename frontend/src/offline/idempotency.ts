type AnyRecord = Record<string, any>;

function randomSuffix() {
	const cryptoApi = globalThis.crypto;
	if (typeof cryptoApi?.randomUUID === "function") {
		return cryptoApi.randomUUID();
	}
	if (typeof cryptoApi?.getRandomValues === "function") {
		const words = cryptoApi.getRandomValues(new Uint32Array(4));
		return Array.from(words, (word) => word.toString(16).padStart(8, "0")).join(
			"",
		);
	}
	return `${Math.random().toString(36).slice(2)}${Math.random()
		.toString(36)
		.slice(2)}`;
}

function normalizeRequestId(value: any) {
	return String(value || "").trim();
}

function ensureObject(value: any): AnyRecord {
	return value && typeof value === "object" ? value : {};
}

export function generateClientRequestId(prefix: string) {
	return `${prefix}-${Date.now().toString(36)}-${randomSuffix()}`;
}

export function ensureInvoiceClientRequestId(invoice: AnyRecord) {
	const target = ensureObject(invoice);
	if (!normalizeRequestId(target.posa_client_request_id)) {
		target.posa_client_request_id = generateClientRequestId("inv");
	} else {
		target.posa_client_request_id = normalizeRequestId(
			target.posa_client_request_id,
		);
	}
	return target.posa_client_request_id;
}

export function ensureInvoiceSubmissionIdentity(
	invoice: AnyRecord,
	data: AnyRecord,
) {
	const invoiceTarget = ensureObject(invoice);
	const dataTarget = ensureObject(data);
	const requestId =
		normalizeRequestId(invoiceTarget.posa_client_request_id) ||
		normalizeRequestId(dataTarget.idempotency_key) ||
		normalizeRequestId(dataTarget.client_request_id) ||
		generateClientRequestId("inv");

	invoiceTarget.posa_client_request_id = requestId;
	dataTarget.idempotency_key = requestId;
	dataTarget.client_request_id = requestId;
	return requestId;
}

export function ensureOfflineInvoiceRequest(entry: AnyRecord) {
	const target = ensureObject(entry);
	target.invoice = ensureObject(target.invoice);
	target.data = ensureObject(target.data);

	return ensureInvoiceSubmissionIdentity(target.invoice, target.data);
}

export function ensurePaymentClientRequestId(payload: AnyRecord) {
	const target = ensureObject(payload);
	if (!String(target.client_request_id || "").trim()) {
		target.client_request_id = generateClientRequestId("pay");
	}
	return target.client_request_id;
}
