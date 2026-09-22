import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { proto } from '../../WAProto/index.js';
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '../Types';
import { initAuthCreds } from './auth-utils.js';
import { BufferJSON } from './generics.js';

export const useMultiFileAuthState = (
	folder: string = 'auth_info_baileys'
): { state: AuthenticationState; saveCreds: () => Promise<void>; close: () => void } => {
	const folderPath = path.resolve(folder);
	if (!fs.existsSync(folderPath)) {
		fs.mkdirSync(folderPath, { recursive: true });
	}

	const dbPath = path.join(folderPath, 'session.db');
	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	db.pragma('synchronous = NORMAL');
	db.pragma('foreign_keys = ON');

	const close = () => {
		if (db.open) {
			db.close();
		}
	};

	db.prepare(`
		CREATE TABLE IF NOT EXISTS auth_store (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`).run();

	const getStmt = db.prepare('SELECT key, value FROM auth_store WHERE key = ?');
	const getManyStmt = (keys: string[]) => {
		if (keys.length === 0) return [] as Array<{ key: string; value: string }>;
		const placeholders = keys.map(() => '?').join(', ');
		return db.prepare(`SELECT key, value FROM auth_store WHERE key IN (${placeholders})`).all(...keys) as Array<{ key: string; value: string }>;
	};
	const upsertStmt = db.prepare(`
		INSERT INTO auth_store (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`);
	const deleteStmt = db.prepare('DELETE FROM auth_store WHERE key = ?');
	const writeBatch = db.transaction((entries: Array<[string, unknown]>) => {
		for (const [key, value] of entries) {
			const jsonString = JSON.stringify(value, BufferJSON.replacer);
			upsertStmt.run(key, jsonString);
		}
	});
	const deleteBatch = db.transaction((keys: string[]) => {
		for (const key of keys) {
			deleteStmt.run(key);
		}
	});

	const readData = (key: string): unknown | null => {
		try {
			const row = getStmt.get(key) as { key: string; value: string } | undefined;
			if (!row) return null;
			return JSON.parse(row.value, BufferJSON.reviver);
		} catch {
			return null;
		}
	};

	const readManyData = (keys: string[]): Record<string, unknown> => {
		const map: Record<string, unknown> = {};
		if (keys.length === 0) return map;

		for (const row of getManyStmt(keys)) {
			try {
				map[row.key] = JSON.parse(row.value, BufferJSON.reviver);
			} catch {
				map[row.key] = null;
			}
		}
		return map;
	};

	const writeData = (key: string, data: unknown) => {
		try {
			writeBatch([[key, data]]);
		} catch (error) {
			console.error(`Error saving key ${key}:`, error);
		}
	};

	const removeData = (key: string) => {
		try {
			deleteStmt.run(key);
		} catch (error) {
			console.error(`Error removing key ${key}:`, error);
		}
	};

	const creds: AuthenticationCreds = (readData('creds') as AuthenticationCreds | null) ?? initAuthCreds();

	return {
		state: {
			creds,
			keys: {
				get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
					const data = {} as Record<string, SignalDataTypeMap[T]>;
					const stored = readManyData(ids.map(id => `${type}-${id}`));

					for (const id of ids) {
						const key = `${type}-${id}`;
						const rawValue = stored[key] as SignalDataTypeMap[T] | undefined;

						if (type === 'app-state-sync-key') {
							const value = rawValue as SignalDataTypeMap['app-state-sync-key'] | undefined;
							data[id] = (value
								? proto.Message.AppStateSyncKeyData.fromObject(value as object)
								: undefined) as unknown as SignalDataTypeMap[T];
							continue;
						}

						data[id] = rawValue as unknown as SignalDataTypeMap[T];
					}

					return data;
				},
				set: async data => {
					const writes: Array<[string, unknown]> = [];
					const removals: string[] = [];

					for (const category in data) {
						const categoryData = data[category as keyof SignalDataTypeMap] ?? {};
						for (const id in categoryData) {
							const value = categoryData[id];
							const key = `${category}-${id}`;
							if (value) {
								writes.push([key, value]);
							} else {
								removals.push(key);
							}
						}
					}

					if (writes.length > 0) {
						writeBatch(writes);
					}
					if (removals.length > 0) {
						deleteBatch(removals);
					}
				}
			}
		},
		saveCreds: async () => {
			writeData('creds', creds);
		},
		close,
	};
};
