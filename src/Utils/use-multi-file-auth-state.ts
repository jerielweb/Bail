import Database from 'better-sqlite3';
import { proto } from '../../WAProto/index.js';
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '../Types';
import { initAuthCreds } from './auth-utils';
import { BufferJSON } from './generics';

export const useSQLiteAuthState = (
	dbPath: string = './session.db'
): { state: AuthenticationState;saveCreds: () => void } => {
	const db = new Database(dbPath);
	
	// Crear la tabla para guardar las credenciales y llaves
	db.prepare(`
        CREATE TABLE IF NOT EXISTS auth_store (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `).run();
	
	const readData = (key: string) => {
		try {
			const row = db.prepare('SELECT value FROM auth_store WHERE key = ?').get(key) as { value: string } | undefined;
			if (!row) return null;
			return JSON.parse(row.value, BufferJSON.reviver);
		} catch (error) {
			return null;
		}
	};
	
	const writeData = (key: string, data: any) => {
		try {
			const jsonString = JSON.stringify(data, BufferJSON.replacer);
			db.prepare(`
                INSERT INTO auth_store (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = ?
            `).run(key, jsonString, jsonString);
		} catch (error) {
			console.error(`Error saving key ${key}:`, error);
		}
	};
	
	const removeData = (key: string) => {
		try {
			db.prepare('DELETE FROM auth_store WHERE key = ?').run(key);
		} catch (error) {
			console.error(`Error removing key ${key}:`, error);
		}
	};
	
	const creds: AuthenticationCreds = readData('creds') || initAuthCreds();
	
	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const data: {
						[_: string]: SignalDataTypeMap[typeof type] } = {};
					for (const id of ids) {
						let value = readData(`${type}-${id}`);
						if (type === 'app-state-sync-key' && value) {
							value = proto.Message.AppStateSyncKeyData.fromObject(value);
						}
						data[id] = value;
					}
					return data;
				},
				set: async data => {
					for (const category in data) {
						for (const id in data[category as keyof SignalDataTypeMap]) {
							const value = data[category as keyof SignalDataTypeMap] ![id];
							const key = `${category}-${id}`;
							if (value) {
								writeData(key, value);
							} else {
								removeData(key);
							}
						}
					}
				}
			}
		},
		saveCreds: () => {
			writeData('creds', creds);
		}
	};
};