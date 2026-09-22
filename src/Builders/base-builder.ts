import { Boom } from '@hapi/boom'
import type { proto } from '../../WAProto/index.js'
import type { MessageGenerationOptionsFromContent } from '../Types'
import { generateMessageIDV2 } from '../Utils/generics'
import type { BinaryNode } from '../WABinary'
import type { BuilderGenerationOptions, BuilderSocket } from './types'
import { assertPlainObject, assertString } from './validation'

/** WhatsApp only renders native flow buttons when the stanza carries this hint. */
export const createNativeFlowNode = (): BinaryNode => ({
	tag: 'biz',
	attrs: {},
	content: [
		{
			tag: 'interactive',
			attrs: { type: 'native_flow', v: '1' },
			content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
		}
	]
})

/** Text slots, context info and raw payload extras every builder shares. */
export abstract class BaseBuilder {
	protected readonly client: BuilderSocket
	protected title = ''
	protected subtitle = ''
	protected body = ''
	protected footer = ''
	protected contextInfo: proto.IContextInfo = {}
	protected extraPayload: proto.IMessage = {}

	constructor(client: BuilderSocket) {
		if (!client) {
			throw new Boom('Socket is required', { statusCode: 400 })
		}

		this.client = client
	}

	setTitle(title: string): this {
		assertString(title, 'Title')

		this.title = title

		return this
	}

	setSubtitle(subtitle: string): this {
		assertString(subtitle, 'Subtitle')

		this.subtitle = subtitle

		return this
	}

	setBody(body: string): this {
		assertString(body, 'Body')

		this.body = body

		return this
	}

	setFooter(footer: string): this {
		assertString(footer, 'Footer')

		this.footer = footer

		return this
	}

	setContextInfo(contextInfo: proto.IContextInfo): this {
		assertPlainObject(contextInfo, 'ContextInfo')

		this.contextInfo = contextInfo

		return this
	}

	/** Merges extra top-level message fields into whatever the builder produces. */
	addPayload(payload: proto.IMessage): this {
		assertPlainObject(payload, 'Payload')

		Object.assign(this.extraPayload, payload)

		return this
	}

	protected generationOptions({
		messageId,
		userJid,
		...rest
	}: BuilderGenerationOptions): MessageGenerationOptionsFromContent {
		return {
			...rest,
			messageId: messageId || generateMessageIDV2(),
			userJid: userJid ?? this.client.user?.id ?? ''
		}
	}
}
