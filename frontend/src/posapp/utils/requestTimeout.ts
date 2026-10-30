export class RequestTimeoutError extends Error {
	constructor(message = "Request timed out") {
		super(message);
		this.name = "RequestTimeoutError";
	}
}

export function withRequestTimeout<T>(
	request: PromiseLike<T>,
	timeoutMs: number,
	message = "Request timed out",
): Promise<T> {
	const boundedTimeout = Math.max(1, Number(timeoutMs) || 1);

	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const timeoutHandle = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new RequestTimeoutError(message));
		}, boundedTimeout);

		Promise.resolve(request).then(
			(value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutHandle);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutHandle);
				reject(error);
			},
		);
	});
}
