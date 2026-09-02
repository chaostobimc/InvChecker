'use strict'

const log = require('./log')
const { flattenText } = require('./items')

/**
 * Optionales Backup: Der Bot horcht selbst im Serverchat / in den
 * Systemnachrichten nach "Gegner gefunden: <Name>".
 *
 * Die Mod ist immer der schnellere Weg (sie sieht die Nachricht lokal, ohne
 * Netzwerkumweg über einen zweiten Account), aber wenn der eigene Client die
 * Nachricht nicht bekommt – z. B. weil sie nur als [System]-Zeile im Log
 * landet – springt dieser Pfad ein.
 */
function attachTriggerListener (bot, cfg, scanner) {
  if (!cfg.trigger.enabled) return () => {}

  const regex = cfg.trigger.regex
  const seen = new Map()

  const check = (raw, source) => {
    const text = typeof raw === 'string' ? raw : flattenText(raw)
    if (!text || !/Gegner|invsee|Teleport/i.test(text)) return
    const m = regex.exec(text)
    if (!m) return
    const target = m[1]
    const now = Date.now()
    const last = seen.get(target.toLowerCase())
    if (last && now - last < cfg.trigger.dedupeWindowMs) return
    seen.set(target.toLowerCase(), now)
    if (seen.size > 64) seen.clear()
    log.info(`Trigger im Server${source} erkannt: ${target}`)
    scanner.request(target, { source: `server-${source}`, triggerAt: now })
  }

  // Normale Chatnachrichten (messagestr) und Systemnachrichten (message) abdecken.
  const onMessage = (message, _pos, json) => check(json ?? message?.toString?.() ?? message, 'chat')
  const onMessageStr = (message, _pos, _json, _sender) => check(message, 'chat')

  if (cfg.trigger.source === 'chat' || cfg.trigger.source === 'both') {
    bot.on('messagestr', onMessageStr)
    bot.on('message', onMessage)
  }
  if (cfg.trigger.source === 'raw' || cfg.trigger.source === 'both') {
    bot._client.on('system_chat', (packet) => check(packet.content, 'raw'))
    bot._client.on('chat', (packet) => check(packet.message ?? packet.unsignedChatContent ?? packet.plainMessage, 'raw'))
  }
  return () => {
    bot.off('messagestr', onMessageStr)
    bot.off('message', onMessage)
  }
}

module.exports = { attachTriggerListener }
