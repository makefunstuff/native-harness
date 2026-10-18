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
		timeout: 60,
		retries: 3,
		canary: true,
	};
}

export const ENVS = { dev, staging, production };
