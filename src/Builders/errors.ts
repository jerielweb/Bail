export type AIRichErrorCode =
	| 'ITEM_NOT_FOUND'
	| 'DUPLICATE_ID'
	| 'INVALID_TARGET'
	| 'CONTENT_VALIDATION'
	| 'ALREADY_HAS_ID'

/** Base class for every builder-side failure, so callers can branch on `.code`. */
export class AIRichError extends Error {
	readonly code: AIRichErrorCode
	readonly meta: Record<string, unknown>

	constructor(message: string, code: AIRichErrorCode, meta: Record<string, unknown> = {}) {
		super(message)
		this.name = 'AIRichError'
		this.code = code
		this.meta = meta
	}
}

export class ItemNotFoundError extends AIRichError {
	readonly id: string
	readonly availableIds: string[]

	constructor(id: string, availableIds: string[] = []) {
		const known = availableIds.length ? ` (available: ${availableIds.join(', ')})` : ' (no items have an id yet)'

		super(`Item id "${id}" not found${known}`, 'ITEM_NOT_FOUND', { id, availableIds })

		this.name = 'ItemNotFoundError'
		this.id = id
		this.availableIds = availableIds
	}
}

export class DuplicateIdError extends AIRichError {
	readonly id: string

	constructor(id: string) {
		super(`Item id "${id}" already exists`, 'DUPLICATE_ID', { id })

		this.name = 'DuplicateIdError'
		this.id = id
	}
}

export class InvalidTargetError extends AIRichError {
	constructor(message: string, meta: Record<string, unknown> = {}) {
		super(message, 'INVALID_TARGET', meta)

		this.name = 'InvalidTargetError'
	}
}

export class ContentValidationError extends AIRichError {
	constructor(message: string, meta: Record<string, unknown> = {}) {
		super(message, 'CONTENT_VALIDATION', meta)

		this.name = 'ContentValidationError'
	}
}
