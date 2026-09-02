'use strict'

const path = require('node:path')
const log = require('./log')

/**
 * Auth-Optionen für den Bot.
 *
 * Microsoft-Login (Premium) läuft über prismarine-auth im Gerätecode-Flow:
 * Beim allerersten Start wird eine URL plus Code ausgegeben, die man auf einem
 * beliebigen Gerät (Handy/PC) unter https://www.microsoft.com/link eingibt.
 * Die Tokens landen danach in auth.cacheDir, und der Bot meldet sich still an –
 * auch nach einem Reboot des Raspberry Pi. Eine eigene Azure-App-Registrierung
 * ist dafür NICHT nötig: prismarine-auth benutzt im 'live'-Flow die
 * First-Party-Title-ID von Minecraft selbst.
 *
 * Warum hier kein eigener Login steht:
 * minecraft-protocol/src/client/microsoftAuth.js erzeugt IMMER einen eigenen
 * PrismarineAuth und ruft getMinecraftJavaToken() selbst – ein von außen
 * übergebenes `accessToken` wird dort nur gesetzt, nie gelesen. Ein zweiter
 * Login davor wäre also tote Arbeit und würde eine zweite Code-Abfrage
 * auslösen (der Cache liegt dann unter profilesFolder). Deshalb reichen wir
 * nur profilesFolder + onMsaCode durch und lassen den Login einmal laufen.
 *
 * @param {object} cfg geladene Konfiguration
 * @returns {object} Optionen für mineflayer.createBot()
 */
function authOptions (cfg) {
  if (cfg.auth.mode === 'offline') {
    if (!cfg.auth.username) {
      throw new Error('auth.mode = "offline" braucht auth.username in config.json')
    }
    log.warn('Offline-Login – funktioniert nur, wenn der Server im Offline-Modus läuft.')
    return { auth: 'offline', username: cfg.auth.username }
  }

  const profilesFolder = path.resolve(__dirname, '..', cfg.auth.cacheDir)
  const shown = path.relative(process.cwd(), profilesFolder) || profilesFolder

  return {
    auth: 'microsoft',
    // Dient prismarine-auth als Cache-Schlüssel. Der echte Profilname kommt
    // später aus dem Minecraft-Profil und überschreibt client.username.
    username: cfg.auth.username || 'invchecker-bot',
    profilesFolder,
    onMsaCode (res) {
      log.warn('──────────────────────────────────────────────────────────────')
      log.warn('  Microsoft-Anmeldung erforderlich')
      log.warn(`  ${res.message}`)
      log.warn(`  (einmalig – danach bleibt die Anmeldung in ${shown} gespeichert)`)
      log.warn('──────────────────────────────────────────────────────────────')
    }
  }
}

module.exports = { authOptions }
