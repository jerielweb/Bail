import type { CodeBlock, CodeHighlightType, TokenizedCode } from './types'

const HIGHLIGHT = {
	DEFAULT: 0,
	KEYWORD: 1,
	METHOD: 2,
	STR: 3,
	NUMBER: 4,
	COMMENT: 5
} as const

const HIGHLIGHT_NAMES: Record<number, CodeHighlightType> = {
	0: 'DEFAULT',
	1: 'KEYWORD',
	2: 'METHOD',
	3: 'STR',
	4: 'NUMBER',
	5: 'COMMENT'
}

const PLAIN_LANGUAGES = ['txt', 'text', 'plaintext']

const HASH_COMMENT_LANGUAGES = ['python', 'bash']

const KEYWORDS: Record<string, Set<string>> = {
	javascript: new Set([
		'break',
		'case',
		'catch',
		'continue',
		'debugger',
		'delete',
		'do',
		'else',
		'finally',
		'for',
		'function',
		'if',
		'in',
		'instanceof',
		'new',
		'return',
		'switch',
		'this',
		'throw',
		'try',
		'typeof',
		'var',
		'void',
		'while',
		'with',
		'true',
		'false',
		'null',
		'undefined',
		'class',
		'const',
		'let',
		'super',
		'extends',
		'export',
		'import',
		'yield',
		'static',
		'constructor',
		'async',
		'await',
		'get',
		'set'
	]),
	typescript: new Set([
		'abstract',
		'any',
		'as',
		'asserts',
		'bigint',
		'boolean',
		'declare',
		'enum',
		'implements',
		'infer',
		'interface',
		'is',
		'keyof',
		'module',
		'namespace',
		'never',
		'readonly',
		'require',
		'number',
		'object',
		'override',
		'private',
		'protected',
		'public',
		'satisfies',
		'string',
		'symbol',
		'type',
		'unknown',
		'using',
		'from',
		'break',
		'case',
		'catch',
		'continue',
		'do',
		'else',
		'finally',
		'for',
		'function',
		'if',
		'new',
		'return',
		'switch',
		'this',
		'throw',
		'try',
		'var',
		'void',
		'while',
		'class',
		'const',
		'let',
		'extends',
		'import',
		'export',
		'async',
		'await'
	]),
	python: new Set([
		'False',
		'None',
		'True',
		'and',
		'as',
		'assert',
		'async',
		'await',
		'break',
		'class',
		'continue',
		'def',
		'del',
		'elif',
		'else',
		'except',
		'finally',
		'for',
		'from',
		'global',
		'if',
		'import',
		'in',
		'is',
		'lambda',
		'nonlocal',
		'not',
		'or',
		'pass',
		'raise',
		'return',
		'try',
		'while',
		'with',
		'yield'
	]),
	java: new Set([
		'abstract',
		'assert',
		'boolean',
		'break',
		'byte',
		'case',
		'catch',
		'char',
		'class',
		'const',
		'continue',
		'default',
		'do',
		'double',
		'else',
		'enum',
		'extends',
		'final',
		'finally',
		'float',
		'for',
		'goto',
		'if',
		'implements',
		'import',
		'instanceof',
		'int',
		'interface',
		'long',
		'native',
		'new',
		'package',
		'private',
		'protected',
		'public',
		'return',
		'short',
		'static',
		'strictfp',
		'super',
		'switch',
		'synchronized',
		'this',
		'throw',
		'throws',
		'transient',
		'try',
		'void',
		'volatile',
		'while'
	]),
	golang: new Set([
		'break',
		'case',
		'chan',
		'const',
		'continue',
		'default',
		'defer',
		'else',
		'fallthrough',
		'for',
		'func',
		'go',
		'goto',
		'if',
		'import',
		'interface',
		'map',
		'package',
		'range',
		'return',
		'select',
		'struct',
		'switch',
		'type',
		'var'
	]),
	c: new Set([
		'auto',
		'break',
		'case',
		'char',
		'const',
		'continue',
		'default',
		'do',
		'double',
		'else',
		'enum',
		'extern',
		'float',
		'for',
		'goto',
		'if',
		'int',
		'long',
		'register',
		'return',
		'short',
		'signed',
		'sizeof',
		'static',
		'struct',
		'switch',
		'typedef',
		'union',
		'unsigned',
		'void',
		'volatile',
		'while'
	]),
	cpp: new Set([
		'alignas',
		'alignof',
		'and',
		'auto',
		'bool',
		'break',
		'case',
		'catch',
		'class',
		'const',
		'constexpr',
		'continue',
		'delete',
		'do',
		'double',
		'else',
		'enum',
		'explicit',
		'export',
		'extern',
		'false',
		'float',
		'for',
		'friend',
		'if',
		'inline',
		'int',
		'long',
		'mutable',
		'namespace',
		'new',
		'noexcept',
		'nullptr',
		'operator',
		'private',
		'protected',
		'public',
		'return',
		'short',
		'signed',
		'sizeof',
		'static',
		'struct',
		'switch',
		'template',
		'this',
		'throw',
		'true',
		'try',
		'typedef',
		'typename',
		'union',
		'unsigned',
		'using',
		'virtual',
		'void',
		'while'
	]),
	php: new Set([
		'abstract',
		'and',
		'array',
		'as',
		'break',
		'callable',
		'case',
		'catch',
		'class',
		'clone',
		'const',
		'continue',
		'declare',
		'default',
		'do',
		'echo',
		'else',
		'elseif',
		'empty',
		'enddeclare',
		'endfor',
		'endforeach',
		'endif',
		'endswitch',
		'endwhile',
		'extends',
		'final',
		'finally',
		'fn',
		'for',
		'foreach',
		'function',
		'global',
		'goto',
		'if',
		'implements',
		'include',
		'include_once',
		'instanceof',
		'interface',
		'match',
		'namespace',
		'new',
		'null',
		'or',
		'private',
		'protected',
		'public',
		'require',
		'require_once',
		'return',
		'static',
		'switch',
		'throw',
		'trait',
		'try',
		'use',
		'var',
		'while',
		'yield'
	]),
	rust: new Set([
		'as',
		'break',
		'const',
		'continue',
		'crate',
		'else',
		'enum',
		'extern',
		'false',
		'fn',
		'for',
		'if',
		'impl',
		'in',
		'let',
		'loop',
		'match',
		'mod',
		'move',
		'mut',
		'pub',
		'ref',
		'return',
		'self',
		'Self',
		'static',
		'struct',
		'super',
		'trait',
		'true',
		'type',
		'unsafe',
		'use',
		'where',
		'while'
	]),
	html: new Set([
		'html',
		'head',
		'body',
		'div',
		'span',
		'p',
		'a',
		'img',
		'video',
		'audio',
		'script',
		'style',
		'link',
		'meta',
		'form',
		'input',
		'button',
		'table',
		'tr',
		'td',
		'th',
		'ul',
		'ol',
		'li',
		'section',
		'article',
		'header',
		'footer',
		'nav',
		'main'
	]),
	bash: new Set([
		'if',
		'then',
		'else',
		'elif',
		'fi',
		'for',
		'while',
		'do',
		'done',
		'case',
		'esac',
		'function',
		'in',
		'select',
		'until',
		'break',
		'continue',
		'return',
		'export',
		'readonly',
		'local',
		'declare'
	])
}

const isIdentifierChar = (char: string, language: string): boolean => {
	if (language === 'css') {
		return /[a-zA-Z0-9_$-]/.test(char)
	}

	if (language === 'html') {
		return /[a-zA-Z0-9_$:-]/.test(char)
	}

	return /[a-zA-Z0-9_$]/.test(char)
}

const skipSpaces = (code: string, from: number): number => {
	let index = from

	while (index < code.length && /\s/.test(code[index] as string)) {
		index++
	}

	return index
}

/**
 * Splits source into the highlight spans WhatsApp's code block renders.
 *
 * Deliberately shallow: it tags strings, numbers, comments, keywords and call sites
 * with one linear pass, no grammar, so an unknown language still renders as plain code.
 */
export const tokenizeCode = (code: string, lang = 'javascript'): TokenizedCode => {
	const language = lang.toLowerCase()

	if (!language || PLAIN_LANGUAGES.includes(language)) {
		return {
			codeBlock: [{ codeContent: code, highlightType: HIGHLIGHT.DEFAULT }],
			unified_codeBlock: [{ content: code, type: 'DEFAULT' }]
		}
	}

	const keywords = KEYWORDS[language] || new Set<string>()
	const tokens: CodeBlock[] = []

	const push = (content: string, highlightType: number) => {
		if (!content) {
			return
		}

		const last = tokens[tokens.length - 1]

		if (last && last.highlightType === highlightType) {
			last.codeContent += content
		} else {
			tokens.push({ codeContent: content, highlightType })
		}
	}

	let i = 0

	while (i < code.length) {
		const char = code[i] as string

		if (/\s/.test(char)) {
			const start = i

			i = skipSpaces(code, i)

			push(code.slice(start, i), HIGHLIGHT.DEFAULT)
			continue
		}

		if ((char === '/' && code[i + 1] === '/') || (char === '#' && HASH_COMMENT_LANGUAGES.includes(language))) {
			const start = i

			while (i < code.length && code[i] !== '\n') {
				i++
			}

			push(code.slice(start, i), HIGHLIGHT.COMMENT)
			continue
		}

		if (char === '"' || char === "'" || char === '`') {
			const start = i

			i++

			while (i < code.length) {
				if (code[i] === '\\' && i + 1 < code.length) {
					i += 2
				} else if (code[i] === char) {
					i++
					break
				} else {
					i++
				}
			}

			push(code.slice(start, i), HIGHLIGHT.STR)
			continue
		}

		if (/[0-9]/.test(char)) {
			const start = i

			while (i < code.length && /[0-9._]/.test(code[i] as string)) {
				i++
			}

			push(code.slice(start, i), HIGHLIGHT.NUMBER)
			continue
		}

		if (/[a-zA-Z_$]/.test(char)) {
			const start = i

			while (i < code.length && isIdentifierChar(code[i] as string, language)) {
				i++
			}

			const word = code.slice(start, i)

			let type: number = HIGHLIGHT.DEFAULT

			if (keywords.has(word)) {
				type = HIGHLIGHT.KEYWORD
			} else if (language === 'css' && code[skipSpaces(code, i)] === ':') {
				type = HIGHLIGHT.KEYWORD
			} else if (language === 'html') {
				let previous = start - 1

				while (previous >= 0 && /\s/.test(code[previous] as string)) {
					previous--
				}

				if (code[previous] === '<' || (code[previous] === '/' && code[previous - 1] === '<')) {
					type = HIGHLIGHT.KEYWORD
				}
			}

			if (type === HIGHLIGHT.DEFAULT && code[skipSpaces(code, i)] === '(') {
				type = HIGHLIGHT.METHOD
			}

			push(word, type)
			continue
		}

		push(char, HIGHLIGHT.DEFAULT)
		i++
	}

	return {
		codeBlock: tokens,
		unified_codeBlock: tokens.map(token => ({
			content: token.codeContent,
			type: HIGHLIGHT_NAMES[token.highlightType] ?? 'DEFAULT'
		}))
	}
}
