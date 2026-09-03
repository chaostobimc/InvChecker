'use strict'

const crypto = require('node:crypto')
const log = require('./log')

/**
 * Server-Ressourcenpakete in der Configuration-Phase vollstaendig beantworten.
 *
 * Warum das noetig ist: minecraft-protocol behandelt in der Configuration-Phase
 * login_acknowledged, settings, select_known_packs, code_of_conduct und
 * finish_configuration (src/client/play.js) – aber NICHT add_resource_pack.
 * mineflayers lib/plugins/resource_pack.js emittiert zu dem Paket lediglich das
 * Event 'resourcePack' und schreibt von sich aus nichts.
 *
 * hugosmp.net schickt aber ein erzwungenes Paket von cdn.hugosmp.net und wartet
 * auf die Antwort, bevor es finish_configuration schickt. Ohne vollstaendige
 * Antwort bleibt der Client fuer immer im Zustand 'configuration', erreicht nie
 * 'play', und scanner.isReady() lehnt jeden Trigger als "nicht eingeloggt" ab.
 *
 * mineflayers acceptResourcePack() sendet nur ACCEPTED(3) und
 * SUCCESSFULLY_LOADED(0). Der Vanilla-Client sendet dazwischen noch
 * DOWNLOADED(4) – und zwar erst, nachdem er das Paket tatsaechlich geladen hat.
 * Dieser Handler bildet genau diese Reihenfolge nach.
 */

/** Statuswerte laut wiki.vg, "Resource Pack Response (configuration)". */
const RESULT = {
  SUCCESSFULLY_LOADED: 0,
  DECLINED: 1,
  FAILED_DOWNLOAD: 2,
  ACCEPTED: 3,
  DOWNLOADED: 4,
  INVALID_URL: 5,
  FAILED_RELOAD: 6,
  DISCARDED: 7
}

const DOWNLOAD_TIMEOUT_MS = 120000
const MAX_BYTES = 1024 * 1024 * 1024 // 1 GiB – Sicherheitsnetz, kein reales Limit

function uuidToString (uuid) {
  if (!uuid) return undefined
  if (typeof uuid === 'string') return uuid
  if (typeof uuid === 'object') {
    if (typeof uuid.ascii === 'string') return uuid.ascii     // uuid-1345
    if (typeof uuid.toString === 'function') return uuid.toString()
  }
  return undefined
}

/** Schreibt resource_pack_receive; UUID-lose Aeltere-Versionen ohne uuid-Feld. */
function sendResult (bot, uuid, result) {
  const params = uuid ? { uuid, result } : { result }
  bot._client.write('resource_pack_receive', params)
}

/** Laedt die URL und liefert SHA-1 + Groesse. Haelt nichts im Speicher. */
async function downloadAndHash (url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim())
    if (!res.body) throw new Error('Antwort ohne Body')
    const hash = crypto.createHash('sha1')
    let bytes = 0
    for await (const chunk of res.body) {
      bytes += chunk.length
      if (bytes > MAX_BYTES) throw new Error(`groesser als ${MAX_BYTES} Bytes`)
      hash.update(chunk)
    }
    return { sha1: hash.digest('hex'), bytes }
  } finally {
    clearTimeout(timer)
  }
}

function attachResourcePackHandler (bot, options = {}) {
  const timeoutMs = options.timeoutMs || DOWNLOAD_TIMEOUT_MS

  async function handle (uuid, url, expectedHash, forced) {
    const label = `Ressourcenpaket${forced ? ' (erzwungen)' : ''}`
    if (!url) {
      log.warn(`${label} ohne URL bekommen – kann nichts laden.`)
      try { sendResult(bot, uuid, RESULT.INVALID_URL) } catch { /* egal */ }
      return
    }

    // 1) Sofort annehmen, wie der Vanilla-Client vor dem Download.
    try {
      sendResult(bot, uuid, RESULT.ACCEPTED)
    } catch (err) {
      log.warn(`${label}: ACCEPTED konnte nicht gesendet werden: ${err.message}`)
      return
    }
    log.info(`${label}: ${url}`)

    try {
      // 2) Wirklich laden – die Reihenfolge und die Dauer sind das, woran sich
      //    Server/Proxy orientieren koennen.
      const started = Date.now()
      const { sha1, bytes } = await downloadAndHash(url, timeoutMs)

      const expected = String(expectedHash || '').toLowerCase().trim()
      if (expected && sha1 !== expected) {
        throw new Error(`SHA-1 stimmt nicht (erwartet ${expected}, bekommen ${sha1})`)
      }
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      log.ok(`${label} geladen: ${(bytes / 1024 / 1024).toFixed(1)} MiB in ${secs} s, SHA-1 ${sha1.slice(0, 12)}…`)

      // 3) DOWNLOADED, dann SUCCESSFULLY_LOADED – exakt die Vanilla-Reihenfolge.
      sendResult(bot, uuid, RESULT.DOWNLOADED)
      sendResult(bot, uuid, RESULT.SUCCESSFULLY_LOADED)
      log.ok(`${label}: Status DOWNLOADED + SUCCESSFULLY_LOADED gemeldet.`)
    } catch (err) {
      // Lieber eine sichtbare Reaktion als endloses Schweigen: FAILED_DOWNLOAD
      // fuehrt bei einem erzwungenen Paket zu einem Kick mit Grund.
      log.warn(`${label} konnte nicht geladen werden: ${err.message}`)
      try {
        sendResult(bot, uuid, RESULT.FAILED_DOWNLOAD)
      } catch (err2) {
        log.warn(`${label}: FAILED_DOWNLOAD konnte nicht gesendet werden: ${err2.message}`)
      }
    }
  }

  // Moderner Weg (1.20.2+): Paket in der Configuration-Phase, UUID als String.
  bot._client.on('add_resource_pack', (data) => {
    handle(uuidToString(data.uuid), data.url, data.hash, data.forced).catch((err) => {
      log.error(`Ressourcenpaket-Handler abgestuerzt: ${err.message}`)
    })
  })

  // Alter Weg (vor 1.20.2): Paket in der Play-Phase, teils nur mit Hash.
  bot._client.on('resource_pack_send', (data) => {
    const uuid = bot.supportFeature('resourcePackUsesUUID') ? uuidToString(data.uuid) : undefined
    handle(uuid, data.url, data.hash, data.forced).catch((err) => {
      log.error(`Ressourcenpaket-Handler abgestuerzt: ${err.message}`)
    })
  })

  return { handle, RESULT }
}

/**
 * Beobachtet die Configuration-Phase und sagt laut, wenn der Bot dort
 * haengen bleibt. Schweigen war bisher der teuerste Teil der Fehlersuche.
 */
function watchConfigurationPhase (bot, options = {}) {
  const warnAfterMs = options.warnAfterMs || 20000
  const timer = setTimeout(() => {
    const state = bot._client?.state
    if (state && state !== 'play') {
      log.warn(`Bot haengt seit ${Math.round(warnAfterMs / 1000)} s im Zustand "${state}" – ` +
        'der Server hat die Configuration-Phase nicht abgeschlossen (kein finish_configuration).')
    }
  }, warnAfterMs)
  // Der Timer darf den Prozess nicht am Beenden hindern.
  if (typeof timer.unref === 'function') timer.unref()
  bot.once('spawn', () => clearTimeout(timer))
  bot.once('end', () => clearTimeout(timer))
  return timer
}

module.exports = { attachResourcePackHandler, watchConfigurationPhase, RESULT }
