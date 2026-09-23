import { createRequire } from 'module'
import { proto } from '../../WAProto/index.js'
import type { AuthenticationCreds, AuthenticationState, SignalDataSet, SignalDataTypeMap } from '../Types'
import { initAuthCreds } from './auth-utils'
import { BufferJSON } from './generics'

type SqliteStatement = {
	pluck(): SqliteStatement
	get(id: string): string | Buffer | undefined
	run(id: string, data?: string | Uint8Array): void
}

type SqliteDatabase = {
	exec(sql: string): void
	prepare(sql: string): SqliteStatement
	transaction(fn: (data: SignalDataSet) => void): (data: SignalDataSet) => void
	close(): void
}

const CREDS_ID = 'creds'

export const useSQLiteAuthState = (
	path: string
): { state: AuthenticationState; saveCreds: () => void; close: () => void } => {
	const require = createRequire(import.meta.url)
	const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
	const db = new Database(path)

	db.exec(
		'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; CREATE TABLE IF NOT EXISTS auth (id TEXT PRIMARY KEY, data BLOB NOT NULL) WITHOUT ROWID'
	)

	const selectStmt = db.prepare('SELECT data FROM auth WHERE id = ?').pluck()
	const upsertStmt = db.prepare(
		'INSERT INTO auth (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
	)
	const deleteStmt = db.prepare('DELETE FROM auth WHERE id = ?')

	const read = (id: string): unknown => {
		const data = selectStmt.get(id)
		return typeof data === 'string' ? JSON.parse(data, BufferJSON.reviver) : data
	}

	const write = (id: string, value: unknown) => {
		upsertStmt.run(id, value instanceof Uint8Array ? value : JSON.stringify(value, BufferJSON.replacer))
	}

	const commit = db.transaction((data: SignalDataSet) => {
		for (const type in data) {
			const category = data[type as keyof SignalDataTypeMap]!
			for (const id in category) {
				const value = category[id]
				if (value) {
					write(`${type}-${id}`, value)
				} else {
					deleteStmt.run(`${type}-${id}`)
				}
			}
		}
	})

	const creds = (read(CREDS_ID) as AuthenticationCreds | undefined) || initAuthCreds()

	return {
		state: {
			creds,
			keys: {
				get: (type, ids) => {
					const data: Record<string, unknown> = {}
					for (const id of ids) {
						const value = read(`${type}-${id}`)
						if (value === undefined) {
							continue
						}

						data[id] =
							type === 'app-state-sync-key'
								? proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>)
								: value
					}

					return data as { [id: string]: SignalDataTypeMap[typeof type] }
				},
				set: data => commit(data)
			}
		},
		saveCreds: () => write(CREDS_ID, creds),
		close: () => db.close()
	}
}
