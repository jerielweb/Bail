import { Boom } from '@hapi/boom'
import { randomBytes, randomUUID } from 'crypto'
import { proto } from '../../WAProto/index.js'
import type { WAMessage, WAMessageKey } from '../Types'
import { generateMessageIDV2 } from '../Utils/generics'
import { generateWAMessageFromContent } from '../Utils/messages'
import { BaseBuilder } from './base-builder'
import { tokenizeCode } from './code-tokenizer'
import { AIRichError, ContentValidationError, DuplicateIdError, InvalidTargetError, ItemNotFoundError } from './errors'
import { extractInlineEntities } from './inline-entities'
import { Toolkit } from './toolkit'
import type {
	BuilderGenerationOptions,
	BuilderSendOptions,
	BuilderSocket,
	ContentPlacement,
	FooterActionItem,
	ImagineStatus,
	InlineEntityOptions,
	LayoutName,
	MediaInput,
	NodeTarget,
	PostItem,
	ProductItem,
	ReelItem,
	RichPrimitive,
	RichSection,
	RichSubmessage,
	RichViewModel,
	SourceItem,
	TableMetadata,
	TokenizedCode,
	VideoInput,
	WidgetItem
} from './types'
import { isPlainObject, isPlainObjectArray, isStringArray } from './validation'

const BUILDER_VERSION = '4.7'

const META_AI_BOT_JID = '867051314767696@bot'

const DEFAULT_SESSION_DISCLAIMER = '~ Ahmad tumbuh kembang'

const SIGNATURE_LENGTH = 64

const CERTIFICATE_LENGTHS = [684, 892]

const THUMBNAIL_SIZE = 300

const SubMessageType = proto.AIRichResponseSubMessageType

export type RichNode = {
	id: string | null
	section: RichSection | null
	submessage: RichSubmessage | null
}

export type AIRichOptions = {
	/** roll the response ids on every build, which is what lets a sent message be edited in place */
	dynamic?: boolean
	/** emit a placeholder submessage for primitives that have no plain-text fallback */
	unsupportedTypeAlert?: boolean
}

export type AIRichBuildOptions = BuilderGenerationOptions & {
	/** stamp the message as forwarded from the Meta AI bot, which is what unlocks the rich layout */
	forwarded?: boolean
	/** attach the AI safety disclaimer banner */
	notification?: boolean
	disclaimerText?: string
	includesUnifiedResponse?: boolean
	includesSubmessages?: boolean
	quotedParticipant?: string
}

export type AIRichSendOptions = AIRichBuildOptions & {
	additionalNodes?: BuilderSendOptions['additionalNodes']
	/**
	 * Re-send the message as an edit right after the first relay, so the rich layout
	 * renders without waiting on a download.
	 */
	bypassDownload?: boolean
}

export type AIRichEditOptions = AIRichSendOptions & {
	/** message content to edit into the target; built from the current items when omitted */
	msg?: proto.IMessage
}

export type TextOptions = ContentPlacement & Omit<InlineEntityOptions, 'extract'>

export type ImageOptions = ContentPlacement & {
	width?: number
	height?: number
	status?: ImagineStatus
	update_text?: string
	resolveUrl?: boolean
}

export type VideoOptions = ContentPlacement & {
	/** read length, duration and a preview frame off the video itself */
	autoFill?: boolean
	status?: ImagineStatus
	/** milliseconds from now, rendered as a countdown while the video is still generating */
	estimatedTime?: number
}

export type LayoutOptions = ContentPlacement & {
	layout?: LayoutName
}

export type SuggestOptions = LayoutOptions & {
	scroll?: boolean
}

const parseUnifiedSections = (data: Uint8Array): RichSection[] => {
	try {
		const parsed = JSON.parse(Buffer.from(data).toString('utf8')) as { sections?: RichSection[] }

		return Array.isArray(parsed.sections) ? parsed.sections : []
	} catch {
		return []
	}
}

const padded = (material: Buffer, length: number): Buffer =>
	Buffer.concat([material, randomBytes(Math.max(length - material.length, 0))])

/**
 * Builds the rich response layout WhatsApp renders for AI messages: markdown text with
 * inline links and citations, code blocks, tables, media, cards and suggestion pills.
 *
 * Items can be named with an `id`, then replaced, inserted next to or deleted, and the whole
 * message re-sent as an edit, so one message can be updated in place as content streams in.
 */
export class AIRich extends BaseBuilder {
	private nodes: RichNode[] = []
	private idIndex = new Map<string, RichNode>()
	private readonly unsupportedTypeAlert: boolean
	private readonly dynamic: boolean
	private responseId: string = randomUUID()
	private botResponseId: string = randomUUID()
	private lastMessageKey: WAMessageKey | undefined

	constructor(client: BuilderSocket, { dynamic = true, unsupportedTypeAlert = true }: AIRichOptions = {}) {
		super(client)

		this.dynamic = dynamic
		this.unsupportedTypeAlert = unsupportedTypeAlert
	}

	/** Rehydrates the builder from a rich response message, keeping its items editable. */
	loadFrom(input: WAMessage | proto.IMessage | null | undefined): this {
		if (!input) {
			throw new Boom('AI Rich message needed', { statusCode: 400 })
		}

		const message = ('message' in input && input.message ? input.message : input) as proto.IMessage
		const rich = message.botForwardedMessage?.message?.richResponseMessage ?? message.richResponseMessage

		if (!rich) {
			throw new Boom('richResponseMessage not found', { statusCode: 400 })
		}

		const extraPayload: proto.IMessage = structuredClone(message)

		delete extraPayload.messageContextInfo
		delete extraPayload.botForwardedMessage
		delete extraPayload.richResponseMessage

		this.title = message.messageContextInfo?.botMetadata?.messageDisclaimerText ?? ''
		this.contextInfo = structuredClone(rich.contextInfo ?? {})
		this.extraPayload = extraPayload

		const sections = rich.unifiedResponse?.data ? parseUnifiedSections(rich.unifiedResponse.data) : []
		const submessages: RichSubmessage[] = structuredClone(rich.submessages ?? [])

		this.nodes = []
		this.idIndex = new Map()

		for (let index = 0; index < Math.max(sections.length, submessages.length); index++) {
			this.nodes.push({
				id: null,
				section: sections[index] ?? null,
				submessage: submessages[index] ?? null
			})
		}

		return this
	}

	setResponseId(id: string): this {
		if (typeof id !== 'string') {
			throw new TypeError('ID must be a string')
		}

		this.responseId = id

		return this
	}

	refreshResponseId(): this {
		this.responseId = randomUUID()

		return this
	}

	setBotResponseId(id: string): this {
		if (typeof id !== 'string') {
			throw new TypeError('ID must be a string')
		}

		this.botResponseId = id

		return this
	}

	refreshBotResponseId(): this {
		this.botResponseId = randomUUID()

		return this
	}

	/** Markdown text, with `[label](url)`, `[](url)` citations and `[expr](<img>)` LaTeX. */
	addText(text: string, { hyperlink = true, citation = true, latex = true, ...placement }: TextOptions = {}): this {
		if (typeof text !== 'string') {
			throw new TypeError('Text must be a string')
		}

		const { text: extracted, inline_entities } = extractInlineEntities(text, { hyperlink, citation, latex })

		const section = AIRich.newLayout('Single', {
			text: extracted,
			...(inline_entities.length && { inline_entities }),
			__typename: 'GenAIMarkdownTextUXPrimitive'
		})

		return this.addContent(section, { messageType: SubMessageType.AI_RICH_RESPONSE_TEXT, messageText: text }, placement)
	}

	/** Plain text rendered in the follow-up-answer style, without markdown parsing. */
	addFOAText(text: string, placement: ContentPlacement = {}): this {
		if (typeof text !== 'string') {
			throw new TypeError('Text must be a string')
		}

		const section = AIRich.newLayout('Single', { text, __typename: 'FOATextPrimitive' })

		return this.addContent(section, { messageType: SubMessageType.AI_RICH_RESPONSE_TEXT, messageText: text }, placement)
	}

	addCode(language: string, code: string, placement: ContentPlacement = {}): this {
		if (typeof language !== 'string' || typeof code !== 'string') {
			throw new TypeError('Language and code must be a string')
		}

		const tokens = tokenizeCode(code, language)

		const section = AIRich.newLayout('Single', {
			language,
			code_blocks: tokens.unified_codeBlock,
			__typename: 'GenAICodeUXPrimitive'
		})

		return this.addContent(
			section,
			{
				messageType: SubMessageType.AI_RICH_RESPONSE_CODE,
				codeMetadata: { codeLanguage: language, codeBlocks: tokens.codeBlock }
			},
			placement
		)
	}

	/** First row is the header; every cell goes through the same markdown extraction as `addText`. */
	addTable(
		table: string[][],
		{ hyperlink = true, citation = true, latex = true, ...placement }: TextOptions = {}
	): this {
		if (!Array.isArray(table)) {
			throw new TypeError('Table must be an array')
		}

		const meta = AIRich.toTableMetadata(table, { hyperlink, citation, latex })

		const section = AIRich.newLayout('Single', { rows: meta.unified_rows, __typename: 'GenATableUXPrimitive' })

		return this.addContent(
			section,
			{
				messageType: SubMessageType.AI_RICH_RESPONSE_TABLE,
				tableMetadata: { title: meta.title, rows: meta.rows }
			},
			placement
		)
	}

	/** Source cards, as `['icon', 'url', 'title', 'subtitle']` tuples or objects. */
	addSource(sources: string[] | string[][] | SourceItem[] = [], placement: ContentPlacement = {}): this {
		if (!Array.isArray(sources)) {
			throw new TypeError('Sources must be an array of strings, arrays, or objects')
		}

		const list: unknown[] = sources

		if (!isStringArray(list) && !list.every(entry => isStringArray(entry) || isPlainObject(entry))) {
			throw new TypeError('Sources must be a string array, array of string arrays, or array of objects')
		}

		const entries: (string[] | SourceItem)[] = isStringArray(list) ? [list] : (list as (string[] | SourceItem)[])

		const items = entries.map(source => {
			if (Array.isArray(source)) {
				const [icon = '', url = '', title = '', subtitle = ''] = source

				return { icon, url, title, subtitle }
			}

			return {
				icon: source.favicon ?? source.icon ?? '',
				url: source.url ?? '',
				title: source.title ?? '',
				subtitle: source.subtitle ?? ''
			}
		})

		const section = AIRich.newLayout('Single', {
			sources: items.map(({ icon, url, title, subtitle }) => ({
				source_type: 'THIRD_PARTY',
				source_display_name: title,
				source_subtitle: subtitle,
				source_url: url,
				favicon: {
					url: Toolkit.resolveMedia(this.client, icon, 'image'),
					mime_type: 'image/jpeg',
					width: 16,
					height: 16
				}
			})),
			__typename: 'GenAISearchResultPrimitive'
		})

		return this.addContent(section, this.createAlert('GenAISearchResultPrimitive'), placement)
	}

	addReels(reels: ReelItem | ReelItem[] = [], placement: ContentPlacement = {}): this {
		if (!isPlainObject(reels) && !isPlainObjectArray(reels)) {
			throw new TypeError('Reels items must be an object or an array of objects')
		}

		const items = (Array.isArray(reels) ? reels : [reels]).map(item => ({
			item,
			avatar: Toolkit.resolveMedia(this.client, item.profileIconUrl ?? item.profile_url ?? item.profile ?? '', 'image'),
			thumbnail: Toolkit.resolveMedia(this.client, item.thumbnailUrl ?? item.thumbnail ?? '', 'image')
		}))

		const section = AIRich.newLayout(
			'HScroll',
			items.map(({ item, avatar, thumbnail }) => ({
				reels_url: item.videoUrl ?? item.url ?? '',
				thumbnail_url: thumbnail,
				creator: item.username ?? item.title ?? '',
				avatar_url: avatar,
				reels_title: item.reels_title ?? item.title ?? '',
				likes_count: item.likes_count ?? item.like ?? 0,
				shares_count: item.shares_count ?? item.share ?? 0,
				view_count: item.view_count ?? item.view ?? 0,
				reel_source: item.reel_source ?? item.source ?? 'IG',
				is_verified: !!(item.is_verified || item.verified),
				__typename: 'GenAIReelPrimitive'
			}))
		)

		return this.addContent(
			section,
			{
				messageType: SubMessageType.AI_RICH_RESPONSE_CONTENT_ITEMS,
				contentItemsMetadata: {
					contentType: 1,
					itemsMetadata: items.map(({ item, avatar, thumbnail }) => ({
						reelItem: {
							title: item.username ?? '',
							profileIconUrl: avatar,
							thumbnailUrl: thumbnail,
							videoUrl: item.videoUrl ?? item.url ?? ''
						}
					}))
				}
			},
			placement
		)
	}

	/** One image, or a list of them as separate items; pass an empty url to show a loading state. */
	addImage(
		image: MediaInput | MediaInput[],
		{ width, height, status = 'READY', update_text, resolveUrl = false, ...placement }: ImageOptions = {}
	): this {
		const list = (Array.isArray(image) ? image : [image]).map(item => {
			const url = Toolkit.resolveMedia(this.client, item, 'image', { resolveUrl })

			return { imagePreviewUrl: url, imageHighResUrl: url, sourceUrl: url }
		})

		const sections = list.map(({ imagePreviewUrl }) =>
			AIRich.newLayout('Single', {
				media: { url: imagePreviewUrl, mime_type: 'image/png', width, height },
				imagine_type: 'IMAGE',
				status: { status, update_text },
				__typename: 'GenAIImaginePrimitive'
			})
		)

		return this.addContent(
			sections,
			{
				messageType: SubMessageType.AI_RICH_RESPONSE_GRID_IMAGE,
				gridImageMetadata: {
					gridImageUrl: { imagePreviewUrl: list[0]?.imagePreviewUrl },
					imageUrls: list
				}
			},
			placement
		)
	}

	/** One video, or a list of them; pass an empty url to show a generating state. */
	addVideo(
		video: MediaInput | VideoInput | (MediaInput | VideoInput)[],
		{ autoFill = true, status = 'READY', estimatedTime, ...placement }: VideoOptions = {}
	): this {
		const items = Array.isArray(video) ? video : [video]

		const sections = items.map(item => {
			const details = isPlainObject(item) && 'url' in item ? item : undefined
			const url = Toolkit.resolveMedia(this.client, details ? details.url : (item as MediaInput), 'video')

			const buffer = autoFill
				? Promise.resolve(url).then(resolved =>
						typeof resolved === 'string' ? Toolkit.fetchBuffer(resolved) : (resolved ?? Buffer.alloc(0))
					)
				: undefined

			const fileLength = details?.file_length ?? buffer?.then(data => data.length) ?? 0
			const duration = details?.duration ?? buffer?.then(data => Toolkit.getMp4Duration(data)) ?? 0

			const thumbnail = details?.thumbnail
				? Toolkit.resolveMedia(this.client, details.thumbnail, 'image', {
						result: 'base64',
						resize: true,
						width: THUMBNAIL_SIZE,
						height: THUMBNAIL_SIZE
					})
				: buffer?.then(data => Toolkit.getMp4Preview(data, { time: 0, result: 'base64' }))

			return AIRich.newLayout('Single', {
				media: {
					url,
					mime_type: details?.mime_type ?? 'video/mp4',
					file_length: fileLength,
					duration
				},
				imagine_type: 'ANIMATE',
				status: {
					status,
					estimated_completion_time:
						estimatedTime === undefined ? undefined : Math.floor((Date.now() + estimatedTime) / 1000)
				},
				thumbnail: { raw_media: thumbnail },
				__typename: 'GenAIImaginePrimitive'
			})
		})

		return this.addContent(sections, this.createAlert('GenAIImaginePrimitive (ANIMATE)'), placement)
	}

	addProduct(product: ProductItem | ProductItem[] = {}, placement: ContentPlacement = {}): this {
		if (!isPlainObject(product) && !isPlainObjectArray(product)) {
			throw new TypeError('Product items must be an object or an array of objects')
		}

		const isList = Array.isArray(product)

		const items = (isList ? product : [product]).map(item => ({
			title: item.title,
			brand: item.brand,
			price: item.price,
			sale_price: item.sale_price,
			product_url: item.product_url ?? item.url,
			image: { url: Toolkit.resolveMedia(this.client, item.image_url ?? item.image, 'image') },
			additional_images: [{ url: Toolkit.resolveMedia(this.client, item.icon_url ?? item.icon, 'image') }],
			__typename: 'GenAIProductItemCardPrimitive'
		}))

		const section = AIRich.newLayout(isList ? 'HScroll' : 'Single', isList ? items : (items[0] ?? {}))

		return this.addContent(section, this.createAlert('GenAIProductItemCardPrimitive'), placement)
	}

	addPost(post: PostItem | PostItem[] = {}, placement: ContentPlacement = {}): this {
		if (!isPlainObject(post) && !isPlainObjectArray(post)) {
			throw new TypeError('Post items must be an object or an array of objects')
		}

		const items = Array.isArray(post) ? post : [post]

		const section = AIRich.newLayout(
			'HScroll',
			items.map(item => ({
				title: item.title ?? '',
				subtitle: item.subtitle ?? '',
				username: item.username ?? '',
				profile_picture_url: Toolkit.resolveMedia(
					this.client,
					item.profile_picture_url ?? item.profile_url ?? item.profile ?? '',
					'image'
				),
				is_verified: !!(item.is_verified || item.verified),
				thumbnail_url: Toolkit.resolveMedia(this.client, item.thumbnail_url ?? item.thumbnail ?? '', 'image'),
				post_caption: item.post_caption ?? item.caption ?? '',
				likes_count: item.likes_count ?? item.like ?? 0,
				comments_count: item.comments_count ?? item.comment ?? 0,
				shares_count: item.shares_count ?? item.share ?? 0,
				post_url: item.post_url ?? item.url ?? '',
				post_deeplink: item.post_deeplink ?? item.deeplink ?? '',
				source_app: item.source_app || item.source || 'INSTAGRAM',
				footer_label: item.footer_label ?? item.footer ?? '',
				footer_icon: Toolkit.resolveMedia(this.client, item.footer_icon ?? item.icon ?? '', 'image'),
				is_carousel: items.length > 1,
				orientation: item.orientation ?? 'LANDSCAPE',
				post_type: item.post_type ?? 'VIDEO',
				__typename: 'GenAIPostPrimitive'
			}))
		)

		return this.addContent(section, this.createAlert('GenAIPostPrimitive'), placement)
	}

	/** Small muted line, the same style the disclaimer uses. */
	addMetadata(text: string, placement: ContentPlacement = {}): this {
		if (typeof text !== 'string') {
			throw new TypeError('Text must be a string')
		}

		const section = AIRich.newLayout('Single', { text, __typename: 'GenAIMetadataTextPrimitive' })

		return this.addContent(section, { messageType: SubMessageType.AI_RICH_RESPONSE_TEXT, messageText: text }, placement)
	}

	/** A metadata line prefixed with an info glyph. */
	addTip(text: string, placement: ContentPlacement = {}): this {
		if (typeof text !== 'string') {
			throw new TypeError('Text must be a string')
		}

		const section = AIRich.newLayout('Single', {
			text: `ⓘ ${text}`,
			__typename: 'GenAIMetadataTextPrimitive'
		})

		return this.addContent(section, { messageType: SubMessageType.AI_RICH_RESPONSE_TEXT, messageText: text }, placement)
	}

	addWidget(widget: WidgetItem | WidgetItem[], { layout, id, replace, insertAt, ...extra }: LayoutOptions = {}): this {
		if (!isPlainObject(widget) && !isPlainObjectArray(widget)) {
			throw new TypeError('Widget must be an object or an array of objects')
		}

		const isList = Array.isArray(widget)

		const items = (isList ? widget : [widget]).map(item => ({
			__typename: 'GenAI3PExtWidgetPrimitive',
			header: {
				__typename: 'GenAI3PExtWidgetStandardHeader',
				title: item.title ?? '',
				...(item.header ?? {})
			},
			body: {
				__typename: 'GenAI3PExtCalendarEventList',
				sections: item.sections ?? [],
				ctas: (item.actions ?? []).map(action => ({
					__typename: 'GenAI3PExtWidgetCTA',
					label: action.label ?? '',
					state: action.state ?? 'PENDING',
					kind: action.kind ?? 'OTHER',
					tool_call_id: action.tool_call_id ?? action.id ?? '',
					...(action.toast && {
						toast: {
							__typename: 'GenAI3PExtWidgetToast',
							label: action.toast.label ?? action.label ?? ''
						}
					})
				})),
				...(item.body ?? {})
			}
		}))

		const section = AIRich.newLayout(
			layout ?? (isList ? 'HScroll' : 'Single'),
			isList ? items : (items[0] ?? {}),
			extra
		)

		return this.addContent(section, this.createAlert('GenAI3PExtWidgetStandardHeader'), { id, replace, insertAt })
	}

	/** Pinned call-to-action rendered under the whole response. */
	addFooterAction(
		action: FooterActionItem | FooterActionItem[],
		{ layout, id, replace, insertAt, ...extra }: LayoutOptions = {}
	): this {
		if (!isPlainObject(action) && !isPlainObjectArray(action)) {
			throw new TypeError('Footer action must be an object or an array of objects')
		}

		const isList = Array.isArray(action)

		const items = (isList ? action : [action]).map(item => ({
			__typename: 'GenAIFooterActionPrimitive',
			cta_text: item.text ?? item.cta_text ?? '',
			cta_type: item.type ?? item.cta_type ?? 'OPEN_URL',
			cta_url: item.url ?? item.cta_url ?? ''
		}))

		const section = AIRich.newLayout(
			layout ?? (isList ? 'HScroll' : 'Single'),
			isList ? items : (items[0] ?? {}),
			extra
		)

		return this.addContent(section, this.createAlert('GenAIFooterActionPrimitive'), { id, replace, insertAt })
	}

	/** Follow-up prompt pills. */
	addSuggest(suggestion: string | string[], { scroll = true, layout, ...placement }: SuggestOptions = {}): this {
		if (typeof suggestion !== 'string' && !isStringArray(suggestion)) {
			throw new TypeError('Suggestion must be a string or array of strings')
		}

		const items = (Array.isArray(suggestion) ? suggestion : [suggestion]).map(text => ({
			prompt_text: text,
			prompt_type: 'SUGGESTED_PROMPT',
			__typename: 'GenAIFollowUpSuggestionPillPrimitive'
		}))

		const type = layout ?? (items.length === 1 ? 'Single' : scroll ? 'HScroll' : 'ActionRow')

		const section = AIRich.newLayout(type, type === 'Single' ? (items[0] ?? {}) : items, {
			__typename: 'GenAIUnifiedResponseSection'
		})

		return this.addContent(section, this.createAlert('GenAIFollowUpSuggestionPillPrimitive'), placement)
	}

	/** Adds a section built by hand, for primitives the helpers do not cover. */
	addSection(section: RichSection | RichSection[], placement: ContentPlacement = {}): this {
		return this.addContent(section, undefined, placement)
	}

	/** Adds a plain-text fallback entry without any matching rich section. */
	addSubmessage(submessage: RichSubmessage | RichSubmessage[], placement: ContentPlacement = {}): this {
		return this.addContent(undefined, submessage, placement)
	}

	delete(target: NodeTarget): this {
		const { index } = this.resolveNodeIndex(target)
		const [removed] = this.nodes.splice(index, 1)

		if (removed) {
			this.unregisterId(removed)
		}

		return this
	}

	/** Names an existing item by position, so it can be targeted later. */
	assignId(index: number, id: string): this {
		const node = Number.isInteger(index) ? this.nodes[index] : undefined

		if (!node) {
			throw new InvalidTargetError(`Node index ${index} is out of range (0-${this.nodes.length - 1})`, { index })
		}

		if (node.id) {
			throw new AIRichError(`Node at index ${index} already has id "${node.id}"`, 'ALREADY_HAS_ID', {
				index,
				id: node.id
			})
		}

		this.registerId(node, id)

		return this
	}

	hasId(id: string): boolean {
		return typeof id === 'string' && this.idIndex.has(id)
	}

	getIds(): string[] {
		return [...this.idIndex.keys()]
	}

	peek(id: string): RichNode | null {
		const node = this.idIndex.get(id)

		if (!node) {
			return null
		}

		return { id: node.id, section: node.section, submessage: node.submessage }
	}

	get sections(): RichSection[] {
		return this.nodes.flatMap(node => (node.section ? [node.section] : []))
	}

	/** Every primitive currently in the message, ready to be mixed into another builder. */
	get items(): RichPrimitive[] {
		return this.sections.flatMap(section => {
			const viewModel = section.view_model

			if (Array.isArray(viewModel?.primitives)) {
				return viewModel.primitives
			}

			return viewModel?.primitive ? [viewModel.primitive] : []
		})
	}

	async build(jid: string, options: AIRichBuildOptions = {}): Promise<WAMessage> {
		const {
			forwarded = true,
			notification = false,
			disclaimerText = DEFAULT_SESSION_DISCLAIMER,
			includesUnifiedResponse = true,
			includesSubmessages = true,
			quoted,
			quotedParticipant,
			...rest
		} = options

		const sections = await Toolkit.waitAllPromises(this.sections)

		if (this.footer) {
			sections.push(AIRich.newLayout('Single', { text: this.footer, __typename: 'GenAIMetadataTextPrimitive' }))
		}

		const submessages = includesSubmessages ? await Toolkit.waitAllPromises(this.submessages) : []

		const contextInfo: proto.IContextInfo = {
			...(forwarded && {
				forwardingScore: 1,
				isForwarded: true,
				forwardedAiBotMessageInfo: { botJid: META_AI_BOT_JID },
				forwardOrigin: proto.ContextInfo.ForwardOrigin.META_AI
			}),
			...(quoted && {
				stanzaId: quoted.key.id,
				participant: quotedParticipant || quoted.key.participant || quoted.key.remoteJid,
				quotedType: proto.ContextInfo.QuotedType.EXPLICIT,
				quotedMessage: quoted.message
			}),
			...this.contextInfo
		}

		if (this.dynamic) {
			this.refreshResponseId()
			this.refreshBotResponseId()
		}

		return generateWAMessageFromContent(
			jid,
			{
				messageContextInfo: {
					deviceListMetadata: {},
					deviceListMetadataVersion: 2,
					botMetadata: {
						messageDisclaimerText: this.title,
						...(notification && {
							sessionTransparencyMetadata: {
								disclaimerText,
								hcaId: `hca_${Date.now()}`,
								sessionTransparencyType: proto.SessionTransparencyType.NY_AI_SAFETY_DISCLAIMER
							}
						}),
						verificationMetadata: AIRich.generateVerificationMetadata(),
						botResponseId: this.botResponseId
					}
				},
				...this.extraPayload,
				botForwardedMessage: {
					message: {
						richResponseMessage: {
							messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
							submessages: submessages as proto.IAIRichResponseSubMessage[],
							unifiedResponse: {
								data: includesUnifiedResponse
									? Buffer.from(Toolkit.stringifyEscaped({ response_id: this.responseId, sections }))
									: undefined
							},
							contextInfo
						}
					}
				}
			},
			this.generationOptions(rest)
		)
	}

	/** Wraps the current items as an edit of an already sent message. */
	async buildEdit(targetJid: string, targetId: string, options: AIRichEditOptions = {}): Promise<WAMessage> {
		const { msg, ...rest } = options
		const editedMessage = msg ?? (await this.build(targetJid, rest)).message

		if (!editedMessage) {
			throw new Boom('buildEdit: nothing to edit', { statusCode: 400 })
		}

		return generateWAMessageFromContent(
			targetJid,
			{
				botForwardedMessage: {
					message: {
						protocolMessage: {
							key: { remoteJid: targetJid, fromMe: true, id: targetId },
							type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
							editedMessage
						}
					}
				}
			},
			this.generationOptions(rest)
		)
	}

	/** Edits the last message this builder sent, or the one addressed by `jid` and `id`. */
	async sendEdit(jid?: string | null, id?: string | null, options: AIRichEditOptions = {}): Promise<WAMessage> {
		const { additionalNodes = [], ...rest } = options
		const targetJid = jid ?? this.lastMessageKey?.remoteJid

		const targetId = id ?? this.lastMessageKey?.id

		if (!targetJid) {
			throw new Boom('JID is required', { statusCode: 400 })
		}

		if (!targetId) {
			throw new Boom('Message id is required', { statusCode: 400 })
		}

		const messageId = rest.messageId || generateMessageIDV2()
		const message = await this.buildEdit(targetJid, targetId, { ...rest, messageId })

		await this.client.relayMessage(targetJid, message.message ?? {}, { messageId, additionalNodes })

		return message
	}

	async send(jid: string, options: AIRichSendOptions = {}): Promise<WAMessage> {
		const { bypassDownload = true, additionalNodes = [], ...rest } = options
		const messageId = rest.messageId || generateMessageIDV2()
		const message = await this.build(jid, { ...rest, messageId })

		await this.client.relayMessage(jid, message.message ?? {}, { ...rest, messageId, additionalNodes })

		this.lastMessageKey = message.key

		if (rest.includesUnifiedResponse !== false && bypassDownload) {
			await this.sendEdit(jid, messageId, { msg: message.message ?? {} })
		}

		return message
	}

	static tokenizer(code: string, lang = 'javascript'): TokenizedCode {
		return tokenizeCode(code, lang)
	}

	static toTableMetadata(table: string[][], options: InlineEntityOptions = {}): TableMetadata {
		if (
			!Array.isArray(table) ||
			!table.every(row => Array.isArray(row) && row.every(cell => typeof cell === 'string'))
		) {
			throw new TypeError('Table must be a nested array of strings')
		}

		const [header = [], ...rows] = table
		const width = Math.max(header.length, ...rows.map(row => row.length))
		const normalize = (row: string[]) => [...row, ...Array<string>(width - row.length).fill('')]

		const unified_rows = [
			{ is_header: true, cells: normalize(header) },
			...rows.map(row => ({ is_header: false, cells: normalize(row) }))
		].map(row => {
			const markdown_cells = row.cells.map(cell => {
				const { text, inline_entities } = extractInlineEntities(cell, options)

				return { text, ...(inline_entities.length && { inline_entities }) }
			})

			return {
				...row,
				...(markdown_cells.some(cell => cell.inline_entities?.length) && { markdown_cells })
			}
		})

		return {
			title: '',
			rows: unified_rows.map(row => ({ items: row.cells, ...(row.is_header && { isHeading: true as const }) })),
			unified_rows
		}
	}

	/** Fills the proof fields the rich renderer expects to find populated. */
	static generateVerificationMetadata(): proto.IBotSignatureVerificationMetadata {
		const signature = Buffer.from(`NIXEL.MessageBuilderV${BUILDER_VERSION}-VerificationSignature.Metadata`)
		const certificate = Buffer.from(`NIXEL.MessageBuilderV${BUILDER_VERSION}-CertificateChain.Metadata`)

		return {
			proofs: [
				{
					version: 1,
					useCase: proto.BotSignatureVerificationUseCaseProof.BotSignatureUseCase.WA_BOT_MSG,
					signature: padded(signature, SIGNATURE_LENGTH),
					certificateChain: CERTIFICATE_LENGTHS.map(length => padded(certificate, length))
				}
			]
		}
	}

	/** Wraps one primitive, or a list of them, in the layout the renderer keys off. */
	static newLayout(
		name: LayoutName,
		data: RichPrimitive | RichPrimitive[],
		extra: Record<string, unknown> = {}
	): RichSection {
		const view_model: RichViewModel = {
			__typename: `GenAI${name}LayoutViewModel`,
			...(Array.isArray(data) ? { primitives: data } : { primitive: data })
		}

		return { ...extra, view_model }
	}

	private get submessages(): RichSubmessage[] {
		return this.nodes.flatMap(node => (node.submessage ? [node.submessage] : []))
	}

	private createAlert(type: string): RichSubmessage | undefined {
		if (!this.unsupportedTypeAlert) {
			return undefined
		}

		return {
			messageType: SubMessageType.AI_RICH_RESPONSE_TEXT,
			messageText: `[ UNSUPPORTED_TYPE - ${type}]`
		}
	}

	private addContent(
		section: RichSection | RichSection[] | undefined,
		submessage: RichSubmessage | RichSubmessage[] | undefined,
		{ id, replace, insertAt }: ContentPlacement = {}
	): this {
		const hasReplace = replace !== undefined && replace !== null && replace !== ''
		const hasInsertAt = insertAt !== undefined && insertAt !== null && insertAt !== ''

		if (hasReplace && hasInsertAt) {
			throw new ContentValidationError('replace and insertAt cannot be used together')
		}

		const sections = section === undefined ? [] : this.validateSections(section)
		const submessages = this.validateSubmessages(submessage)

		if (!sections.length && !submessages.length) {
			throw new ContentValidationError('At least one section or submessage is required')
		}

		if (sections.length && submessages.length > 1 && submessages.length !== sections.length) {
			throw new ContentValidationError('Section and submessage count must match', {
				sectionCount: sections.length,
				submessageCount: submessages.length
			})
		}

		const count = Math.max(sections.length, submessages.length)

		if (id && count !== 1) {
			throw new ContentValidationError('One id can only be assigned to one node', { id, count })
		}

		if (id && this.idIndex.has(id) && !(hasReplace && this.resolveTarget(replace).id === id)) {
			throw new DuplicateIdError(id)
		}

		const newNodes: RichNode[] = Array.from({ length: count }, (_, index) => ({
			id: index === 0 ? (id ?? null) : null,
			section: sections[index] ?? null,
			submessage: (submessages.length === 1 ? (index === 0 ? submessages[0] : undefined) : submessages[index]) ?? null
		}))

		if (hasReplace) {
			const node = newNodes[0]

			if (!node || newNodes.length !== 1) {
				throw new ContentValidationError('replace only supports adding exactly one node')
			}

			const { index } = this.resolveNodeIndex(replace)
			const previous = this.nodes[index]

			if (!node.id && previous?.id) {
				node.id = previous.id
			}

			if (previous) {
				this.unregisterId(previous)
			}

			this.nodes.splice(index, 1, node)

			return this.indexNodes(newNodes)
		}

		if (hasInsertAt) {
			const { index, offset } = this.resolveNodeIndex(insertAt)

			this.nodes.splice(offset < 0 ? index : index + 1, 0, ...newNodes)

			return this.indexNodes(newNodes)
		}

		this.nodes.push(...newNodes)

		return this.indexNodes(newNodes)
	}

	private indexNodes(nodes: RichNode[]): this {
		for (const node of nodes) {
			if (node.id) {
				this.idIndex.set(node.id, node)
			}
		}

		return this
	}

	private registerId(node: RichNode, id: string): void {
		if (typeof id !== 'string' || !id) {
			throw new ContentValidationError('Item id must be a non-empty string', { id })
		}

		if (this.idIndex.has(id)) {
			throw new DuplicateIdError(id)
		}

		node.id = id
		this.idIndex.set(id, node)
	}

	private unregisterId(node: RichNode): void {
		if (node.id && this.idIndex.get(node.id) === node) {
			this.idIndex.delete(node.id)
		}
	}

	private getNode(id: string): RichNode {
		if (typeof id !== 'string' || !id) {
			throw new ContentValidationError('Item id must be a non-empty string', { id })
		}

		const node = this.idIndex.get(id)

		if (!node) {
			throw new ItemNotFoundError(id, this.getIds())
		}

		return node
	}

	private resolveTarget(target: NodeTarget | undefined): { id: string; offset: number } {
		if (Array.isArray(target)) {
			if (!target.length || target.length > 2) {
				throw new ContentValidationError('Target must be id or [id, offset]', { target })
			}

			const [id, offset = 0] = target

			if (typeof id !== 'string' || !id) {
				throw new ContentValidationError('Target id must be a non-empty string', { target })
			}

			if (!Number.isInteger(offset)) {
				throw new ContentValidationError('Offset must be an integer', { target })
			}

			return { id, offset }
		}

		if (typeof target !== 'string' || !target) {
			throw new ContentValidationError('Target must be a non-empty id or [id, offset]', { target })
		}

		return { id: target, offset: 0 }
	}

	private resolveNodeIndex(target: NodeTarget | undefined): {
		id: string
		offset: number
		baseIndex: number
		index: number
	} {
		const { id, offset } = this.resolveTarget(target)
		const baseIndex = this.nodes.indexOf(this.getNode(id))

		if (baseIndex === -1) {
			throw new InvalidTargetError(`Item id "${id}" is registered but not present in the node list`, { id })
		}

		const index = baseIndex + offset

		if (index < 0 || index >= this.nodes.length) {
			throw new InvalidTargetError(
				`Target "${id}" with offset ${offset} resolves to index ${index}, which is out of range (0-${this.nodes.length - 1})`,
				{ id, offset, index }
			)
		}

		return { id, offset, baseIndex, index }
	}

	private validateSections(section: RichSection | RichSection[]): RichSection[] {
		const items = Array.isArray(section) ? section : [section]

		if (!items.length) {
			throw new ContentValidationError('At least one section is required')
		}

		for (const item of items) {
			if (!isPlainObject(item)) {
				throw new ContentValidationError('Sections must be plain objects')
			}
		}

		return items
	}

	private validateSubmessages(submessage: RichSubmessage | RichSubmessage[] | undefined): RichSubmessage[] {
		if (submessage === undefined || submessage === null) {
			return []
		}

		const items = Array.isArray(submessage) ? submessage : [submessage]

		for (const item of items) {
			if (!isPlainObject(item)) {
				throw new ContentValidationError('Submessages must be plain objects')
			}
		}

		return items
	}
}
