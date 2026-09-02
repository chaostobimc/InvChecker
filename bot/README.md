# InvChecker Bot

Mineflayer-Bot für Minecraft 1.21.x. Joint einen Server, führt auf Zuruf
`/invsee <spieler>` aus, liest die Slots und schickt das Ergebnis als JSON an
die Fabric-Mod.

```bash
npm install
npm start                    # konfiguriert über config.json
node tools/check.js <name>   # Scan von Hand auslösen (ohne Minecraft)
npm test                     # End-to-End-Test gegen einen 1.21.4-Fake-Server
```

## Self-Host: zwei Aufbauten

Es gibt zwei verschiedene „localhost"-Einstellungen, die zusammenpassen müssen:
`net.host` in `config.json` ist die Schnittstelle, auf der der Bot **lauscht**;
`botHost` in den Mod-Einstellungen ist die Adresse, zu der die Mod **verbindet**.

**Aufbau 1 – Bot und Minecraft auf demselben Rechner** (einfachster Fall):

| Einstellung | Wert |
| --- | --- |
| `bot/config.json` → `net.host` | `127.0.0.1` |
| Mod → Bot-Host | `127.0.0.1` |

Damit ist der Port von keinem anderen Gerät aus erreichbar – nicht im LAN, nicht
von außen. Du kannst beim Standard-Token bleiben, weil niemand von außen
hinkommt. Nachgemessen: Bot an `127.0.0.1:8768` gebunden, Scan über
`127.0.0.1` mit dem Standard-Token → vollständiges Inventar in 9 ms.

**Aufbau 2 – Bot auf dem Pi, Minecraft auf einem anderen Rechner im selben Netz:**

| Einstellung | Wert |
| --- | --- |
| `bot/config.json` → `net.host` | `0.0.0.0` |
| Mod → Bot-Host | LAN-IP des Pi, z. B. `192.168.178.42` |
| `net.token` | **ändern** (`openssl rand -hex 16`) |

Hier **muss** `net.host` auf `0.0.0.0` stehen: Ein auf `127.0.0.1` gebundener
Socket nimmt keine Pakete an, die über eine andere Schnittstelle ankommen.
Nachgemessen: `ss` zeigt `LISTEN 127.0.0.1:8791`, und eine Verbindung auf die
zweite IP desselben Rechners ergibt `ECONNREFUSED`; mit `0.0.0.0` sind beide
Wege offen. Weil der Port dann im LAN offen ist, gehört das Standard-Token
geändert – der Bot warnt beim Start selbst: `Token: STANDARDWERT – bitte ändern!`.

Out of the box passen die Defaults übrigens schon zusammen: Mod `botHost =
127.0.0.1`, `botPort = 8766`, Token `invchecker-change-me` – genau die Werte aus
`config.json`. Für Aufbau 1 musst du also nur `net.host` auf `127.0.0.1` stellen,
wenn du den Port komplett schließen willst.

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
