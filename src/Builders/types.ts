import type { proto } from '../../WAProto/index.js'
import type { MessageRelayOptions, MiscMessageGenerationOptions, WAMediaUploadFunction } from '../Types'
import type { BinaryNode } from '../WABinary'

export type MaybePromise<T> = T | Promise<T>

/**
 * The slice of a `WASocket` the builders actually touch.
 *
 * Structural on purpose: a full socket satisfies it, and so does a stub in tests.
 */
export type BuilderSocket = {
	user?: { id: string } | undefined
	waUploadToServer: WAMediaUploadFunction
	relayMessage: (jid: string, message: proto.IMessage, options: MessageRelayOptions) => Promise<string>
}

export type BuilderGenerationOptions = MiscMessageGenerationOptions & {
	/** own jid stamped on group/status messages; defaults to the socket's */
	userJid?: string
}

export type BuilderSendOptions = BuilderGenerationOptions & {
	additionalNodes?: BinaryNode[]
}

/** A resolved media reference: an uploaded URL, a raw buffer, or nothing usable. */
export type ResolvedMedia = string | Buffer | undefined

export type MediaInput = string | Buffer | null | undefined

export type MediaResultFormat = 'url' | 'buffer' | 'base64'

export type ResolveMediaOptions = {
	/** download `https://` inputs instead of passing the URL straight through */
	resolveUrl?: boolean
	/** download `*.whatsapp.net` inputs instead of passing the URL straight through */
	resolveWAUrl?: boolean
	result?: MediaResultFormat
	resize?: boolean
	width?: number
	height?: number
}

export type ImageFit = 'cover' | 'contain' | 'fill' | 'inside' | 'outside'

export type Mp4PreviewOptions = {
	/** seconds into the video to grab; defaults to 20% of the duration, capped at 10s */
	time?: number
	result?: MediaResultFormat
	resize?: boolean
	width?: number
	height?: number
	/** return an empty result instead of throwing when ffmpeg is missing or the input is not a video */
	silent?: boolean
}

export type InlineEntityOptions = {
	extract?: boolean
	hyperlink?: boolean
	citation?: boolean
	latex?: boolean
}

export type InlineEntity = {
	key: string
	metadata: Record<string, unknown>
}

export type ExtractedInlineEntities = {
	text: string
	ie: InlineEntitySource[]
	inline_entities: InlineEntity[]
}

export type InlineEntitySource =
	| { type: 'hyperlink'; ie: HyperlinkSource }
	| { type: 'citation'; ie: CitationSource }
	| { type: 'latex'; ie: LatexSource }

export type HyperlinkSource = {
	key: string
	text: string
	url: string
	is_trusted: boolean
}

export type CitationSource = {
	key: string
	text: string
	url: string
	reference_id: number
}

export type LatexSource = {
	key: string
	text: string
	url: string
	width: string | null
	height: string | null
	font_height: string | null
	padding: string | null
}

/** One renderable item inside a rich section, keyed by its `__typename`. */
export type RichPrimitive = Record<string, unknown>

export type RichViewModel = {
	__typename: string
	primitive?: RichPrimitive
	primitives?: RichPrimitive[]
}

export type RichSection = {
	view_model: RichViewModel
} & Record<string, unknown>

export type RichSubmessage = proto.IAIRichResponseSubMessage | Record<string, unknown>

/** Either an item id, or `[id, offset]` to address a neighbour of that item. */
export type NodeTarget = string | [string] | [string, number]

export type ContentPlacement = {
	/** name this item so `replace`, `insertAt` and `delete` can address it later */
	id?: string
	/** swap the targeted item out for this one, keeping its position and id */
	replace?: NodeTarget
	/** place this item directly after the target (before it, for negative offsets) */
	insertAt?: NodeTarget
}

export type LayoutName = string

export type CodeHighlightType = 'DEFAULT' | 'KEYWORD' | 'METHOD' | 'STR' | 'NUMBER' | 'COMMENT'

export type CodeBlock = {
	codeContent: string
	highlightType: number
}

export type UnifiedCodeBlock = {
	content: string
	type: CodeHighlightType
}

export type TokenizedCode = {
	codeBlock: CodeBlock[]
	unified_codeBlock: UnifiedCodeBlock[]
}

export type TableCell = {
	text: string
	inline_entities?: InlineEntity[]
}

export type UnifiedTableRow = {
	is_header: boolean
	cells: string[]
	markdown_cells?: TableCell[]
}

export type TableMetadata = {
	title: string
	rows: { items: string[]; isHeading?: true }[]
	unified_rows: UnifiedTableRow[]
}

export type SourceItem = {
	icon?: string
	favicon?: string
	url?: string
	title?: string
	subtitle?: string
}

export type ReelItem = {
	videoUrl?: string
	url?: string
	thumbnailUrl?: string
	thumbnail?: string
	profileIconUrl?: string
	profile_url?: string
	profile?: string
	username?: string
	title?: string
	reels_title?: string
	likes_count?: number
	like?: number
	shares_count?: number
	share?: number
	view_count?: number
	view?: number
	reel_source?: string
	source?: string
	is_verified?: boolean
	verified?: boolean
}

export type ProductItem = {
	title?: string
	brand?: string
	price?: string
	sale_price?: string
	product_url?: string
	url?: string
	image_url?: MediaInput
	image?: MediaInput
	icon_url?: MediaInput
	icon?: MediaInput
}

export type PostItem = {
	title?: string
	subtitle?: string
	username?: string
	profile_picture_url?: MediaInput
	profile_url?: MediaInput
	profile?: MediaInput
	is_verified?: boolean
	verified?: boolean
	thumbnail_url?: MediaInput
	thumbnail?: MediaInput
	post_caption?: string
	caption?: string
	likes_count?: number
	like?: number
	comments_count?: number
	comment?: number
	shares_count?: number
	share?: number
	post_url?: string
	url?: string
	post_deeplink?: string
	deeplink?: string
	source_app?: string
	source?: string
	footer_label?: string
	footer?: string
	footer_icon?: MediaInput
	icon?: MediaInput
	orientation?: string
	post_type?: string
}

export type WidgetAction = {
	label?: string
	state?: string
	kind?: string
	tool_call_id?: string
	id?: string
	toast?: { label?: string }
}

export type WidgetItem = {
	title?: string
	header?: Record<string, unknown>
	body?: Record<string, unknown>
	sections?: Record<string, unknown>[]
	actions?: WidgetAction[]
}

export type FooterActionItem = {
	text?: string
	cta_text?: string
	type?: string
	cta_type?: string
	url?: string
	cta_url?: string
}

export type VideoInput = {
	url: MediaInput
	mime_type?: string
	file_length?: number
	duration?: number
	thumbnail?: MediaInput
}

export type ImagineStatus = string
