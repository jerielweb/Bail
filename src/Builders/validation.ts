export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value)

export const isPlainObjectArray = (value: unknown): value is Record<string, unknown>[] =>
	Array.isArray(value) && value.every(isPlainObject)

export const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every(item => typeof item === 'string')

export function assertString(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be a string`)
	}
}

export function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
	if (!isPlainObject(value)) {
		throw new TypeError(`${label} must be a plain object`)
	}
}
