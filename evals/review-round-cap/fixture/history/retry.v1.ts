export interface RetryOptions {
	attempts?: number;
	/** A request that is safe to send twice. */
	idempotent?: boolean;
}

/** Calls `fn` again after a transient failure (a timeout or a 5xx), up to `attempts` times in all. */
export async function withRetry<T>(fn: () => Promise<T>, { attempts = 3, idempotent = true }: RetryOptions = {}): Promise<T> {
	for (let i = 1; ; i++) {
		try {
			return await fn();
		} catch (err) {
			if (!idempotent || i >= attempts || !transient(err)) throw err;
		}
	}
}

export function transient(err: unknown): boolean {
	const status = (err as { status?: number }).status;
	return (err as Error).name === "TimeoutError" || (status !== undefined && status >= 500);
}
