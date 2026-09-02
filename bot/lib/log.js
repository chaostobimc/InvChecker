'use strict'

/**
 * Winzige Logging-Schicht. Alles mit Millisekunden-Stempel, damit man die
 * Latenzkette (Trigger -> /invsee -> Scan -> Antwort) direkt ablesen kann.
 */

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR

function ts () {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

function write (stream, color, tag, args) {
  const prefix = useColor ? `${COLORS.gray}${ts()}${COLORS.reset} ${color}${tag}${COLORS.reset}` : `${ts()} ${tag}`
  stream.write(`${prefix} ${args.map((a) => (typeof a === 'string' ? a : require('node:util').inspect(a, { depth: 4, colors: useColor }))).join(' ')}\n`)
}

module.exports = {
  info: (...a) => write(process.stdout, COLORS.cyan, '[info ]', a),
  ok: (...a) => write(process.stdout, COLORS.green, '[ ok  ]', a),
  warn: (...a) => write(process.stdout, COLORS.yellow, '[warn ]', a),
  error: (...a) => write(process.stderr, COLORS.red, '[error]', a),
  debug: (...a) => { if (process.env.INVCHECKER_DEBUG) write(process.stdout, COLORS.magenta, '[debug]', a) },
  nowMs: () => Number(process.hrtime.bigint() / 1000000n)
}
