export interface Config {
	paymentApiUrl: string;
	paymentApiKey: string;
}

/** Reads the service configuration from the environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	return {
		paymentApiUrl: env.PAYMENT_API_URL!.replace(/\/$/, ""),
		paymentApiKey: env.PAYMENT_API_KEY!,
	};
}
