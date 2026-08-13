import { exec } from 'child_process'
import { promises as fs } from 'fs'
import type { ILogger } from './logger'

export type VideoMetadata = {
	/** duration in whole seconds, as WhatsApp expects it on videoMessage.seconds */
	seconds?: number
	width?: number
	height?: number
}

/** ISO-BMFF fixed-point 16.16 values store 1.0 as 65536. */
const FIXED_16_16 = 65536

/** A box is at minimum a 32-bit size plus a 4-character type. */
const BOX_HEADER_SIZE = 8

/**
 * Walks the ISO-BMFF boxes laid out in `buf` between [start, end) and hands each
 * one to `onBox` as its type plus the bounds of its payload.
 *
 * Stops rather than throwing on a malformed length: these buffers come from user
 * files, and a truncated or non-MP4 input should degrade to "no metadata", never
 * take down the send.
 */
const forEachBox = (
	buf: Buffer,
	start: number,
	end: number,
	onBox: (type: string, payloadStart: number, payloadEnd: number) => void
) => {
	let offset = start

	while (offset + BOX_HEADER_SIZE <= end) {
		let size = buf.readUInt32BE(offset)
		const type = buf.toString('latin1', offset + 4, offset + 8)
		let headerSize = BOX_HEADER_SIZE

		if (size === 1) {
			// size === 1 means the real size is a 64-bit value following the type
			if (offset + 16 > end) return
			const largeSize = buf.readBigUInt64BE(offset + 8)
			if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return
			size = Number(largeSize)
			headerSize = 16
		} else if (size === 0) {
			// size === 0 means the box runs to the end of its container
			size = end - offset
		}

		if (size < headerSize || offset + size > end) return

		onBox(type, offset + headerSize, offset + size)
		offset += size
	}
}

/** Movie header: carries the timescale and duration for the file as a whole. */
const parseMvhd = (buf: Buffer, start: number, end: number): number | undefined => {
	if (start + 4 > end) return undefined

	const version = buf.readUInt8(start)
	// both layouts begin with a 1-byte version and 3 flag bytes
	const fields = start + 4

	let timescale: number
	let duration: number

	if (version === 1) {
		// creation(8) modification(8) timescale(4) duration(8)
		if (fields + 28 > end) return undefined
		timescale = buf.readUInt32BE(fields + 16)
		const rawDuration = buf.readBigUInt64BE(fields + 20)
		if (rawDuration > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
		duration = Number(rawDuration)
	} else {
		// creation(4) modification(4) timescale(4) duration(4)
		if (fields + 16 > end) return undefined
		timescale = buf.readUInt32BE(fields + 8)
		duration = buf.readUInt32BE(fields + 12)
	}

	if (!timescale || !duration) return undefined

	// 0xffffffff is the conventional "unknown duration" marker
	if (version === 0 && duration === 0xffffffff) return undefined

	return duration / timescale
}

/**
 * Track header: carries the display dimensions.
 *
 * The dimensions live before the transformation matrix, so a phone video recorded
 * in portrait reports landscape numbers plus a 90° rotation. Ignoring the matrix
 * is what makes portrait videos show up stretched, so the rotation is applied here.
 */
const parseTkhd = (buf: Buffer, start: number, end: number): { width: number; height: number } | undefined => {
	if (start + 4 > end) return undefined

	const version = buf.readUInt8(start)
	const fields = start + 4
	// v0 packs creation/modification/duration as 32-bit, v1 as 64-bit
	const afterDuration = fields + (version === 1 ? 32 : 20)
	const matrixStart = afterDuration + 16
	const dimensionsStart = matrixStart + 36

	if (dimensionsStart + 8 > end) return undefined

	let width = buf.readUInt32BE(dimensionsStart) / FIXED_16_16
	let height = buf.readUInt32BE(dimensionsStart + 4) / FIXED_16_16

	if (!width || !height) return undefined

	// matrix is {a, b, u, c, d, v, x, y, w}; a pure 90°/270° rotation zeroes a and d
	const a = buf.readInt32BE(matrixStart)
	const b = buf.readInt32BE(matrixStart + 4)
	const c = buf.readInt32BE(matrixStart + 12)
	const d = buf.readInt32BE(matrixStart + 16)

	if (a === 0 && d === 0 && b !== 0 && c !== 0) {
		;[width, height] = [height, width]
	}

	return { width: Math.round(width), height: Math.round(height) }
}

/** Reads duration and dimensions out of an already-loaded `moov` box. */
export const parseMoovBox = (moov: Buffer): VideoMetadata => {
	const result: VideoMetadata = {}

	forEachBox(moov, 0, moov.length, (type, start, end) => {
		if (type === 'mvhd') {
			const durationSec = parseMvhd(moov, start, end)
			if (durationSec !== undefined) {
				result.seconds = Math.round(durationSec)
			}

			return
		}

		if (type !== 'trak' || result.width) return

		forEachBox(moov, start, end, (trakChild, trakStart, trakEnd) => {
			// audio tracks carry a tkhd too, but with zeroed dimensions
			if (trakChild !== 'tkhd' || result.width) return

			const dimensions = parseTkhd(moov, trakStart, trakEnd)
			if (dimensions) {
				result.width = dimensions.width
				result.height = dimensions.height
			}
		})
	})

	return result
}

/**
 * Pulls video metadata straight out of the container, without ffmpeg.
 *
 * Only the `moov` box is read into memory — walking the top-level boxes by their
 * declared sizes means a multi-gigabyte video costs a handful of small reads,
 * which matters because this sits on the send path.
 *
 * Covers MP4/MOV/M4V. Other containers return nothing and fall through to ffprobe.
 */
export const readMp4Metadata = async (path: string): Promise<VideoMetadata | undefined> => {
	let handle: fs.FileHandle | undefined

	try {
		handle = await fs.open(path, 'r')
		const { size: fileSize } = await handle.stat()

		let offset = 0
		const header = Buffer.alloc(16)

		while (offset + BOX_HEADER_SIZE <= fileSize) {
			const { bytesRead } = await handle.read(header, 0, 16, offset)
			if (bytesRead < BOX_HEADER_SIZE) return undefined

			let size = header.readUInt32BE(0)
			const type = header.toString('latin1', 4, 8)
			let headerSize = BOX_HEADER_SIZE

			if (size === 1) {
				if (bytesRead < 16) return undefined
				const largeSize = header.readBigUInt64BE(8)
				if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
				size = Number(largeSize)
				headerSize = 16
			} else if (size === 0) {
				size = fileSize - offset
			}

			if (size < headerSize || offset + size > fileSize) return undefined

			if (type === 'moov') {
				const moov = Buffer.alloc(size - headerSize)
				await handle.read(moov, 0, moov.length, offset + headerSize)
				return parseMoovBox(moov)
			}

			offset += size
		}

		return undefined
	} catch {
		return undefined
	} finally {
		await handle?.close().catch(() => {})
	}
}

/** Runs ffprobe for containers the MP4 reader does not understand (webm, mkv, avi). */
const readMetadataWithFfprobe = async (path: string): Promise<VideoMetadata | undefined> =>
	new Promise(resolve => {
		const cmd = `ffprobe -v error -select_streams v:0 -show_entries format=duration:stream=width,height -of json "${path}"`

		exec(cmd, (err, stdout) => {
			if (err) return resolve(undefined)

			try {
				const parsed = JSON.parse(stdout)
				const stream = parsed?.streams?.[0]
				const duration = Number(parsed?.format?.duration)
				const result: VideoMetadata = {}

				if (Number.isFinite(duration) && duration > 0) {
					result.seconds = Math.round(duration)
				}

				if (stream?.width && stream?.height) {
					result.width = stream.width
					result.height = stream.height
				}

				resolve(result)
			} catch {
				resolve(undefined)
			}
		})
	})

/**
 * Best-effort duration and dimensions for a video file.
 *
 * Tries the in-process MP4 reader first: it needs no external binary and covers
 * what WhatsApp clients actually produce. ffprobe is only consulted for the gaps.
 */
export const getVideoMetadata = async (path: string, logger?: ILogger): Promise<VideoMetadata> => {
	const fromContainer = await readMp4Metadata(path)
	if (fromContainer?.seconds && fromContainer.width) {
		return fromContainer
	}

	const fromFfprobe = await readMetadataWithFfprobe(path)
	if (!fromFfprobe && !fromContainer) {
		logger?.debug({ path }, 'could not read video metadata; not an MP4 and ffprobe unavailable')
	}

	return { ...fromContainer, ...fromFfprobe }
}
