'use strict'

const { serializeItem, flattenText } = require('./items')
const log = require('./log')

const inRange = (slot, range) => Array.isArray(range) && slot >= range[0] && slot <= range[1]

/**
 * Kapselt den kompletten /invsee-Durchlauf:
 *   Befehl senden -> Fenster abwarten -> Slots lesen -> Ergebnis bauen -> schließen
 *
 * Der Scan selbst ist synchron: mineflayer hält die Fenster-Slots bereits im
 * Speicher, es geht kein einziges Paket an den Server. Der Bot wartet nur auf
 * das 'windowOpen'-Event – mineflayer feuert das erst, sobald die Slot-Daten
 * da sind, also ist das der frühestmögliche, vollständige Zeitpunkt.
 */
function createScanner (bot, cfg) {
  const { invsee, scan } = cfg
  const pending = []
  let lastScanAt = 0
  const lastByTarget = new Map()
  let idCounter = 0

  /** Ist der Bot so weit eingeloggt, dass er Befehle senden kann? */
  function isReady () {
    return typeof bot?._client?.chat === 'function' && bot?._client?.state === 'play'
  }

  function request (target, meta = {}) {
    const now = Date.now()
    const key = target.toLowerCase()

    if (!isReady()) {
      log.warn(`Trigger für ${target} ignoriert – der Bot ist noch nicht eingeloggt.`)
      return { accepted: false, reason: 'offline', target }
    }

    const last = lastByTarget.get(key)
    if (last && now - last < scan.dedupeWindowMs) {
      return { accepted: false, reason: 'dedupe', target }
    }
    if (pending.length >= scan.queueSize) {
      return { accepted: false, reason: 'busy', target }
    }

    const id = ++idCounter
    const req = {
      id,
      target,
      requestedAt: now,
      triggerAt: typeof meta.triggerAt === 'number' ? meta.triggerAt : now,
      source: meta.source || 'manual',
      commandSentAt: 0,
      windowAt: 0,
      timer: null,
      fallback: null
    }
    lastByTarget.set(key, now)
    if (lastByTarget.size > 64) {
      const oldest = [...lastByTarget.entries()].sort((a, b) => a[1] - b[1])[0]
      lastByTarget.delete(oldest[0])
    }
    pending.push(req)

    // Sicherheitsnetz: Falls ein Server ein Fenster öffnet, ohne window_items
    // zu schicken, scannen wir trotzdem den aktuellen Stand.
    req.fallback = setTimeout(() => {
      const current = bot.currentWindow
      if (!current || current.invcheckerScanned || !pending.includes(req)) return
      log.warn(`Kein window_items für Fenster ${current.id} bekommen – scanne den aktuellen Stand.`)
      scanWindow(current)
    }, invsee.fallbackScanMs ?? 250)

    // Befehl sofort raus – das ist der einzige Punkt in der Kette, der wartet.
    const command = invsee.command.replace(/\{player\}/gi, target).replace(/^\s*\//, '')
    req.commandSentAt = Date.now()
    try {
      bot.chat('/' + command)
    } catch (err) {
      drop(req)
      log.error(`Befehl konnte nicht gesendet werden: ${err.message}`)
      return { accepted: false, reason: 'chat_failed', target, message: err.message }
    }
    log.info(`→ /${command}  (Trigger: ${meta.source || 'manual'})`)

    req.timer = setTimeout(() => {
      if (!drop(req)) return
      log.warn(`✗ Kein Inventar-Fenster für ${target} innerhalb von ${invsee.windowTimeoutMs} ms`)
      bot.emit('invchecker:fail', {
        id,
        type: 'result',
        target,
        ok: false,
        error: 'window_timeout',
        message: `Der Server hat innerhalb von ${invsee.windowTimeoutMs} ms kein Inventar geöffnet (keine Berechtigung, Spieler offline oder Befehl falsch).`,
        triggerAt: req.triggerAt,
        timings: { totalMs: Date.now() - req.triggerAt }
      })
    }, invsee.windowTimeoutMs)

    return { accepted: true, id, target }
  }

  function drop (req) {
    const idx = pending.indexOf(req)
    if (idx === -1) return false
    pending.splice(idx, 1)
    if (req.timer) clearTimeout(req.timer)
    if (req.fallback) clearTimeout(req.fallback)
    return true
  }

  function titleMatches (window, target) {
    const title = flattenText(window?.title).toLowerCase()
    if (!title) return false
    return title.includes(target.toLowerCase())
  }

  // ignoreItems liegt namespaced vor ("minecraft:barrier"), item.name ist es in
  // mineflayer meist nicht ("barrier"). Beide Formen vergleichen.
  const ignoreSet = new Set()
  for (const raw of invsee.ignoreItems || []) {
    const bare = String(raw).replace(/^minecraft:/, '')
    ignoreSet.add(bare)
    ignoreSet.add('minecraft:' + bare)
  }
  const isIgnored = (name) => name !== undefined && ignoreSet.has(name)

  // Gleiche Items zu einem Stack zusammenfassen ("Totem 10x" statt 10x "Totem 1x").
  // Getrennt bleibt, was sich unterscheidet (Custom-Name oder Verzauberung),
  // damit z.B. zwei verschieden verzauberte Schwerter nicht verschmelzen.
  function mergeStacks (list) {
    const map = new Map()
    for (const it of list) {
      const key = it.id + '|' + (it.cn || '') + '|' + (it.e || []).join(',')
      const ex = map.get(key)
      if (ex) ex.c += it.c
      else map.set(key, { ...it })
    }
    return [...map.values()]
  }

  function readSlots (window) {
    const ranges = invsee.slots
    const items = []
    const armor = []
    const offhand = []
    const slots = window.slots || []
    // Hinter inventoryStart liegt das Inventar des Bots, nicht das des Ziels.
    const limit = invsee.ignoreOwnInventory && Number.isFinite(window.inventoryStart)
      ? Math.min(slots.length, window.inventoryStart)
      : slots.length

    for (let slot = 0; slot < limit; slot++) {
      const item = slots[slot]
      if (!item || item.count === 0) continue
      if (isIgnored(item.name)) continue

      let bucket
      if (inRange(slot, ranges.armor)) bucket = armor
      else if (inRange(slot, ranges.offhand)) bucket = offhand
      else if (inRange(slot, ranges.inventory)) bucket = items
      else continue

      try {
        bucket.push(serializeItem(item, bot.registry, bot.invcheckerEnchantNames, slot))
      } catch (err) {
        log.warn(`Slot ${slot} konnte nicht gelesen werden (${err.message}) – wird übersprungen.`)
      }
    }
    return { items, armor, offhand }
  }

  function finish (req, window, titleMatched) {
    if (!drop(req)) return
    const readAt = Date.now()
    let { items, armor, offhand } = readSlots(window)
    if (invsee.mergeStacks !== false) items = mergeStacks(items)
    lastScanAt = readAt

    const counts = {}
    for (const it of items) counts[it.id] = (counts[it.id] || 0) + it.c
    for (const it of offhand) counts[it.id] = (counts[it.id] || 0) + it.c

    if (invsee.closeWindowAfterScan) {
      try { bot.closeWindow(window) } catch { /* Fenster evtl. schon zu */ }
    }

    const result = {
      id: req.id,
      type: 'result',
      ok: true,
      target: req.target,
      targetName: flattenText(window.title).trim() || req.target,
      windowTitle: flattenText(window.title).trim(),
      titleMatched: !!titleMatched,
      windowType: window.type,
      totalSlots: window.slots ? window.slots.length : 0,
      items,
      armor,
      offhand,
      counts,
      slotCounts: { inventory: items.length, armor: armor.length, offhand: offhand.length },
      source: req.source,
      timings: {
        triggerToCommandMs: req.commandSentAt - req.triggerAt,
        commandToWindowMs: req.windowAt - req.commandSentAt,
        windowToReadMs: readAt - req.windowAt,
        scanMs: Date.now() - readAt,
        totalMs: Date.now() - req.triggerAt
      },
      at: Date.now()
    }
    log.ok(`✓ ${req.target}: ${items.length} Stacks, ${armor.length} Rüstung, ${offhand.length} Offhand – ${result.timings.totalMs} ms gesamt`)
    bot.emit('invchecker:result', result)
  }

  /** Kompakte Zeile aller belegten Container-Slots – beweist das echte Layout. */
  function logSlotDump (window) {
    const slots = window.slots || []
    const limit = invsee.ignoreOwnInventory && Number.isFinite(window.inventoryStart)
      ? Math.min(slots.length, window.inventoryStart)
      : slots.length
    const parts = []
    for (let i = 0; i < limit; i++) {
      const it = slots[i]
      if (it && it.count > 0) parts.push(`${i}:${it.name}x${it.count}`)
    }
    log.info(`Slot-Dump (0..${limit - 1}): ${parts.join(' ') || '(leer)'}`)
  }

  function scanWindow (window) {
    if (window.invcheckerScanned) return false
    const titleMatched = pending.some((req) => titleMatches(window, req.target))
    const req = titleMatched
      ? pending.find((r) => titleMatches(window, r.target))
      : pending[0] // kein Name im Titel -> ältester offener Request
    if (!req) return false

    window.invcheckerScanned = true
    req.windowAt = Date.now()
    logSlotDump(window)
    log.debug(`Fenster gelesen: id=${window.id} type=${window.type} slots=${window.slots?.length ?? 0} ` +
      `eigenStart=${window.inventoryStart} belegt=${window.slots ? window.slots.filter(Boolean).length : 0} ` +
      `Titel="${flattenText(window.title)}" titelTreffer=${titleMatched}`)
    finish(req, window, titleMatched)
    return true
  }

  bot.on('windowOpen', (window) => {
    log.debug(`windowOpen: pending=${pending.length} id=${window?.id} type=${window?.type}`)
    if (!pending.length) return
    try {
      scanWindow(window)
    } catch (err) {
      log.error(`Scan fehlgeschlagen: ${err.stack || err.message}`)
    }
  })

  return {
    request,
    isReady,
    get pendingCount () { return pending.length },
    get lastScanAt () { return lastScanAt }
  }
}

module.exports = { createScanner, inRange }
