import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseMoovBox, readMp4Metadata } from '../../Utils/video-metadata'

const FIXED_ONE = 0x00010000

const box = (type: string, payload: Buffer) => {
	const header = Buffer.alloc(8)
	header.writeUInt32BE(payload.length + 8, 0)
	header.write(type, 4, 'latin1')
	return Buffer.concat([header, payload])
}

/** version 0 movie header: creation(4) modification(4) timescale(4) duration(4) */
const mvhd = (timescale: number, duration: number) => {
	const payload = Buffer.alloc(20)
	payload.writeUInt32BE(timescale, 12)
	payload.writeUInt32BE(duration, 16)
	return box('mvhd', payload)
}

type Rotation = 0 | 90

/** version 0 track header, dimensions stored as 16.16 fixed point after the matrix */
const tkhd = (width: number, height: number, rotation: Rotation = 0) => {
	const payload = Buffer.alloc(84)

	if (rotation === 90) {
		payload.writeInt32BE(0, 40) // a
		payload.writeInt32BE(FIXED_ONE, 44) // b
		payload.writeInt32BE(-FIXED_ONE, 52) // c
		payload.writeInt32BE(0, 56) // d
	} else {
		payload.writeInt32BE(FIXED_ONE, 40) // a
		payload.writeInt32BE(FIXED_ONE, 56) // d
	}

	payload.writeUInt32BE(width * FIXED_ONE, 76)
	payload.writeUInt32BE(height * FIXED_ONE, 80)
	return box('tkhd', payload)
}

const trak = (track: Buffer) => box('trak', track)

describe('parseMoovBox', () => {
	it('reads duration in seconds from the movie header timescale', () => {
		const moov = Buffer.concat([mvhd(1000, 7500), trak(tkhd(1280, 720))])

		expect(parseMoovBox(moov).seconds).toBe(8)
	})

	it('reads display dimensions from the track header', () => {
		const moov = Buffer.concat([mvhd(600, 1200), trak(tkhd(1920, 1080))])

		expect(parseMoovBox(moov)).toEqual({ seconds: 2, width: 1920, height: 1080 })
	})

	it('swaps dimensions when the track matrix encodes a 90 degree rotation', () => {
		const moov = Buffer.concat([mvhd(1000, 1000), trak(tkhd(1920, 1080, 90))])

		expect(parseMoovBox(moov)).toMatchObject({ width: 1080, height: 1920 })
	})

	it('ignores an audio track and uses the track that carries dimensions', () => {
		const moov = Buffer.concat([mvhd(1000, 3000), trak(tkhd(0, 0)), trak(tkhd(640, 480))])

		expect(parseMoovBox(moov)).toMatchObject({ width: 640, height: 480 })
	})

	it('returns nothing for a duration the container marks as unknown', () => {
		const moov = Buffer.concat([mvhd(1000, 0xffffffff), trak(tkhd(640, 480))])

		expect(parseMoovBox(moov).seconds).toBeUndefined()
	})

	it('returns nothing rather than throwing on a truncated box', () => {
		const moov = Buffer.concat([mvhd(1000, 5000)]).subarray(0, 12)

		expect(() => parseMoovBox(moov)).not.toThrow()
		expect(parseMoovBox(moov)).toEqual({})
	})

	it('returns nothing rather than throwing on bytes that are not boxes', () => {
		expect(parseMoovBox(Buffer.from('this is definitely not an mp4 file'))).toEqual({})
	})
})

describe('readMp4Metadata', () => {
	const written: string[] = []

	const writeTempFile = async (contents: Buffer) => {
		const path = join(tmpdir(), `baileys-video-metadata-${written.length}-${process.pid}.mp4`)
		await fs.writeFile(path, contents)
		written.push(path)
		return path
	}

	afterAll(async () => {
		await Promise.all(written.map(path => fs.unlink(path).catch(() => {})))
	})

	it('finds the moov box when it follows the media data', async () => {
		const moov = box('moov', Buffer.concat([mvhd(1000, 4000), trak(tkhd(720, 1280))]))
		const file = Buffer.concat([box('ftyp', Buffer.alloc(16)), box('mdat', Buffer.alloc(2048)), moov])

		await expect(readMp4Metadata(await writeTempFile(file))).resolves.toEqual({
			seconds: 4,
			width: 720,
			height: 1280
		})
	})

	it('returns undefined for a file with no moov box', async () => {
		const file = Buffer.concat([box('ftyp', Buffer.alloc(16)), box('mdat', Buffer.alloc(64))])

		await expect(readMp4Metadata(await writeTempFile(file))).resolves.toBeUndefined()
	})

	it('returns undefined for a file that does not exist', async () => {
		await expect(readMp4Metadata(join(tmpdir(), 'baileys-no-such-video.mp4'))).resolves.toBeUndefined()
	})
})
