'use strict'

const fs = require('node:fs')
const path = require('node:path')
const log = require('./log')

/**
 * Microsoft-Login für den Bot.
 *
 * prismarine-auth nutzt den Gerätecode-Flow: Beim allerersten Start wird eine
 * URL plus Code ausgegeben, die man auf einem beliebigen Gerät
 * (Handy/PC) eingibt. Danach liegen die Tokens in auth.cacheDir und der Bot
 * meldet sich still an – auch nach einem Reboot des Raspberry Pi.
 */
async function microsoftLogin (cfg) {
  const { Authflow, Titles } = require('prismarine-auth')
  const cacheDir = path.resolve(__dirname, '..', cfg.auth.cacheDir)
  fs.mkdirSync(cacheDir, { recursive: true })

  const flow = new Authflow(
    cfg.auth.username || 'invchecker-bot',
    cacheDir,
    { flow: 'live', authTitle: Titles.MinecraftJava, deviceType: 'NintendoSwitch' },
    (res) => {
      log.warn('──────────────────────────────────────────────────────────────')
      log.warn('  Microsoft-Anmeldung erforderlich')
      log.warn(`  ${res.message}`)
      log.warn('  (einmalig – danach bleibt die Anmeldung gespeichert)')
      log.warn('──────────────────────────────────────────────────────────────')
    }
  )

  const { token, profile } = await flow.getMinecraftJavaToken({ fetchProfile: true })
  if (!profile || !profile.name) throw new Error('Microsoft-Login erfolgreich, aber es wurde kein Minecraft-Profil gefunden (besitzt das Konto Java Edition?).')
  return { accessToken: token, username: profile.name, uuid: profile.id }
}

module.exports = { microsoftLogin }
