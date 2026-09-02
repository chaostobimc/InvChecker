# InvChecker Bot

Mineflayer-Bot für Minecraft 1.21.4. Joint einen Server, führt auf Zuruf
`/invsee <spieler>` aus, liest die Slots und schickt das Ergebnis als JSON an
die Fabric-Mod.

```bash
npm install
npm start                    # konfiguriert über config.json
node tools/check.js <name>   # Scan von Hand auslösen (ohne Minecraft)
npm test                     # End-to-End-Test gegen einen 1.21.4-Fake-Server
```

## Module

| Datei | Aufgabe |
| --- | --- |
| `index.js` | Einstieg: Login, Reconnect, Verdrahtung, Terminal-Befehle |
| `lib/config.js` | `config.json` laden + Defaults |
| `lib/auth.js` | Microsoft-Gerätecode-Login mit lokalem Token-Cache |
| `lib/scanner.js` | `/invsee` senden, Fenster abwarten, Slots lesen |
| `lib/items.js` | prismarine-item → kompaktes JSON (Enchants, Haltbarkeit, Name) |
| `lib/mod-server.js` | TCP-Server für die Mod (eine JSON-Zeile pro Nachricht) |
| `lib/trigger.js` | optionaler Chat-Trigger direkt auf dem Bot (Backup) |
| `test/` | Fake-Server + End-to-End-Test |

## Protokoll

Eine JSON-Zeile pro Nachricht, `\n` getrennt, UTF-8.

```
Mod → Bot   {"type":"trigger","token":"…","target":"Greatcat14","triggerAt":1730000000000,"source":"chat"}
Bot → Mod   {"type":"result","ok":true,"target":"Greatcat14","items":[{"s":0,"id":"minecraft:golden_apple","n":"Golden Apple","c":3}],…}
```

Feld-Abkürzungen im Ergebnis: `s` Slot, `id` Item-ID, `n` Anzeigename,
`c` Anzahl, `cn` eigener Name, `e` Verzauberungen, `d` Haltbarkeit.
