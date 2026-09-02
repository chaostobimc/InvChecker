'use strict'

/**
 * Serialisierung von prismarine-item Instanzen in das kompakte JSON, das die
 * Mod bekommt. Läuft bewusst allocationsarm: pro Scan werden nur die Slots
 * angefasst, die wirklich belegt sind.
 */

/**
 * Macht aus allem, was Minecraft als Text schicken kann, einen flachen String:
 *  - "Hallo"
 *  - '{"text":"a","extra":[{"text":"b"}]}'
 *  - prismarine-nbt Strukturen: { type:'compound', value:{ text:{type:'string',value:'a'} } }
 */
function flattenText (input, depth = 0) {
  if (input === null || input === undefined || depth > 8) return ''
  if (typeof input === 'string') {
    const t = input.trim()
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return flattenText(JSON.parse(t), depth + 1)
      } catch { /* kein JSON, einfach durchreichen */ }
    }
    return input
  }
  if (typeof input === 'number' || typeof input === 'boolean') return String(input)
  if (Array.isArray(input)) return input.map((e) => flattenText(e, depth + 1)).join('')
  if (typeof input === 'object') {
    // prismarine-nbt Knoten
    if (input.type && 'value' in input) {
      const t = input.type
      if (t === 'string' || t === 'int' || t === 'short' || t === 'byte' || t === 'float' || t === 'double' || t === 'long') {
        return String(input.value)
      }
      if (t === 'list') return flattenText(input.value, depth + 1)
      if (t === 'compound') return flattenText(input.value, depth + 1)
    }
    let out = ''
    if (typeof input.text === 'string' || typeof input.text === 'object') out += flattenText(input.text, depth + 1)
    if (input.translate) out += flattenText(input.translate, depth + 1)
    if (input.extra) out += flattenText(input.extra, depth + 1)
    if (input.with) out += flattenText(input.with, depth + 1)
    if (input.contents) out += flattenText(input.contents, depth + 1)
    if (input.fallback) out += flattenText(input.fallback, depth + 1)
    return out
  }
  return ''
}

/** enchantments-Komponente robust auslesen – Datenform variiert je nach Version. */
function readEnchants (item) {
  const comp = item.componentMap?.get('enchantments')
  if (!comp) return []
  let raw = comp.data
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    raw = raw.enchantments ?? raw.levels ?? raw.value ?? []
  }
  if (!Array.isArray(raw)) return []
  const out = []
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue
    const id = typeof e.id === 'object' && e.id !== null ? e.id.value : e.id
    const name = typeof e.name === 'object' && e.name !== null ? e.name.value : e.name
    const lvlRaw = e.level ?? e.lvl ?? 1
    const lvl = typeof lvlRaw === 'object' && lvlRaw !== null ? lvlRaw.value : lvlRaw
    out.push({ id: typeof id === 'number' ? id : undefined, name: typeof name === 'string' ? name : undefined, lvl: Number(lvl) || 1 })
  }
  return out
}

/**
 * @param {object} item  prismarine-item Instanz
 * @param {object} mcData minecraft-data Instanz der Serverversion
 * @param {Map<number,string>} enchantNames  Netz-Registry-ID -> Name
 */
function serializeItem (item, mcData, enchantNames, slot) {
  const base = mcData.items[item.type]
  const entry = {
    s: slot,
    id: base ? `minecraft:${base.name}` : `unknown:${item.type}`,
    n: base ? base.displayName : `Unknown ${item.type}`,
    c: item.count
  }

  const customName = item.customName ? flattenText(item.customName).trim() : ''
  if (customName && customName !== entry.n) entry.cn = customName

  const enchants = readEnchants(item)
  if (enchants.length) {
    entry.e = enchants.map((e) => {
      const name = e.name || (typeof e.id === 'number' ? enchantNames.get(e.id) : null) || (typeof e.id === 'number' ? `enchantment_${e.id}` : 'unknown')
      return e.lvl > 1 ? `${name} ${roman(e.lvl)}` : name
    })
  }

  const maxDur = base?.maxDurability
  if (maxDur) {
    let used = null
    try { used = item.durabilityUsed } catch { used = null }
    if (typeof used === 'number' && used > 0) {
      entry.d = `${maxDur - used}/${maxDur}`
    }
  }

  const potion = item.componentMap?.get('potion_contents')?.data
  if (potion) {
    const p = typeof potion === 'object' ? (potion.potionId ?? potion.potion ?? potion.customPotionColor) : potion
    if (p !== undefined && p !== null) entry.p = String(typeof p === 'object' && p.value !== undefined ? p.value : p)
  }

  return entry
}

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
function roman (n) {
  return ROMAN[n] ?? String(n)
}

module.exports = { serializeItem, flattenText, readEnchants }
