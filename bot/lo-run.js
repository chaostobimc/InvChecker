const { startFakeServer, WIN, Item, registry, enchanted } = require('./test/fake-server')
function buildItems () {
  const items = Array.from({ length: WIN.slots }, () => Item.toNotch(null))
  const byName = (n) => registry.itemsByName[n].id
  items[0] = Item.toNotch(new Item(byName('golden_apple'), 3))
  items[5] = enchanted(byName('netherite_sword'), 1, [{ id: 32, level: 5 }])
  const barrier = byName('barrier')
  for (let s = 36; s <= 38; s++) items[s] = Item.toNotch(new Item(barrier, 1))
  items[39] = Item.toNotch(new Item(byName('netherite_helmet'), 1))
  items[43] = Item.toNotch(new Item(byName('shield'), 1))
  return items
}
startFakeServer({ port: 25781, buildItems })
require('./index').main('./lo-cfg.json')
