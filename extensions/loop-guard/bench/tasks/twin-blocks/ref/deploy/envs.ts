// Deployment environments.

export function dev() {
	return {
		name: "dev",
		timeout: 30,
		retries: 1,
	};
}

export function staging() {
	return {
		name: "staging",
		timeout: 60,
		retries: 3,
		canary: true,
	};
}

export function production() {
	return {
		name: "production",
		timeout: 120,
		retries: 5,
		canary: true,
		region: "eu-north-1",
	};
}

export const ENVS = { dev, staging, production };
