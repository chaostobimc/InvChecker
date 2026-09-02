'use strict'

/**
 * End-to-End-Test: echter Bot + Fake-Minecraft-Server + echte TCP-Verbindung.
 * Ausführung:  npm test
 */

const test = require('node:test')
const assert = require('node:assert')
const net = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { startFakeServer, WIN, Item, registry, enchanted, named, damaged } = require('./fake-server')

const TCP_BASE = 28770
const MC_BASE = 25700
const TOKEN = 'test-token'

let configSeq = 0

function makeConfig (extra = {}) {
  const seq = configSeq++
  const cfg = {
    server: { host: '127.0.0.1', port: MC_BASE + seq * 10, version: '1.21.4' },
    auth: { mode: 'offline', username: 'InvCheckerBot' },
    bot: { autoReconnect: false, physicsEnabled: false, viewDistance: 'tiny' },
    invsee: {
      command: '/invsee {player}',
      windowTimeoutMs: 1500,
      closeWindowAfterScan: true,
      slots: { inventory: [0, 35], armor: [39, 42], offhand: [43, 43] },
      ignoreItems: ['minecraft:barrier']
    },
    scan: { dedupeWindowMs: 400, minIntervalMs: 0, queueSize: 2 },
    net: { host: '127.0.0.1', port: TCP_BASE + seq * 10, token: TOKEN },
    ...extra
  }
  const file = path.join(os.tmpdir(), `invchecker-test-${process.pid}-${seq}.json`)
  fs.writeFileSync(file, JSON.stringify(cfg))
  return { file, cfg }
}

/** Simuliert das invsee-GUI aus dem Screenshot. */
function buildItems () {
  const items = Array.from({ length: WIN.slots }, () => Item.toNotch(null))
  const byName = (n) => registry.itemsByName[n].id

  items[0] = Item.toNotch(new Item(byName('golden_apple'), 3))
  items[1] = Item.toNotch(new Item(byName('ender_pearl'), 16))
  items[5] = enchanted(byName('netherite_sword'), 1, [{ id: 32, level: 4 }])
  items[9] = named(byName('totem_of_undying'), 1, 'Notfall-Totem')
  items[13] = damaged(byName('netherite_chestplate'), 1, 120)

  // Deko-Reihe 5: Barrieren + Rüstung rechts vom Rüstungsständer, Offhand rechts vom Netherstern
  const barrier = byName('barrier')
  for (let s = 36; s <= 44; s++) items[s] = Item.toNotch(new Item(barrier, 1))
  items[39] = Item.toNotch(new Item(byName('netherite_helmet'), 1))
  items[40] = Item.toNotch(new Item(byName('netherite_chestplate'), 1))
  items[41] = Item.toNotch(new Item(byName('netherite_leggings'), 1))
  items[42] = Item.toNotch(new Item(byName('netherite_boots'), 1))
  items[43] = Item.toNotch(new Item(byName('shield'), 1))
  return items
}

function connectMod (port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.setNoDelay(true)
    socket.setEncoding('utf8')
    let buffer = ''
    const queue = []
    const waiters = []
    socket.on('data', (chunk) => {
      buffer += chunk
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        if (waiters.length) waiters.shift()(msg)
        else queue.push(msg)
      }
    })
    socket.on('error', reject)
    resolve({
      socket,
      send (obj) { socket.write(JSON.stringify(obj) + '\n') },
      next (predicate = () => true, timeoutMs = 8000) {
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`Zeitüberschreitung beim Warten auf eine Nachricht (${timeoutMs} ms)`)), timeoutMs)
          const deliver = (msg) => {
            if (predicate(msg)) {
              clearTimeout(timer)
              res(msg)
              return true
            }
            queue.push(msg)
            return false
          }
          const idx = queue.findIndex(predicate)
          if (idx !== -1) {
            clearTimeout(timer)
            const msg = queue[idx]
            queue.splice(idx, 1)
            res(msg)
            return
          }
          waiters.push(deliver)
        })
      },
      close () { socket.destroy() }
    })
  })
}

/**
 * Verbindet sich und wartet, bis der Bot wirklich auf dem Server eingeloggt
 * ist (hello.botOnline). Gibt die fertige Mod-Verbindung zurück.
 */
async function connectReadyMod (port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const mod = await connectMod(port)
    const hello = await mod.next((m) => m.type === 'hello')
    if (hello.botOnline) return { mod, hello }
    mod.close()
    if (Date.now() > deadline) throw new Error('Bot wurde nicht rechtzeitig fertig eingeloggt')
    await new Promise((r) => setTimeout(r, 100))
  }
}

test('Trigger über TCP führt /invsee aus und liefert das Inventar zurück', async () => {
  const { file: configFile, cfg } = makeConfig()
  const fake = startFakeServer({ port: cfg.server.port, buildItems })

  const { main } = require('../index')
  const instance = await main(configFile)
  if (process.env.INVCHECKER_TEST_DEBUG) {
    instance.bot._client.on('packet', (data, meta) => { if (meta?.name && meta.name !== 'keep_alive') console.log('  [bot pkt]', meta.name, meta.state) })
    instance.bot._client.on('error', (e) => console.log('  [bot client error]', e.message))
  }

  // 0. Trigger vor dem Login wird sauber abgelehnt (statt den Bot abzuschießen)
  const early = await connectMod(cfg.net.port)
  await early.next((m) => m.type === 'hello')
  early.send({ type: 'trigger', token: TOKEN, target: 'TooEarly' })
  const offline = await early.next((m) => m.type === 'error')
  assert.ok(['offline', 'dedupe', 'busy'].includes(offline.error), `unerwarteter Fehler: ${offline.error}`)
  early.close()

  // 1. Falsches Token wird abgewiesen
  const wrong = await connectMod(cfg.net.port)
  await wrong.next((m) => m.type === 'hello')
  wrong.send({ type: 'trigger', token: 'falsch', target: 'Greatcat14' })
  const badToken = await wrong.next((m) => m.type === 'error' && m.error === 'bad_token')
  assert.strictEqual(badToken.error, 'bad_token')
  wrong.close()

  // 2. Richtiger Trigger
  const { mod, hello } = await connectReadyMod(cfg.net.port)
  assert.strictEqual(hello.protocol, 1)
  assert.strictEqual(hello.server, `127.0.0.1:${cfg.server.port}`)

  const triggerAt = Date.now()
  mod.send({ type: 'trigger', token: TOKEN, target: 'Greatcat14', triggerAt, source: 'chat' })
  const result = await mod.next((m) => m.type === 'result')

  assert.deepStrictEqual(fake.seen.commands, ['invsee Greatcat14'], 'der Befehl ist nicht beim Server angekommen')
  assert.strictEqual(result.ok, true, `Scan fehlgeschlagen: ${result.error}`)
  assert.strictEqual(result.target, 'Greatcat14')
  assert.strictEqual(result.windowTitle, 'Greatcat14s Inventar')
  assert.strictEqual(result.targetName, 'Greatcat14s Inventar')
  assert.strictEqual(result.titleMatched, true)
  assert.strictEqual(result.windowType, 'minecraft:generic_9x6')

  // Nur die ersten 4 Reihen zählen als Inventar
  const ids = result.items.map((i) => i.id)
  assert.ok(ids.includes('minecraft:golden_apple'), 'goldener Apfel fehlt')
  assert.ok(ids.includes('minecraft:ender_pearl'), 'Enderperlen fehlen')
  assert.ok(!ids.includes('minecraft:barrier'), 'Barrieren dürfen nicht im Inventar auftauchen')
  assert.ok(!ids.includes('minecraft:netherite_helmet'), 'Rüstung gehört nicht in die Inventarliste')

  const apples = result.items.find((i) => i.id === 'minecraft:golden_apple')
  assert.strictEqual(apples.c, 3)
  assert.strictEqual(apples.s, 0)
  assert.strictEqual(apples.n, 'Golden Apple')
  assert.strictEqual(result.counts['minecraft:golden_apple'], 3)

  // Rüstung + Offhand aus den konfigurierten Slots
  assert.deepStrictEqual(result.armor.map((i) => i.id), [
    'minecraft:netherite_helmet', 'minecraft:netherite_chestplate', 'minecraft:netherite_leggings', 'minecraft:netherite_boots'
  ])
  assert.deepStrictEqual(result.offhand.map((i) => i.id), ['minecraft:shield'])

  // Der Server meldet die Enchantment-Registry – der Bot muss sie übernehmen
  const serverEnchants = instance.bot.invcheckerEnchantNames
  assert.ok(serverEnchants.size >= 40, `Server-Registry wurde nicht übernommen (nur ${serverEnchants.size} Einträge)`)
  assert.strictEqual(serverEnchants.get(32), 'sharpness', `Netz-ID 32 ist laut Server "${serverEnchants.get(32)}"`)

  const sword = result.items.find((i) => i.id === 'minecraft:netherite_sword')
  assert.deepStrictEqual(sword.e, ['sharpness IV'])

  // Custom Name und Haltbarkeit
  const totem = result.items.find((i) => i.id === 'minecraft:totem_of_undying')
  assert.strictEqual(totem.cn, 'Notfall-Totem')
  const chest = result.items.find((i) => i.id === 'minecraft:netherite_chestplate')
  assert.strictEqual(chest.d, `${592 - 120}/592`)

  // Fenster wurde wieder geschlossen
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.ok(fake.seen.closedAt, 'Bot hat das invsee-Fenster nicht geschlossen')

  // Doppelte Trigger innerhalb des Dedupe-Fensters werden ignoriert
  mod.send({ type: 'trigger', token: TOKEN, target: 'Greatcat14', source: 'chat' })
  const dupe = await mod.next((m) => m.type === 'error' && m.error === 'dedupe')
  assert.strictEqual(dupe.error, 'dedupe')

  // Ein zweiter Spieler funktioniert trotzdem sofort
  mod.send({ type: 'trigger', token: TOKEN, target: 'OtherPlayer', source: 'chat' })
  const second = await mod.next((m) => m.type === 'result' && m.target === 'OtherPlayer')
  assert.strictEqual(second.ok, true)
  assert.deepStrictEqual(fake.seen.commands, ['invsee Greatcat14', 'invsee OtherPlayer'])

  // Latenzsanität: lokal muss die ganze Kette deutlich unter 1,5 s liegen
  assert.ok(result.timings.totalMs < 1500, `Scan zu langsam: ${result.timings.totalMs} ms`)
  console.log(`  [Latenz] gesamt ${result.timings.totalMs} ms (Trigger→Befehl ${result.timings.triggerToCommandMs} ms, Befehl→Fenster ${result.timings.commandToWindowMs} ms, Fenster→gelesen ${result.timings.windowToReadMs} ms)`)

  mod.close()
  await instance.shutdown()
  await fake.close()
  fs.unlinkSync(configFile)
})

test('Bot meldet window_timeout, wenn der Server kein Fenster öffnet', async () => {
  const { file: configFile, cfg } = makeConfig({ invsee: {
    command: '/invsee {player}',
    windowTimeoutMs: 400,
    closeWindowAfterScan: true,
    slots: { inventory: [0, 35], armor: [39, 42], offhand: [43, 43] },
    ignoreItems: ['minecraft:barrier']
  } })
  const fake = startFakeServer({
    port: cfg.server.port,
    answerCommands: false,
    buildItems: () => Array.from({ length: WIN.slots }, () => Item.toNotch(null))
  })

  const { main } = require('../index')
  const instance = await main(configFile)
  const { mod } = await connectReadyMod(cfg.net.port)

  mod.send({ type: 'trigger', token: TOKEN, target: 'Greatcat14', source: 'chat' })
  const failure = await mod.next((m) => m.type === 'result' && m.ok === false)
  assert.strictEqual(failure.error, 'window_timeout')
  assert.strictEqual(failure.target, 'Greatcat14')
  assert.ok(failure.timings.totalMs >= 400)

  mod.close()
  await instance.shutdown()
  await fake.close()
  fs.unlinkSync(configFile)
})
