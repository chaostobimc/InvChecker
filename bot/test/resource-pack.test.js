'use strict'

/**
 * Regressionstest fuer den Server-Ressourcenpaket-Handler.
 *
 * Hintergrund: hugosmp.net schickt in der Configuration-Phase ein erzwungenes
 * Ressourcenpaket und wartet auf die Antwort, bevor es finish_configuration
 * schickt. Weder minecraft-protocol noch mineflayer beantworten das Paket von
 * sich aus – der Bot hing deshalb fuer immer im Zustand 'configuration'.
 *
 * Geprueft wird die komplette Vanilla-Sequenz ACCEPTED -> DOWNLOADED ->
 * SUCCESSFULLY_LOADED gegen einen echten HTTP-Server, plus der Fehlerfall.
 * Ausführung:  npm test
 */

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const mc = require('minecraft-protocol')

const { startFakeServer } = require('./fake-server')

const MC_PORT = 25880
const TCP_PORT = 28880
const PACK_UUID = '5718825f-4645-39ea-affd-b07b0e5cb75d'

function makeConfig () {
  const cfg = {
    server: { host: '127.0.0.1', port: MC_PORT, version: '1.21.4' },
    auth: { mode: 'offline', username: 'InvCheckerBot' },
    bot: { autoReconnect: false, physicsEnabled: false, viewDistance: 'tiny' },
    invsee: {
      command: '/invsee {player}', windowTimeoutMs: 1500, closeWindowAfterScan: true,
      slots: { inventory: [0, 35], armor: [39, 42], offhand: [43, 43] },
      ignoreItems: ['minecraft:barrier']
    },
    scan: { dedupeWindowMs: 400, minIntervalMs: 0, queueSize: 2 },
    net: { host: '127.0.0.1', port: TCP_PORT, token: 'test-token' }
  }
  const file = path.join(os.tmpdir(), `invchecker-rp-${process.pid}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(cfg))
  return file
}

/** Echter HTTP-Server, der das Ressourcenpaket ausliefert. */
function startPackServer (body, status = 200) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/zip' })
      res.end(body)
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function until (cond, ms = 5000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return cond()
}

/** Bot starten, _client.write aufzeichnen, Handler ausloesen. */
async function runScenario (packBody, packStatus, packetOverride) {
  const packServer = await startPackServer(packBody, packStatus)
  const fake = startFakeServer({ port: MC_PORT, buildItems: () => [] })
  const configFile = makeConfig()

  const { main } = require('../index')
  const instance = await main(configFile)
  const bot = instance.bot

  // Warten, bis der Bot voll verbunden ist – der Handler braucht einen _client.
  const ready = await until(() => bot._client?.state === 'play' && bot.entity)
  assert.ok(ready, 'Bot wurde gegen den Fake-Server nicht fertig eingeloggt')

  const written = []
  const originalWrite = bot._client.write.bind(bot._client)
  bot._client.write = (name, params) => {
    if (name === 'resource_pack_receive') written.push(params)
    // Nicht wirklich senden: der Fake-Server ist im play-Zustand, ein
    // configuration-Paket wuerde dort nicht serialisierbar sein.
    return params
  }

  const packet = {
    uuid: PACK_UUID,
    url: `http://127.0.0.1:${packServer.port}/pack.zip`,
    hash: crypto.createHash('sha1').update(packBody).digest('hex'),
    forced: true,
    ...packetOverride
  }
  bot._client.emit('add_resource_pack', packet)

  const done = await until(() => written.length >= 2 && written[written.length - 1].result !== 3)
  bot._client.write = originalWrite

  try { await instance.shutdown() } catch { /* egal */ }
  try { fake.close() } catch { /* egal */ }
  await new Promise((r) => packServer.server.close(r))

  assert.ok(done, `Handler hat keine abschliessende Statusmeldung gesendet (nur ${written.length})`)
  return written
}

test('Ressourcenpaket: ACCEPTED -> DOWNLOADED -> SUCCESSFULLY_LOADED', async () => {
  const packBody = crypto.randomBytes(64 * 1024) // 64 KiB, echter Download
  const written = await runScenario(packBody, 200)

  assert.deepStrictEqual(
    written.map((p) => p.result),
    [3, 4, 0],
    'erwartet die Vanilla-Reihenfolge ACCEPTED(3), DOWNLOADED(4), SUCCESSFULLY_LOADED(0)'
  )
  for (const p of written) {
    assert.strictEqual(p.uuid, PACK_UUID, 'UUID muss unveraendert mitgeschickt werden')
  }
})

test('Ressourcenpaket: falscher SHA-1 meldet FAILED_DOWNLOAD statt Erfolg', async () => {
  const packBody = crypto.randomBytes(8 * 1024)
  const written = await runScenario(packBody, 200, { hash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' })

  assert.deepStrictEqual(
    written.map((p) => p.result),
    [3, 2],
    'nach ACCEPTED(3) muss FAILED_DOWNLOAD(2) kommen, niemals SUCCESSFULLY_LOADED'
  )
})

test('resource_pack_receive ist in der Configuration-Phase serialisierbar (String-UUID)', () => {
  // Genau der Schreibvorgang, den der Handler in der Configuration-Phase macht.
  const serializer = mc.createSerializer({ state: 'configuration', isServer: false, version: '1.21.11' })
  for (const result of [3, 4, 0]) {
    const buf = serializer.createPacketBuffer({
      name: 'resource_pack_receive',
      params: { uuid: PACK_UUID, result }
    })
    assert.ok(Buffer.isBuffer(buf) && buf.length > 0, `result ${result} musste serialisierbar sein`)
  }
})
