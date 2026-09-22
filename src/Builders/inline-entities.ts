import type {
	CitationSource,
	ExtractedInlineEntities,
	HyperlinkSource,
	InlineEntity,
	InlineEntityOptions,
	InlineEntitySource,
	LatexSource
} from './types'

const HYPERLINK_KEY = 'NIXEL_HYPERLINK'
const CITATION_KEY = 'NIXEL_CITATION'
const LATEX_KEY = 'NIXEL_LATEX'

const DEFAULT_LATEX_SIZE = 100
const DEFAULT_LATEX_FONT_HEIGHT = 83.333333333333
const DEFAULT_LATEX_PADDING = 15

const toHyperlinkEntity = (ie: HyperlinkSource): InlineEntity => ({
	key: ie.key,
	metadata: {
		display_name: ie.text,
		is_trusted: ie.is_trusted,
		url: ie.url,
		__typename: 'GenAIInlineLinkItem'
	}
})

const toCitationEntity = (ie: CitationSource): InlineEntity => ({
	key: ie.key,
	metadata: {
		reference_id: ie.reference_id,
		reference_url: ie.url,
		reference_title: ie.url,
		reference_display_name: ie.url,
		sources: [],
		__typename: 'GenAISearchCitationItem'
	}
})

const toLatexEntity = (ie: LatexSource): InlineEntity => ({
	key: ie.key,
	metadata: {
		latex_expression: ie.text,
		latex_image: {
			url: ie.url,
			width: Number(ie.width) || DEFAULT_LATEX_SIZE,
			height: Number(ie.height) || DEFAULT_LATEX_SIZE
		},
		font_height: Number(ie.font_height) || DEFAULT_LATEX_FONT_HEIGHT,
		padding: Number(ie.padding) || DEFAULT_LATEX_PADDING,
		__typename: 'GenAILatexItem'
	}
})

const toEntity = (source: InlineEntitySource): InlineEntity => {
	if (source.type === 'hyperlink') {
		return toHyperlinkEntity(source.ie)
	}

	if (source.type === 'citation') {
		return toCitationEntity(source.ie)
	}

	return toLatexEntity(source.ie)
}

/**
 * Rewrites markdown-ish spans into the `{{KEY}}…{{/KEY}}` placeholders WhatsApp's
 * rich renderer expects, and returns the entity table those placeholders resolve against.
 *
 * - `[label](url)` becomes a hyperlink; prefixing the url with `!` marks it untrusted
 * - `[](url)` with an empty label becomes a numbered citation
 * - `[expression|width|height|fontHeight|padding]<imageUrl>` becomes a rendered LaTeX image
 */
export const extractInlineEntities = (
	text: string,
	{ extract = true, hyperlink = true, citation = true, latex = true }: InlineEntityOptions = {}
): ExtractedInlineEntities => {
	if (!extract) {
		return { text, ie: [], inline_entities: [] }
	}

	const sources: InlineEntitySource[] = []
	const entities: InlineEntity[] = []
	const openBrackets: number[] = []

	let result = ''
	let last = 0
	let citationIndex = 1
	let hyperlinkIndex = 0
	let latexIndex = 0

	for (let i = 0; i < text.length; i++) {
		if (text[i] === '[' && text[i - 1] !== '\\') {
			openBrackets.push(i)
			continue
		}

		if (text[i] !== ']' || (text[i + 1] !== '(' && text[i + 1] !== '<')) {
			continue
		}

		const start = openBrackets.pop()

		if (start === undefined) {
			continue
		}

		const open = text[i + 1]
		const close = open === '(' ? ')' : '>'
		const isLatex = open === '<'

		let end = i + 2
		let depth = 1

		while (end < text.length && depth) {
			if (text[end] === open && text[end - 1] !== '\\') {
				depth++
			} else if (text[end] === close && text[end - 1] !== '\\') {
				depth--
			}

			end++
		}

		if (depth) {
			continue
		}

		const raw = text.slice(start + 1, i).trim()

		let url = text.slice(i + 2, end - 1).trim()
		let key: string
		let tag: string
		let source: InlineEntitySource

		if (isLatex) {
			if (!latex) {
				continue
			}

			const [expression = '', width = null, height = null, fontHeight = null, padding = null] = raw.split('|')

			key = `${LATEX_KEY}_${latexIndex++}`
			tag = `{{${key}}}${expression || 'image'}{{/${key}}}`

			source = {
				type: 'latex',
				ie: {
					key,
					text: expression,
					url,
					width,
					height,
					font_height: fontHeight,
					padding
				}
			}
		} else if (raw) {
			if (!hyperlink) {
				continue
			}

			const isTrusted = !url.startsWith('!')

			if (!isTrusted) {
				url = url.slice(1)
			}

			key = `${HYPERLINK_KEY}_${hyperlinkIndex++}`
			tag = `{{${key}}}${url}{{/${key}}}`

			source = {
				type: 'hyperlink',
				ie: {
					key,
					text: raw,
					url,
					is_trusted: isTrusted
				}
			}
		} else {
			if (!citation) {
				continue
			}

			key = `${CITATION_KEY}_${citationIndex - 1}`
			tag = `{{${key}}}${url}{{/${key}}}`

			source = {
				type: 'citation',
				ie: {
					key,
					text: '',
					url,
					reference_id: citationIndex++
				}
			}
		}

		result += text.slice(last, start) + tag
		last = end

		sources.push(source)
		entities.push(toEntity(source))

		i = end - 1
	}

	result += text.slice(last)

	return { text: result, ie: sources, inline_entities: entities }
}
