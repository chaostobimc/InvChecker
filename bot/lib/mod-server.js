'use strict'

const net = require('node:net')
const log = require('./log')

const PROTOCOL = 1
const MAX_LINE = 256 * 1024

/**
 * TCP-Brücke zur Fabric-Mod.
 *
 * Protokoll: eine JSON-Zeile pro Nachricht, UTF-8, '\n' als Trenner.
 *
 *   Mod -> Bot:
 *     {"type":"trigger","token":"...","target":"Greatcat14","triggerAt":1730000000000,"source":"chat"}
 *     {"type":"ping"}
 *     {"type":"config","token":"...","patch":{...}}
 *
 *   Bot -> Mod:
 *     {"type":"result","ok":true,"target":"...","items":[...],"timings":{...}}
 *     {"type":"error","error":"window_timeout","message":"..."}
 *     {"type":"hello","protocol":1,"botName":"...","server":"..."}
 *     {"type":"pong","t":...}
 *
 * TCP ist hier bewusst gewählt: ein Paket pro Richtung, keine HTTP-Header,
 * kein Handshake pro Trigger – auf einer LAN-Verbindung unter 1 ms.
 */
function createModServer (bot, cfg, scanner) {
  const clients = new Set()
  let server = null
  let botOnline = false

  function send (obj) {
    const line = JSON.stringify(obj) + '\n'
    for (const socket of clients) {
      if (socket.destroyed) continue
      socket.write(line)
    }
  }

  function handleLine (socket, line) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      socket.write(JSON.stringify({ type: 'error', error: 'bad_json' }) + '\n')
      return
    }
    if (!msg || typeof msg !== 'object') return

    if (msg.type !== 'ping' && cfg.net.token && msg.token !== cfg.net.token) {
      log.warn(`Verbindung ${socket.remoteAddress}:${socket.remotePort} hat ein falsches Token geschickt – wird getrennt.`)
      socket.write(JSON.stringify({ type: 'error', error: 'bad_token', message: 'Token stimmt nicht mit bot/config.json überein.' }) + '\n')
      socket.end()
      return
    }

    switch (msg.type) {
      case 'trigger': {
        const target = String(msg.target || '').trim().replace(/[^A-Za-z0-9_]/g, '')
        if (!target || target.length > 16) {
          socket.write(JSON.stringify({ type: 'error', error: 'bad_target', message: 'Ungültiger Spielername.' }) + '\n')
          return
        }
        let res
        try {
          res = scanner.request(target, { source: msg.source || 'mod', triggerAt: Number(msg.triggerAt) || Date.now() })
        } catch (err) {
          // Eine kaputte Nachricht darf den Bot nie abschießen.
          log.error(`Trigger für ${target} ist fehlgeschlagen: ${err.message}`)
          socket.write(JSON.stringify({ type: 'error', error: 'internal', target, message: err.message }) + '\n')
          break
        }
        if (!res.accepted) {
          const messages = {
            busy: 'Der Bot scannt gerade schon.',
            dedupe: 'Doppelter Trigger ignoriert.',
            offline: 'Der Bot ist noch nicht mit dem Server verbunden.',
            chat_failed: res.message || 'Befehl konnte nicht gesendet werden.'
          }
          socket.write(JSON.stringify({ type: 'error', error: res.reason, target, message: messages[res.reason] || res.reason }) + '\n')
        }
        if (cfg.net.logTraffic) log.debug('← trigger', target)
        break
      }
      case 'ping':
        socket.write(JSON.stringify({ type: 'pong', t: Date.now(), bot: bot.username, server: `${cfg.server.host}:${cfg.server.port}` }) + '\n')
        break
      case 'config':
        bot.emit('invchecker:config', msg.patch || {})
        socket.write(JSON.stringify({ type: 'config_ack', ok: true }) + '\n')
        break
      case 'addpull':
        bot.emit('invchecker:addpull', msg)
        break
      case 'pull':
        bot.emit('invchecker:pull', msg)
        break
      default:
        socket.write(JSON.stringify({ type: 'error', error: 'unknown_type', got: msg.type }) + '\n')
    }
  }

  server = net.createServer((socket) => {
    if (clients.size >= cfg.net.maxConnections) {
      socket.write(JSON.stringify({ type: 'error', error: 'too_many_clients' }) + '\n')
      socket.end()
      return
    }
    socket.setNoDelay(true)
    socket.setKeepAlive(true, 15000)
    clients.add(socket)

    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      if (buffer.length > MAX_LINE) {
        socket.end()
        return
      }
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line) handleLine(socket, line)
      }
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      clients.delete(socket)
      log.info(`Mod-Verbindung getrennt (${clients.size} offen)`)
      bot.emit('invchecker:clients', clients.size)
    })

    log.info(`Mod verbunden von ${socket.remoteAddress}:${socket.remotePort} (${clients.size} offen)`)
    socket.write(JSON.stringify({
      type: 'hello',
      protocol: PROTOCOL,
      botName: bot.username,
      botOnline,
      server: `${cfg.server.host}:${cfg.server.port}`,
      version: cfg.server.version
    }) + '\n')
    bot.emit('invchecker:clients', clients.size)
  })

  server.on('error', (err) => {
    // EADDRINUSE wird in listen() mit einer Handlungsanweisung behandelt.
    if (err.code === 'EADDRINUSE') return
    log.error(`TCP-Server-Fehler: ${err.message}`)
  })

  return {
    protocol: PROTOCOL,
    setBotOnline (online) {
      botOnline = !!online
      send({ type: 'status', state: online ? 'ready' : 'offline', bot: bot.username, server: `${cfg.server.host}:${cfg.server.port}` })
    },
    get botOnline () { return botOnline },
    listen () {
      return new Promise((resolve, reject) => {
        server.once('error', (err) => {
          if (err.code !== 'EADDRINUSE') { reject(err); return }
          const e = new Error(
            `Port ${cfg.net.port} auf ${cfg.net.host} ist schon belegt – der Bot kann nicht starten.\n` +
            `  Meistens laeuft noch eine zweite Instanz des Bots.\n` +
            `  Herausfinden:   ss -ltnp | grep ${cfg.net.port}\n` +
            `  Beenden:        kill <PID>\n` +
            `  Oder in bot/config.json unter "net" einen freien "port" waehlen.`)
          e.friendly = true
          reject(e)
        })
        server.listen(cfg.net.port, cfg.net.host, () => {
          server.removeListener('error', reject)
          const addr = server.address()
          log.ok(`TCP für Mod bereit auf ${addr.address}:${addr.port} (Token: ${cfg.net.token === 'invchecker-change-me' ? 'STANDARDWERT – bitte ändern!' : 'gesetzt'})`)
          resolve(addr)
        })
      })
    },
    send,
    broadcast: send,
    get clientCount () { return clients.size },
    close () {
      for (const socket of clients) socket.destroy()
      clients.clear()
      return new Promise((resolve) => server.close(() => resolve()))
    }
  }
}

module.exports = { createModServer, PROTOCOL }
