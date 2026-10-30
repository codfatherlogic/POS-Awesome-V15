type ArrayPrototype = Record<string, unknown>;

function defineArrayMethod(
	prototype: ArrayPrototype,
	name: string,
	implementation: (...args: any[]) => unknown,
) {
	if (typeof prototype[name] === "function") {
		return;
	}
	Object.defineProperty(prototype, name, {
		configurable: true,
		enumerable: false,
		writable: true,
		value: implementation,
	});
}

export function installChrome109Polyfills(
	prototype: ArrayPrototype = Array.prototype as unknown as ArrayPrototype,
) {
	defineArrayMethod(prototype, "toReversed", function (this: unknown[]) {
		return Array.from(this).reverse();
	});
	defineArrayMethod(
		prototype,
		"toSorted",
		function (this: unknown[], compareFn?: (a: unknown, b: unknown) => number) {
			return Array.from(this).sort(compareFn);
		},
	);
	defineArrayMethod(
		prototype,
		"toSpliced",
		function (this: unknown[], start: number, deleteCount?: number, ...items: unknown[]) {
			const copy = Array.from(this);
			if (arguments.length === 1) {
				copy.splice(start);
			} else {
				copy.splice(start, deleteCount ?? 0, ...items);
			}
			return copy;
		},
	);
}

installChrome109Polyfills();
