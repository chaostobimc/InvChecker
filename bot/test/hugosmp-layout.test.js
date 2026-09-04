'use strict'

/**
 * Scan-Test mit dem ECHTEN hugosmp.net-invsee-Layout, abgelesen aus einem
 * echten /invsee-Screenshot (9x6, Slot 0 oben links):
 *
 *   Reihe 1-4 (0-35)  = Spielerinventar
 *   Reihe 5: 36 = Rüstungsständer, 37-40 = Rüstung, 41-44 = Barriere (Deko)
 *   Reihe 6: 45 = Netherstern, 46 = Offhand, 47-53 = Barriere (Deko)
 *
 * Prüft die korrigierten Offsets (armor 37-40, offhand 46) und dass die
 * namespaced ignoreItems ("minecraft:barrier") die Deko trotz un-namespaced
 * item.name herausfiltern.
 * Ausführung:  npm test
 */

const test = require('node:test')
const assert = require('node:assert')
const net = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { startFakeServer, WIN, Item, registry } = require('./fake-server')

const MC_PORT = 25890
const TCP_PORT = 28890
const TOKEN = 'test-token'

function makeConfig () {
  const cfg = {
    server: { host: '127.0.0.1', port: MC_PORT, version: '1.21.4' },
    auth: { mode: 'offline', username: 'InvCheckerBot' },
    bot: { autoReconnect: false, physicsEnabled: false, viewDistance: 'tiny' },
    invsee: {
      command: '/invsee {player}', windowTimeoutMs: 1500, closeWindowAfterScan: true,
      slots: { inventory: [0, 35], armor: [37, 40], offhand: [46, 46] },
      ignoreItems: ['minecraft:barrier', 'minecraft:light', 'minecraft:structure_void',
        'minecraft:gray_stained_glass_pane', 'minecraft:armor_stand', 'minecraft:nether_star']
    },
    scan: { dedupeWindowMs: 400, minIntervalMs: 0, queueSize: 2 },
    net: { host: '127.0.0.1', port: TCP_PORT, token: TOKEN }
  }
  const file = path.join(os.tmpdir(), `invchecker-hugosmp-${process.pid}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(cfg))
  return file
}

/** Baut das echte hugosmp-Layout. */
function buildRealLayout () {
  const items = Array.from({ length: WIN.slots }, () => Item.toNotch(null))
  const id = (n) => registry.itemsByName[n].id
  const put = (slot, name, count = 1) => { items[slot] = Item.toNotch(new Item(id(name), count)) }

  put(0, 'diamond_sword')
  put(1, 'golden_apple', 62)
  put(2, 'totem_of_undying')
  put(3, 'totem_of_undying')
  put(4, 'ender_pearl', 15)
  put(8, 'obsidian', 64)
  put(27, 'rotten_flesh', 62)
  put(31, 'ender_pearl', 16)

  put(36, 'armor_stand')
  put(37, 'diamond_helmet')
  put(38, 'diamond_chestplate')
  put(39, 'diamond_leggings')
  put(40, 'diamond_boots')
  for (let s = 41; s <= 44; s++) put(s, 'barrier')
  put(45, 'nether_star')
  put(46, 'totem_of_undying') // Offhand
  for (let s = 47; s <= 53; s++) put(s, 'barrier')
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
          const timer = setTimeout(() => rej(new Error('timeout')), timeoutMs)
          const deliver = (msg) => {
            if (predicate(msg)) { clearTimeout(timer); res(msg); return true }
            queue.push(msg); return false
          }
          const idx = queue.findIndex(predicate)
          if (idx !== -1) { clearTimeout(timer); const m = queue[idx]; queue.splice(idx, 1); res(m); return }
          waiters.push(deliver)
        })
      },
      close () { socket.destroy() }
    })
  })
}

test('hugosmp-Layout: Rüstung 37-40, Offhand 46, Deko gefiltert', async () => {
  const fake = startFakeServer({ port: MC_PORT, buildItems: () => buildRealLayout() })
  const configFile = makeConfig()
  const { main } = require('../index')
  const instance = await main(configFile)

  // warten bis eingeloggt
  const deadline = Date.now() + 15000
  while (Date.now() < deadline && !(instance.bot._client?.state === 'play' && instance.bot.entity)) {
    await new Promise((r) => setTimeout(r, 100))
  }

  const mod = await connectMod(TCP_PORT)
  await mod.next((m) => m.type === 'hello')
  mod.send({ type: 'trigger', token: TOKEN, target: 'Victim', triggerAt: Date.now(), source: 'chat' })
  const result = await mod.next((m) => m.type === 'result')
  mod.close()

  assert.strictEqual(result.ok, true, `Scan fehlgeschlagen: ${result.error}`)

  // Rüstung exakt die 4 Teile, keine Barrieren
  assert.deepStrictEqual(result.armor.map((i) => i.id), [
    'minecraft:diamond_helmet', 'minecraft:diamond_chestplate', 'minecraft:diamond_leggings', 'minecraft:diamond_boots'
  ], 'Rüstung muss aus Slots 37-40 kommen, ohne Deko')

  // Offhand = Totem, nicht Barriere
  assert.deepStrictEqual(result.offhand.map((i) => i.id), ['minecraft:totem_of_undying'])

  // Inventar ohne Deko (barrier/armor_stand/nether_star), mit echten Items
  const ids = result.items.map((i) => i.id)
  assert.ok(ids.includes('minecraft:golden_apple'), 'goldener Apfel fehlt')
  assert.ok(ids.includes('minecraft:ender_pearl'), 'Enderperlen fehlen')
  assert.ok(!ids.includes('minecraft:barrier'), 'Barriere darf nicht im Inventar sein')
  assert.ok(!ids.includes('minecraft:armor_stand'), 'Rüstungsständer darf nicht im Inventar sein')
  assert.ok(!ids.includes('minecraft:nether_star'), 'Netherstern darf nicht im Inventar sein')

  // Gleiche Items verschmelzen zu einem Stack (Totem 2x statt 2x Totem 1x)
  const totems = result.items.filter((i) => i.id === 'minecraft:totem_of_undying')
  assert.strictEqual(totems.length, 1, 'mehrere Totems müssen zu einem Eintrag verschmelzen')
  assert.strictEqual(totems[0].c, 2, 'die Anzahl muss summiert werden')

  try { await instance.shutdown() } catch { /* egal */ }
  try { fake.close() } catch { /* egal */ }
})
