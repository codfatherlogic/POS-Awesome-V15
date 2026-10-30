import { describe, expect, it } from "vitest";

import { resolveCounterGridPaymentShortcut } from "../src/posapp/utils/counterGridPaymentShortcuts";

const event = (overrides: Partial<KeyboardEvent> = {}) =>
	({
		altKey: false,
		ctrlKey: false,
		defaultPrevented: false,
		key: "",
		metaKey: false,
		repeat: false,
		shiftKey: false,
		...overrides,
	}) as KeyboardEvent;

describe("Counter Grid payment shortcuts", () => {
	it.each([
		[{ ctrlKey: true, key: "1" }, 0],
		[{ metaKey: true, key: "3" }, 2],
	])(
		"selects a POS Profile payment method by accelerator order",
		(keys, index) => {
			expect(resolveCounterGridPaymentShortcut(event(keys), 4)).toEqual({
				type: "select-method",
				index,
			});
		},
	);

	it("submits or submits and prints with the shared accelerator", () => {
		expect(
			resolveCounterGridPaymentShortcut(
				event({ ctrlKey: true, key: "Enter" }),
				2,
			),
		).toEqual({
			type: "submit",
			print: false,
		});
		expect(
			resolveCounterGridPaymentShortcut(
				event({ metaKey: true, shiftKey: true, key: "Enter" }),
				2,
			),
		).toEqual({ type: "submit", print: true });
	});

	it("ignores missing methods, repeats, Alt chords, and unmodified input", () => {
		expect(
			resolveCounterGridPaymentShortcut(
				event({ ctrlKey: true, key: "4" }),
				3,
			),
		).toBeNull();
		expect(
			resolveCounterGridPaymentShortcut(
				event({ ctrlKey: true, key: "1", repeat: true }),
				3,
			),
		).toBeNull();
		expect(
			resolveCounterGridPaymentShortcut(
				event({ altKey: true, ctrlKey: true, key: "1" }),
				3,
			),
		).toBeNull();
		expect(
			resolveCounterGridPaymentShortcut(event({ key: "1" }), 3),
		).toBeNull();
	});
});
