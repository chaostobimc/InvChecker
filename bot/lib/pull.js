'use strict'

const log = require('./log')

/**
 * "addpull"-Feature: Die Mod schickt die Position eines Blocks, den der
 * Spieler ansieht. Der Bot läuft (per mineflayer-pathfinder) in Reichweite,
 * schaut den Block an und führt auf Anforderung sofort einen Rechtsklick
 * (activateBlock) darauf aus.
 *
 * Pfadfinden ist optional: Ist mineflayer-pathfinder nicht installiert oder
 * bot.usePathfinder=false, schaut der Bot den Block nur an und versucht den
 * Rechtsklick trotzdem – dann eben nur, wenn er zufällig in Reichweite ist.
 */

let pf = null
try {
  pf = require('mineflayer-pathfinder')
} catch {
  pf = null
}

function attachPullHandler (bot, cfg, respond) {
  let target = null
  let moving = false

  const center = (t) => ({ x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 })

  function pathfinderReady () {
    if (!cfg.bot.usePathfinder) return false
    if (!pf) {
      log.warn('mineflayer-pathfinder nicht installiert – der Bot läuft nicht zum Block. (npm install mineflayer-pathfinder)')
      return false
    }
    if (!bot.pathfinder) {
      try {
        bot.loadPlugin(pf.pathfinder)
      } catch (err) {
        log.warn(`Pathfinder konnte nicht geladen werden: ${err.message}`)
        return false
      }
    }
    return !!bot.pathfinder
  }

  async function addPull (x, y, z) {
    if (![x, y, z].every(Number.isFinite)) {
      respond({ type: 'error', error: 'bad_pull_target', message: 'addpull braucht Zahlen x,y,z.' })
      return { accepted: false }
    }
    target = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }
    const aim = center(target)
    log.ok(`addpull: Ziel ${target.x} ${target.y} ${target.z} gespeichert.`)
    try { await bot.lookAt(aim) } catch { /* egal */ }

    if (pathfinderReady()) {
      try {
        const { Movements, goals } = pf
        const mcData = require('minecraft-data')(bot.version)
        const moves = new Movements(bot, mcData)
        moves.allowSprinting = true
        bot.pathfinder.setMovements(moves)
        bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 3))
        moving = true
        bot.once('goal_reached', () => {
          moving = false
          bot.lookAt(aim).catch(() => {})
          respond({ type: 'pull_status', state: 'arrived', target })
          log.ok('addpull: Bot ist in Reichweite und schaut den Block an.')
        })
        bot.once('path_stop', () => { moving = false })
        respond({ type: 'pull_status', state: 'moving', target })
      } catch (err) {
        moving = false
        log.warn(`Pfad zum Block fehlgeschlagen: ${err.message}`)
        respond({ type: 'pull_status', state: 'path_failed', message: err.message, target })
      }
    } else {
      respond({ type: 'pull_status', state: 'aim_only', target })
    }
    return { accepted: true, target }
  }

  async function pull () {
    if (!target) {
      respond({ type: 'error', error: 'no_pull_target', message: 'Erst /addpull setzen (Block ansehen).' })
      return { ok: false }
    }
    if (moving) {
      respond({ type: 'pull_status', state: 'still_moving', target })
      return { ok: false }
    }
    let block = null
    try {
      const Vec3 = require('vec3')
      block = bot.blockAt(new Vec3(target.x, target.y, target.z))
    } catch (err) {
      respond({ type: 'error', error: 'pull_block_failed', message: err.message })
      return { ok: false }
    }
    if (!block) {
      respond({ type: 'error', error: 'pull_no_block', message: 'Block nicht geladen.' })
      return { ok: false }
    }
    try {
      await bot.lookAt(center(target))
      await bot.activateBlock(block) // Rechtsklick / benutzen
      respond({ type: 'pull_status', state: 'activated', target })
      log.ok(`pull: Rechtsklick auf ${block.name} @ ${target.x} ${target.y} ${target.z}.`)
      return { ok: true }
    } catch (err) {
      respond({ type: 'error', error: 'pull_failed', message: err.message })
      return { ok: false }
    }
  }

  return {
    addPull,
    pull,
    get target () { return target },
    get moving () { return moving }
  }
}

module.exports = { attachPullHandler }
