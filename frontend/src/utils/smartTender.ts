export function getSmartTenderSuggestions(amount: number, _currency?: string) {
	const magnitude = Math.pow(10, Math.max(Math.floor(Math.log10(Math.max(amount, 1))) - 1, 0));
	const denoms = [1, 2, 5, 10, 20, 50].map((factor) => factor * magnitude);
	const suggestions = new Set<number>();

	if (amount <= 0) return [];

	denoms.forEach((d) => {
		const multiple = Math.ceil(amount / d);
		const val = multiple * d;
		suggestions.add(val);
	});

	const sorted = Array.from(suggestions).sort((a, b) => a - b);

	const unique: number[] = [];
	const seen = new Set<number>();

	sorted.forEach((v) => {
		const fixed = Number(v.toFixed(2));

		if (fixed >= amount - 0.0001 && !seen.has(fixed)) {
			if (!(fixed < amount && Math.abs(fixed - amount) >= 0.001)) {
				seen.add(fixed);
				unique.push(fixed);
			}
		}
	});

	return unique.slice(0, 6);
}
