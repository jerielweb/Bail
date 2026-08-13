/**
 * Arranque optimizado para latencia de envío.
 *
 * La mayor parte del trabajo ya vive dentro de la librería en este fork, así que
 * este archivo es corto a propósito: solo queda lo que Baileys no puede decidir
 * por ti. Lo que cambió en la librería:
 *
 *   - Caché de metadata de grupos incorporada y activa por defecto, con
 *     invalidación en los eventos de grupo (src/Socket/messages-send.ts).
 *     Antes, cada envío a grupo pagaba un IQ completo antes de poder cifrar.
 *   - TTL de la caché de dispositivos subido a 1 hora (src/Defaults/index.ts).
 *   - `disableLinkPreviews` para saltarse el fetch bloqueante de previews.
 *
 * La media no necesita configuración: se cifra por trozos hacia un archivo temporal
 * y se sube en streaming desde disco, así que el tamaño lo limita el disco, no la
 * RAM. No la metas en un Buffer — eso la hace más lenta y le pone un techo.
 *
 * Piso que NO se puede bajar: 1 RTT hasta los servidores de WhatsApp más el
 * cifrado Signal por dispositivo destino.
 */
import NodeCache from '@cacheable/node-cache'
import P from 'pino'
import makeWASocket, {
	type CacheStore,
	DisconnectReason,
	makeCacheableSignalKeyStore,
	useMultiFileAuthState
} from '../src'

/**
 * `sendNode` serializa el stanza completo a XML con `binaryNodeToString()` en cada
 * envío cuando el nivel es 'trace' (src/Socket/socket.ts). El example.ts oficial
 * arranca en 'trace' con pino-pretty y escritura a archivo: tres costes por mensaje
 * que no quieres en producción.
 */
const logger = P({ level: 'warn' })

/** Evita reintentos de descifrado en bucle entre reinicios del socket. */
const msgRetryCounterCache = new NodeCache() as CacheStore

export const startFastSock = async () => {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')

	const sock = makeWASocket({
		logger,
		auth: {
			creds: state.creds,
			/**
			 * Sin este wrapper, cada cifrado lee las claves Signal desde disco: en un
			 * envío a un contacto con cuatro dispositivos son varias lecturas de archivo
			 * por mensaje.
			 *
			 * `useMultiFileAuthState` es solo para pruebas. En producción, pon una base
			 * de datos real detrás de esta misma interfaz.
			 */
			keys: makeCacheableSignalKeyStore(state.keys, logger)
		},

		msgRetryCounterCache,

		/**
		 * Cualquier texto con una URL dispara un fetch HTTP bloqueante (3s de timeout,
		 * hasta 5 redirecciones) dentro de `generateWAMessage`. Con
		 * `generateHighQualityLinkPreview` además sube una miniatura antes de mandar
		 * el texto.
		 *
		 * Ponlo en false si prefieres los previews y puedes pagar la espera.
		 */
		disableLinkPreviews: true,

		/**
		 * Evita que el volcado de historial compita por el socket justo cuando quieres
		 * enviar tus primeros mensajes.
		 *
		 * OJO: esto no es lo mismo que desactivar `shouldSyncHistoryMessage` por
		 * completo. Deja el default de esa función — si bloqueas todos los tipos de
		 * sync, Baileys pierde los mapeos LID iniciales y la sesión se vuelve inestable.
		 */
		syncFullHistory: false,

		getMessage: async () => undefined

		/**
		 * NO pases `cachedGroupMetadata` aquí a menos que quieras gestionar la caché tú.
		 * Pasarla desactiva la caché interna: la librería asume que si traes la tuya,
		 * mandas tú, incluida la invalidación. Omitirla es lo rápido y lo correcto.
		 */
	})

	sock.ev.on('creds.update', saveCreds)

	sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
		if (connection === 'close') {
			const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut
			if (shouldReconnect) startFastSock()
		}
	})

	return sock
}

type FastSock = Awaited<ReturnType<typeof startFastSock>>

/**
 * El primer mensaje a un JID nuevo paga dos round trips extra: enumerar sus
 * dispositivos (USync) y descargar sus prekeys para abrir la sesión Signal.
 *
 * Si sabes a quién vas a escribir, llama a esto al arrancar y esos dos round trips
 * desaparecen del primer envío.
 */
export const prewarm = async (sock: FastSock, jids: string[]) => {
	const devices = await sock.getUSyncDevices(jids, true, false)
	await sock.assertSessions(devices.map(d => d.jid))
}

/**
 * `sendMessage` resuelve cuando el stanza se ha escrito en el socket, no cuando el
 * destinatario lo recibe. Esto mide exactamente lo que tú controlas.
 *
 * Compara el primer envío a un JID contra el segundo para ver en tu propia red
 * cuánto te cuestan los round trips de dispositivos y sesión.
 */
export const timedSend = async (sock: FastSock, jid: string, text: string) => {
	const start = process.hrtime.bigint()
	const msg = await sock.sendMessage(jid, { text })
	const ms = Number(process.hrtime.bigint() - start) / 1e6
	console.log(`envío a ${jid}: ${ms.toFixed(1)} ms`)
	return msg
}
