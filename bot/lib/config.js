'use strict'

const fs = require('node:fs')
const path = require('node:path')
const log = require('./log')

const DEFAULTS = {
  server: { host: 'hugosmp.net', port: 25565, version: false },  // false = per Ping erkennen
  auth: { mode: 'microsoft', username: '', cacheDir: '.auth-cache' },
  bot: {
    brand: 'InvChecker',
    hideErrors: false,
    physicsEnabled: false,
    viewDistance: 'tiny',
    autoReconnect: true,
    reconnectDelayMs: 2000,
    reconnectMaxDelayMs: 30000,
    keepAlive: true,
    checkTimeoutInterval: 60000
  },
  invsee: {
    command: '/invsee {player}',
    windowTimeoutMs: 2500,
    closeWindowAfterScan: true,
    ignoreOwnInventory: true,
    slots: { inventory: [0, 35], armor: [39, 42], offhand: [43, 43] },
    ignoreItems: ['minecraft:barrier']
  },
  trigger: {
    enabled: false,
    pattern: 'Gegner gefunden:\\s*([A-Za-z0-9_]{1,16})',
    dedupeWindowMs: 1500,
    source: 'chat'
  },
  scan: { dedupeWindowMs: 800, minIntervalMs: 150, queueSize: 2 },
  response: {
    sayResultInChat: false,
    template: '{target}: {summary}',
    whisperTemplate: '/msg {player} {target}: {summary}'
  },
  net: { host: '0.0.0.0', port: 2895, token: 'invchecker-change-me', maxConnections: 8, logTraffic: false }
}

function isPlainObject (v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Rekursives Mergen; Arrays werden ersetzt, nicht zusammengeführt. */
function merge (base, override) {
  const out = Array.isArray(base) ? base.slice() : { ...base }
  if (!isPlainObject(override)) return out
  for (const [k, v] of Object.entries(override)) {
    if (k.startsWith('_')) continue // Kommentar-Felder aus config.json überspringen
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = merge(out[k], v)
    else out[k] = v
  }
  return out
}

function load (file) {
  const configFile = file || path.join(__dirname, '..', 'config.json')
  let raw = {}
  if (fs.existsSync(configFile)) {
    try {
      raw = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    } catch (err) {
      log.error(`config.json ist kein gültiges JSON (${err.message}) – Defaults werden benutzt.`)
    }
  } else {
    log.warn(`Keine config.json unter ${configFile} gefunden – Defaults werden benutzt.`)
  }
  const cfg = merge(DEFAULTS, raw)
  // Slots in [von, bis] normalisieren (Reihenfolge ist egal)
  for (const key of ['inventory', 'armor', 'offhand']) {
    const range = cfg.invsee.slots[key]
    if (Array.isArray(range) && range.length === 2) {
      cfg.invsee.slots[key] = [Math.min(range[0], range[1]), Math.max(range[0], range[1])]
    }
  }
  cfg.invsee.ignoreItems = new Set((cfg.invsee.ignoreItems || []).map((s) => String(s).toLowerCase()))
  cfg.trigger.regex = new RegExp(cfg.trigger.pattern, 'i')
  return cfg
}

module.exports = { load, merge, DEFAULTS }
