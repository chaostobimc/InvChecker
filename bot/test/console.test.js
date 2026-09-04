'use strict'

/**
 * Konsolen-Test: Der Bot wird als echter Kindprozess mit gepipepter stdin
 * gestartet (INVCHECKER_FORCE_STDIN). Was man dort eintippt, muss 1:1 als
 * Ingame-Befehl mit führendem "/" beim Server ankommen; addpull/pull müssen
 * quittiert werden.
 * Ausführung:  npm test
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const { startFakeServer } = require('./fake-server')

const MC_PORT = 25900
const TCP_PORT = 28900

function makeConfig () {
  const cfg = {
    server: { host: '127.0.0.1', port: MC_PORT, version: '1.21.4' },
    auth: { mode: 'offline', username: 'InvCheckerBot' },
    bot: { autoReconnect: false, physicsEnabled: false, viewDistance: 'tiny', usePathfinder: false },
    invsee: {
      command: '/invsee {player}', windowTimeoutMs: 1500, closeWindowAfterScan: true,
      slots: { inventory: [0, 35], armor: [37, 40], offhand: [46, 46] },
      ignoreItems: ['minecraft:barrier']
    },
    scan: { dedupeWindowMs: 400, minIntervalMs: 0, queueSize: 2 },
    net: { host: '127.0.0.1', port: TCP_PORT, token: 'test-token' }
  }
  const file = path.join(os.tmpdir(), `invchecker-console-${process.pid}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(cfg))
  return file
}

function waitText (stream, needle, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error(`Timeout beim Warten auf "${needle}"`)), timeoutMs)
    stream.on('data', (chunk) => {
      buf += chunk.toString()
      if (buf.includes(needle)) { clearTimeout(timer); resolve(buf) }
    })
  })
}

test('Konsole: unbekannte Eingabe wird zu /<Befehl> ingame', async () => {
  const fake = startFakeServer({ port: MC_PORT, buildItems: () => [] })
  const configFile = makeConfig()

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js'), configFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, INVCHECKER_FORCE_STDIN: '1' }
  })
  let out = ''
  child.stdout.on('data', (c) => { out += c.toString() })
  child.stderr.on('data', (c) => { out += c.toString() })

  try {
    await waitText(child.stdout, 'Verbunden als')

    child.stdin.write('msg Greatcat14 Hallo\n')
    // Der Befehl muss beim (Fake-)Server als "msg Greatcat14 Hallo" ankommen.
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !fake.seen.commands.includes('msg Greatcat14 Hallo')) {
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.ok(fake.seen.commands.includes('msg Greatcat14 Hallo'),
      `erwartet "msg Greatcat14 Hallo" in ${JSON.stringify(fake.seen.commands)}`)

    // addpull wird quittiert
    child.stdin.write('addpull 10 64 -3\n')
    await waitText(child.stdout, 'addpull: Ziel 10 64 -3')
  } finally {
    child.kill('SIGKILL')
    try { fake.close() } catch { /* egal */ }
  }
})
