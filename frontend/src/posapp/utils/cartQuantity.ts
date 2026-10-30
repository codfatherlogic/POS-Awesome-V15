export const normalizeCartEditQuantity = (
	value: unknown,
	isReturnInvoice = false,
) => {
	const quantity = Number.parseFloat(String(value ?? ""));
	if (isReturnInvoice) {
		return !Number.isFinite(quantity) || quantity === 0
			? -1
			: -Math.abs(quantity);
	}
	return !Number.isFinite(quantity) || quantity <= 0 ? 1 : quantity;
};
