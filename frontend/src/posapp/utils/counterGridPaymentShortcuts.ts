export type CounterGridPaymentShortcut =
	| { type: "select-method"; index: number }
	| { type: "submit"; print: boolean };

type PaymentShortcutEvent = Pick<
	KeyboardEvent,
	| "altKey"
	| "ctrlKey"
	| "defaultPrevented"
	| "key"
	| "metaKey"
	| "repeat"
	| "shiftKey"
>;

export function resolveCounterGridPaymentShortcut(
	event: PaymentShortcutEvent,
	paymentMethodCount: number,
): CounterGridPaymentShortcut | null {
	if (
		event.defaultPrevented ||
		event.repeat ||
		event.altKey ||
		(!event.ctrlKey && !event.metaKey)
	) {
		return null;
	}

	if (event.key === "Enter") {
		return { type: "submit", print: event.shiftKey };
	}

	if (event.shiftKey || !/^[1-9]$/.test(event.key)) {
		return null;
	}

	const index = Number(event.key) - 1;
	if (index < 0 || index >= Math.min(Math.max(paymentMethodCount, 0), 9)) {
		return null;
	}

	return { type: "select-method", index };
}
