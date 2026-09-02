'use strict'

/**
 * Minimaler Fake-Minecraft-Server (1.21.4), der genau das tut, was ein
 * invsee-Plugin tut:
 *   1. Client einloggen
 *   2. auf /invsee <name> warten
 *   3. ein 9x6-Fenster mit dem Titel "<name>s Inventar" öffnen und füllen
 *
 * Damit lässt sich die komplette Kette (Trigger -> Befehl -> Fenster ->
 * Scan -> TCP-Antwort) ohne echten Server testen.
 *
 * Wichtig: minecraft-protocol verschickt beim Login von sich aus die kompletten
 * Registries (inkl. minecraft:enchantment in echter Netzwerk-Reihenfolge), so
 * wie es ein Vanilla-/Paper-Server auch tut. Eigene registry_data-Pakete darf
 * man hier nicht im PLAY-Zustand schreiben – die Paket-IDs sind dann falsch.
 */

const mc = require('minecraft-protocol')
const registry = require('prismarine-registry')('1.21.4')
const Item = require('prismarine-item')('1.21.4')
const nbt = require('prismarine-nbt')
const windows = require('prismarine-windows')('1.21.4')

const WINDOW_ID = 7
const WIN = windows.windows['minecraft:generic_9x6']

const chatText = (text) => nbt.comp({ text: nbt.string(text) })

function loginPacket () {
  const packet = JSON.parse(JSON.stringify(registry.loginPacket))
  packet.entityId = 0
  return packet
}

function emptyItems (n) {
  return Array.from({ length: n }, () => Item.toNotch(null))
}

/** Enchantment-Komponente in exakt der Wire-Form, die 1.21.4 benutzt. */
function enchanted (itemId, count, enchantmentRegistryIds) {
  const item = new Item(itemId, count)
  item.components = [{
    type: 'enchantments',
    data: { enchantments: enchantmentRegistryIds.map((e) => ({ id: e.id, level: e.level })), showTooltip: true }
  }]
  item.removedComponents = []
  return Item.toNotch(item)
}

function named (itemId, count, name) {
  const item = new Item(itemId, count)
  item.components = [{ type: 'custom_name', data: nbt.comp({ text: nbt.string(name) }) }]
  item.removedComponents = []
  return Item.toNotch(item)
}

function damaged (itemId, count, damage) {
  const item = new Item(itemId, count)
  item.components = [{ type: 'damage', data: damage }]
  item.removedComponents = []
  return Item.toNotch(item)
}

const debug = () => process.env.INVCHECKER_TEST_DEBUG

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {(target:string)=>Array} opts.buildItems  liefert die 90 Slots für /invsee <target>
 * @param {boolean} opts.answerCommands  false = Server ignoriert Befehle (für Timeout-Tests)
 */
function startFakeServer ({ port, buildItems, answerCommands = true }) {
  const server = mc.createServer({ 'online-mode': false, version: '1.21.4', port, motd: 'InvChecker-Test' })
  const seen = { commands: [], players: [] }

  server.on('playerJoin', (client) => {
    seen.players.push(client.username)
    if (debug()) console.log(`  [fake] playerJoin ${client.username}`)
    client.on('end', (reason) => { if (debug()) console.log(`  [fake] client end: ${reason}`) })

    client.write('login', loginPacket())
    client.write('position', {
      entityId: 0,
      x: 0, y: 64, z: 0,
      yaw: 0, pitch: 0,
      flags: 0,
      teleportId: 1,
      dismountVehicle: false
    })

    client.write('update_health', { health: 20, food: 20, foodSaturation: 5 })

    client.on('chat_command', (packet) => {
      const command = String(packet.command || '')
      seen.commands.push(command)
      const match = /invsee\s+(\w+)/i.exec(command)
      if (!match || !answerCommands) return
      const target = match[1]

      const items = buildItems(target)
      client.write('open_window', {
        windowId: WINDOW_ID,
        inventoryType: WIN.type,
        windowTitle: chatText(`${target}s Inventar`)
      })
      client.write('window_items', {
        windowId: WINDOW_ID,
        stateId: 1,
        items,
        carriedItem: Item.toNotch(null)
      })
    })

    client.on('close_window', () => { seen.closedAt = Date.now() })
  })

  return {
    server,
    seen,
    emptyItems,
    close: () => new Promise((resolve) => {
      for (const client of Object.values(server.clients || {})) {
        try { client.socket?.destroy() } catch { /* egal */ }
      }
      try { server.close() } catch { /* schon zu */ }
      setTimeout(resolve, 120)
    })
  }
}

module.exports = { startFakeServer, WINDOW_ID, WIN, Item, registry, enchanted, named, damaged, chatText }
