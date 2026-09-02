'use strict'

const path = require('node:path')
const mineflayer = require('mineflayer')
const log = require('./lib/log')
const { load: loadConfig } = require('./lib/config')
const { createScanner } = require('./lib/scanner')
const { createModServer } = require('./lib/mod-server')
const { attachTriggerListener } = require('./lib/trigger')
const { authOptions } = require('./lib/auth')

const CONFIG_FILE = process.env.INVCHECKER_CONFIG || process.argv[2] || path.join(__dirname, 'config.json')

async function main (configFile = CONFIG_FILE) {
  const cfg = loadConfig(configFile)
  const versionInfo = cfg.server.version ? `Version ${cfg.server.version}` : 'Version automatisch per Ping'
  log.info(`InvChecker Bot – Ziel ${cfg.server.host}:${cfg.server.port} (${versionInfo}), Auth: ${cfg.auth.mode}`)

  // ---------------------------------------------------------------- Auth
  let auth
  try {
    auth = authOptions(cfg)
  } catch (err) {
    log.error(`Auth-Konfiguration ungültig: ${err.message}`)
    log.error('Für einen Offline-Login auth.mode = "offline" in config.json setzen (nur möglich, wenn der Server das erlaubt).')
    process.exit(1)
  }
  log.info(`Auth: ${auth.auth} – Token-Cache: ${auth.profilesFolder ? path.relative(process.cwd(), auth.profilesFolder) || auth.profilesFolder : 'n/a'}`)

  // ------------------------------------------------------------ Bot bauen
  const bot = mineflayer.createBot({
    host: cfg.server.host,
    port: cfg.server.port,
    version: cfg.server.version || false,   // false = Version per Ping erkennen
    ...auth,
    hideErrors: cfg.bot.hideErrors,
    physicsEnabled: cfg.bot.physicsEnabled,
    viewDistance: cfg.bot.viewDistance,
    keepAlive: cfg.bot.keepAlive,
    checkTimeoutInterval: cfg.bot.checkTimeoutInterval,
    brand: cfg.bot.brand,
    respawn: true
  })

  bot.invcheckerEnchantNames = new Map()

  // Die echte Reihenfolge der Enchantment-Registry kommt vom Server
  // (Konfigurations-Phase). minecraft-data sortiert alphabetisch und liefert
  // deshalb falsche IDs – der Server hat immer recht.
  bot._client.on('registry_data', (packet) => {
    if (packet.id !== 'minecraft:enchantment' || !Array.isArray(packet.entries)) return
    packet.entries.forEach((entry, index) => {
      const name = String(entry.key || '').replace(/^minecraft:/, '')
      if (name) bot.invcheckerEnchantNames.set(index, name)
    })
    log.ok(`Enchantment-Registry vom Server übernommen (${packet.entries.length} Einträge)`)
  })

  const scanner = createScanner(bot, cfg)
  const modServer = createModServer(bot, cfg, scanner)
  attachTriggerListener(bot, cfg, scanner)

  // ------------------------------------------------------- Ergebnis-Ausgabe
  const summaryOf = (result) => {
    const parts = result.items
      .slice()
      .sort((a, b) => b.c - a.c)
      .slice(0, 6)
      .map((i) => `${i.n} x${i.c}`)
    const more = result.items.length - parts.length
    return parts.join(', ') + (more > 0 ? ` (+${more} weitere)` : '')
  }

  bot.on('invchecker:result', (result) => {
    modServer.send(result)
    if (cfg.response.sayResultInChat) {
      const text = cfg.response.template
        .replace('{target}', result.target)
        .replace('{summary}', summaryOf(result))
      bot.chat(text)
    }
  })
  bot.on('invchecker:fail', (failure) => modServer.send(failure))

  bot.on('login', () => {
    log.ok(`Eingeloggt als ${bot.username} auf ${cfg.server.host} (Minecraft ${bot.version})`)
    // Erst jetzt: Bei automatischer Versionserkennung (server.version = false)
    // steht die Version vor dem Login nicht fest. fillEnchantFallback ist
    // nicht-destruktiv und ueberschreibt die Server-Registry deshalb nie.
    fillEnchantFallback(bot.invcheckerEnchantNames, bot.version)
    modServer.setBotOnline(true)
  })
  bot.on('spawn', () => {
    log.ok(`Verbunden als ${bot.username} auf ${cfg.server.host}. Warte auf Trigger der Mod…`)
    modServer.setBotOnline(true)
  })

  bot.on('kicked', (reason) => log.warn(`Bot wurde gekickt: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`))
  bot.on('error', (err) => log.error(`Bot-Fehler: ${err.message}`))

  // ----------------------------------------------------------- Reconnect
  let shutdown = false
  bot.on('end', (reason) => {
    modServer.setBotOnline(false)
    if (shutdown || !cfg.bot.autoReconnect) return
    const delay = Math.min(cfg.bot.reconnectMaxDelayMs, cfg.bot.reconnectDelayMs * (reconnects + 1))
    reconnects++
    log.warn(`Verbindung beendet (${reason}). Neue Verbindung in ${delay} ms…`)
    setTimeout(() => { if (!shutdown) process.exit(2) }, delay)
  })
  let reconnects = 0

  // ------------------------------------------------------------- Starten
  await modServer.listen()
  // Für Tests/Embedding: laufende Instanz erreichbar machen.
  const instance = { bot, scanner, modServer, cfg, shutdown: async () => { await modServer.close(); try { bot.quit() } catch { /* egal */ } } }
  main.instances.push(instance)
  process.on('SIGINT', async () => {
    shutdown = true
    log.info('Beende…')
    await modServer.close()
    try { bot.quit() } catch { /* egal */ }
    process.exit(0)
  })

  log.info('Bereit. Befehle im Terminal:  invsee <Name>   |   quit')
  if (process.stdin.isTTY && !process.env.INVCHECKER_NO_STDIN) {
    const readline = require('node:readline')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.on('line', (line) => {
      const [cmd, ...rest] = line.trim().split(/\s+/)
      const arg = rest.join(' ')
      switch (cmd) {
        case 'invsee':
          if (!arg) return log.warn('Benutzung: invsee <Spielername>')
          log.info(JSON.stringify(scanner.request(arg, { source: 'cli' })))
          break
        case 'status':
          log.info(`bot=${bot.username} online=${!!bot.entity} wartend=${scanner.pendingCount} modClients=${modServer.clientCount} enchants=${bot.invcheckerEnchantNames.size}`)
          break
        case 'quit':
        case 'exit':
          process.kill(process.pid, 'SIGINT')
          break
        default:
          if (cmd) log.warn('Unbekannt. Verfügbar: invsee <name>, status, quit')
      }
    })
  }

  return instance
}

main.instances = []

function fillEnchantFallback (map, version) {
  if (!version) return
  try {
    const mcData = require('minecraft-data')(version)
    for (const ench of mcData.enchantmentsArray || []) {
      // Nur Luecken fuellen. Die Registry vom Server ist massgeblich und
      // minecraft-data sortiert alphabetisch, liefert also falsche IDs.
      if (!map.has(ench.id)) map.set(ench.id, ench.name)
    }
  } catch { /* keine Daten für die Version – egal, der Server liefert sie */ }
}

if (require.main === module) {
  main().catch((err) => {
    // err.friendly = Meldung ist bereits eine Handlungsanweisung, kein Stacktrace noetig.
    log.error(err.friendly ? err.message : (err.stack || err.message))
    process.exit(1)
  })
}

module.exports = { main, loadConfig }
