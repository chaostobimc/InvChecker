# InvChecker – Inventar-Scanner für HugoSMP

Sobald im Chat **"Gegner gefunden: \<Name\>"** auftaucht, führt ein Bot im
Hintergrund `/invsee <Name>` aus, scannt das Inventar und schickt das Ergebnis
in Millisekunden an deine Fabric-Mod. Die zeigt dir im Spiel ein HUD mit allen
Items, der Rüstung und dem Offhand-Slot des Gegners.

```
Minecraft-Client (Fabric-Mod)                     Raspberry Pi 5 (Mineflayer-Bot)
┌────────────────────────────────┐                ┌──────────────────────────────────┐
│ Chat: "[HugoSMP] Gegner        │                │  /invsee Greatcat14              │
│   gefunden: Greatcat14 …"      │   TCP/JSON     │        │                         │
│        │                       │ ─────────────► │        ▼                         │
│        ▼                       │   1 Paket      │  Fenster öffnet sich (9x6)       │
│ TriggerDetector                │                │        │                         │
│        │                       │ ◄───────────── │        ▼                         │
│        ▼                       │   Ergebnis     │  Slots 0-35 lesen (0 Pakete!)    │
│ HUD 15 s: Items, Rüstung,      │                │  → Items, Rüstung, Offhand       │
│ Offhand, Verzauberungen        │                └──────────────────────────────────┘
└────────────────────────────────┘
```

**Gemessene Laufzeit** (End-to-End-Test in diesem Repo, Trigger → fertiges
Ergebnis): **11 ms**, davon 0 ms für den eigentlichen Scan – der Bot liest die
Slots aus dem RAM, es geht kein Paket an den Server. In der Praxis bestimmt die
Ping zwischen Mod und Server, wie schnell das Fenster aufgeht.

---

## Ordner

| Ordner | Inhalt |
| --- | --- |
| [`bot/`](bot/) | Mineflayer-Bot (Node.js) – joint hugosmp.net, führt `/invsee` aus |
| [`mod/`](mod/) | Fabric-Mod für Minecraft 1.21.4 – Trigger, HUD, Einstellungen |
| [`docs/`](docs/) | Setup für den Raspberry Pi, Fernzugriff, Tuning |

---

## 1. Bot starten (Raspberry Pi 5 oder PC)

```bash
cd bot
npm install
npm start
```

Beim **ersten Start** erscheint eine Microsoft-Anmeldung:

```
[warn ] ──────────────────────────────────────────────
[warn ]   Microsoft-Anmeldung erforderlich
[warn ]   To sign in, use a web browser to open the page
[warn ]   https://microsoft.com/link and enter the code ABCD-EFGH
[warn ] ──────────────────────────────────────────────
```

Code auf dem Handy/PC eingeben – danach bleibt die Anmeldung gespeichert
(`bot/.auth-cache`). **Der Bot braucht ein eigenes Microsoft-Konto mit Java
Edition**, sonst kickt der Server ihn (und `/invsee` braucht die passende
Berechtigung auf dem Server).

Wichtige Einstellungen in [`bot/config.json`](bot/config.json):

| Schlüssel | Bedeutung |
| --- | --- |
| `server.host` / `server.port` / `server.version` | `hugosmp.net`, `25565`, `1.21.4` |
| `auth.mode` | `microsoft` (Standard) oder `offline` |
| `invsee.command` | `/invsee {player}` – `{player}` wird ersetzt |
| `invsee.slots` | Welche Slots Inventar / Rüstung / Offhand sind |
| `net.port` / `net.token` | TCP-Port und Passwort für die Mod |
| `net.host` | `0.0.0.0` = von überall erreichbar, `127.0.0.1` = nur lokal |

### Ohne Minecraft testen

```bash
node tools/check.js Greatcat14
```

Das macht exakt dasselbe wie die Mod und druckt das Inventar plus Latenz:

```
✓ Greatcat14 – Fenster "Greatcat14s Inventar" (minecraft:generic_9x6)
  Inventar (6 Stacks):
    Slot  0  Golden Apple x3
    Slot  5  Netherite Sword x1  sharpness V, lure III
    Slot 13  Netherite Chestplate x1  Haltbarkeit 472/592
  Rüstung:  Netherite Helmet, Netherite Chestplate, …
  Offhand:  Shield
  Latenz: gesamt 11 ms
```

---

## 2. Mod installieren

1. **Fabric Loader** für 1.21.4 installieren (<https://fabricmc.net/use>)
2. **Fabric API** `0.119.4+1.21.4` in den `mods`-Ordner legen
3. `invchecker-1.0.0.jar` in denselben `mods`-Ordner legen

Bauen (JDK 21 nötig):

```bash
cd mod
gradle wrapper --gradle-version 8.11.1   # einmalig, falls kein Wrapper vorhanden
./gradlew build                          # Windows: gradlew.bat build
# Ergebnis: mod/build/libs/invchecker-1.0.0.jar
```

Im Spiel:

| Taste | Funktion |
| --- | --- |
| `K` | Einstellungen öffnen |
| `J` | manuell scannen: den Spieler, den du ansiehst (sonst dich selbst – zum Testen der Verbindung) |

In den Einstellungen kannst du **alles** anpassen: Anzeigedauer (Standard
15 s), Position (per Drag & Drop), Größe, Farben, was angezeigt wird
(Verzauberungen, Haltbarkeit, Rüstung, Offhand, Slotnummern), Modus
(*Alles* oder *nur Watchlist*), Sortierung – und die **Item-Liste mit Suche**,
in der du per Klick Items an- und abwählst.

---

## 3. Slot-Layout des invsee-GUIs

Standard in `bot/config.json` (passt zum Screenshot mit 6 Reihen):

```
Reihe 1-4  Slots 0-35   → Inventar des Gegners
Reihe 5    Slots 36-44  → Deko (Barrieren), 39-42 Rüstung, 43 Offhand
Reihe 6    Slots 45-53  → Deko
```

`invsee.ignoreItems` filtert Barrieren, Rüstungsständer und Netherstern
heraus. Wenn dein Server-Plugin ein anderes Layout benutzt, einfach die Zahlen
in `invsee.slots` ändern – der Bot liest nur diese Bereiche.

---

## 4. Sicherheit

Der TCP-Port ist ein offener Port. **Unbedingt** das Token in
`bot/config.json` (`net.token`) **und** in den Mod-Einstellungen auf denselben
zufälligen Wert setzen, z. B.:

```bash
openssl rand -hex 16
```

Ohne gültiges Token trennt der Bot die Verbindung sofort. Wer von außerhalb
deines Netzwerks zugreifen will, liest [`docs/pi-setup.md`](docs/pi-setup.md) –
dort steht, wie du den Pi per Tailscale/WireGuard statt per Portforwarding
erreichbar machst (empfohlen).

---

## Status / Verifikation

| Teil | Stand |
| --- | --- |
| Bot | **Getestet.** `cd bot && npm test` startet einen echten 1.21.4-Fake-Server, der Bot loggt ein, führt `/invsee` aus, scannt das Fenster und antwortet über TCP – 2 Tests, beide grün. |
| `tools/check.js` | **Getestet** gegen den Fake-Server (Ausgabe oben ist echt). |
| Mod | **Nicht kompiliert.** In dieser Arbeitsumgebung gibt es kein JDK/Gradle und keinen Zugriff auf Maven Central / maven.fabricmc.net, `gradlew build` konnte hier also nicht laufen. Alle benutzten Fabric-/Yarn-APIs wurden gegen die Javadocs für **yarn 1.21.4+build.1** und **fabric-api 0.119.4+1.21.4** geprüft (u. a. `HudLayerRegistrationCallback`, `LayeredDrawerWrapper.attachLayerAfter`, `ClientReceiveMessageEvents.GAME/CHAT`, `DrawContext`, `SliderWidget`, `EditBoxWidget`, `ClickableWidget.setTooltip`). |
