#!/usr/bin/env node
'use strict'

/**
 * Kleines Diagnose-Tool: tut genau das, was die Mod tut, nur von der
 * Kommandozeile. Praktisch um zu prüfen, ob Bot + Server + invsee funktionieren,
 * BEVOR man Minecraft startet.
 *
 *   node tools/check.js                     -> Trigger "Testspieler" an localhost:2895
 *   node tools/check.js Greatcat14          -> Trigger für Greatcat14
 *   node tools/check.js --host 192.168.1.50 --port 2895 --token geheim Greatcat14
 */

const net = require('node:net')

const args = process.argv.slice(2)
const get = (flag, fallback) => {
  const i = args.indexOf(flag)
  if (i === -1 || i === args.length - 1) return fallback
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}

const host = get('--host', '127.0.0.1')
const port = Number(get('--port', '2895'))
const token = get('--token', 'invchecker-change-me')
const target = args.find((a) => !a.startsWith('--')) || 'Testspieler'

console.log(`Verbinde mit ${host}:${port} …`)
const startedAt = Date.now()
const socket = net.connect(port, host)
socket.setNoDelay(true)
socket.setEncoding('utf8')

let buffer = ''
let sent = false

socket.on('connect', () => {
  console.log('Verbunden. Warte auf hello …')
})

socket.on('data', (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl)
    buffer = buffer.slice(nl + 1)
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    handle(msg)
  }
})

socket.on('error', (err) => {
  console.error(`Verbindung fehlgeschlagen: ${err.message}`)
  console.error('Läuft der Bot? Stimmen Host/Port/Token (bot/config.json)?')
  process.exit(1)
})

function handle (msg) {
  switch (msg.type) {
    case 'hello':
      console.log(`Bot: ${msg.botName || '?'} auf ${msg.server} – botOnline=${msg.botOnline}`)
      if (!msg.botOnline) console.log('Hinweis: Der Bot ist noch nicht eingeloggt, der Trigger wird abgelehnt.')
      if (!sent) {
        sent = true
        console.log(`Sende Trigger für ${target} …`)
        socket.write(JSON.stringify({ type: 'trigger', token, target, triggerAt: Date.now(), source: 'check-tool' }) + '\n')
      }
      break
    case 'result': {
      const t = msg.timings || {}
      if (!msg.ok) {
        console.error(`\n✗ FEHLER (${msg.error}): ${msg.message}`)
        socket.end()
        process.exit(1)
      }
      console.log(`\n✓ ${msg.target} – Fenster "${msg.windowTitle}" (${msg.windowType})`)
      console.log(`  Inventar (${msg.items.length} Stacks):`)
      for (const item of msg.items) {
        const extra = [item.cn ? `"${item.cn}"` : null, item.e ? item.e.join(', ') : null, item.d ? `Haltbarkeit ${item.d}` : null].filter(Boolean).join(' · ')
        console.log(`    Slot ${String(item.s).padStart(2)}  ${item.n} x${item.c}${extra ? '  ' + extra : ''}`)
      }
      if (msg.armor.length) console.log(`  Rüstung:  ${msg.armor.map((i) => i.n).join(', ')}`)
      if (msg.offhand.length) console.log(`  Offhand:  ${msg.offhand.map((i) => `${i.n}${i.c > 1 ? ' x' + i.c : ''}`).join(', ')}`)
      console.log(`\n  Latenz: gesamt ${t.totalMs} ms (Trigger→Befehl ${t.triggerToCommandMs}, Befehl→Fenster ${t.commandToWindowMs}, Fenster→gelesen ${t.windowToReadMs})`)
      console.log(`  Rundreise über TCP: ${Date.now() - startedAt} ms`)
      socket.end()
      process.exit(0)
      break
    }
    case 'error':
      console.error(`✗ Bot meldet: ${msg.error} – ${msg.message || ''}`)
      socket.end()
      process.exit(1)
      break
    case 'status':
      console.log(`Status: ${msg.state}`)
      break
    default:
      console.log('←', JSON.stringify(msg))
  }
}

setTimeout(() => {
  console.error('Zeitüberschreitung (10 s) – keine Antwort vom Bot.')
  process.exit(1)
}, 10000)
