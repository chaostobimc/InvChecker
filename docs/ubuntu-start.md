# Start auf Ubuntu – Bot und Minecraft auf demselben Rechner

Das ist der einfachste Aufbau: Der Bot läuft auf demselben Linux-Rechner wie
dein Minecraft. Es muss **kein** Port im Router offen sein und kein Tunnel
eingerichtet werden – Bot und Mod sprechen über `127.0.0.1`.

```
┌─────────────────── dein Ubuntu-Rechner ───────────────────┐
│                                                           │
│  Minecraft 1.21.11 ─(Fabric-Mod)──┐                       │
│                                   │ 127.0.0.1:8766        │
│  InvChecker-Bot (Node) ◄──────────┘      (JSON/TCP)       │
│        │                                                  │
└────────┼──────────────────────────────────────────────────┘
         │  25565
         ▼
    hugosmp.net
```

Die Config passt dafür schon: `net.host = 127.0.0.1`, `net.port = 8766`,
`net.token = invchecker-change-me` – und die Mod hat genau dieselben Werte als
Default (`botHost = 127.0.0.1`, `botPort = 8766`, gleiches Token). Du musst also
**nichts** eintragen, damit es läuft.

---

## 1. Node.js 22 installieren

Ubuntu liefert über `apt` eine zu alte Version. `engines` in `bot/package.json`
verlangt `>=22`, und mineflayer 4.38.0 sowie minecraft-protocol 1.68.0 deklarieren
ebenfalls `>=22`.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v        # muss v22.x zeigen
```

## 2. Bot einrichten

```bash
cd ~/InvChecker/bot        # bzw. wohin du das Repo geklont hast
npm install
npm start
```

Beim **allerersten** Start kommt die Microsoft-Anmeldung:

```
──────────────────────────────────────────────────────────────
  Microsoft-Anmeldung erforderlich
  Um dich anzumelden, gehe zu https://www.microsoft.com/link
  und gib den Code ABCD-EFGH ein.
  (einmalig – danach bleibt die Anmeldung in .auth-cache gespeichert)
──────────────────────────────────────────────────────────────
```

Code auf dem Handy oder PC eingeben – fertig. Die Tokens liegen danach in
`bot/.auth-cache`, und jeder spätere Start läuft ohne Eingabe.

Danach sollte dastehen:

```
[ ok  ] TCP für Mod bereit auf 127.0.0.1:8766 (Token: STANDARDWERT – bitte ändern!)
[ ok  ] Enchantment-Registry vom Server übernommen (42 Einträge)
[ ok  ] Verbunden als <DeinBotName> auf hugosmp.net. Warte auf Trigger der Mod…
```

**Terminal offen lassen** – der Bot läuft im Vordergrund. `quit` oder `Strg+C`
beendet ihn.

> Die Warnung `Token: STANDARDWERT` darfst du bei diesem Aufbau ignorieren: Der
> Port ist auf `127.0.0.1` gebunden, kommt also von keinem anderen Gerät
> erreich­bar ins Netz. Ändern musst du das Token erst, wenn du `net.host` auf
> `0.0.0.0` stellst.

## 3. Mod bauen

Dafür brauchst du ein JDK 21:

```bash
sudo apt-get install -y openjdk-21-jdk
java -version      # muss 21.x zeigen

cd ~/InvChecker/mod
gradle wrapper --gradle-version 8.11.1   # einmalig, falls kein Wrapper vorhanden
./gradlew build
# Ergebnis: build/libs/invchecker-1.0.0.jar
```

Ubuntu 22.04 hat `openjdk-21-jdk` eventuell nicht im Standard-Repo – dann
`sudo add-apt-repository ppa:openjdk-r/ppa` oder ein neueres Ubuntu.

## 4. Mod installieren

Der Minecraft-Ordner liegt unter Ubuntu in `~/.minecraft`:

```bash
mkdir -p ~/.minecraft/mods
# 1. Fabric API 0.141.6+1.21.11 von https://modrinth.com/mod/fabric-api
#    (oder https://fabricmc.net/use) in ~/.minecraft/mods legen
cp build/libs/invchecker-1.0.0.jar ~/.minecraft/mods/
ls ~/.minecraft/mods        # beide JARs müssen da liegen
```

**Fabric Loader** für 1.21.11 muss installiert sein (<https://fabricmc.net/use>) –
danach im Minecraft-Launcher das Profil `fabric-loader-1.21.11` auswählen.

## 5. Minecraft starten und prüfen

1. Minecraft 1.21.11 mit Fabric starten
2. Auf **hugosmp.net** verbinden – die Mod ist nur dort aktiv
3. `K` drücken → Einstellungen. Oben steht der Verbindungsstatus
   (`verbunden` / `verbinde erneut in … ms`)
4. `J` drücken, während du einen Spieler ansiehst → dessen Inventar erscheint
   als HUD für 15 s

Reihenfolge ist egal: Die Mod verbindet sich automatisch neu
(`reconnectDelayMs`), falls der Bot noch nicht läuft.

---

## Ohne Minecraft testen

Der Bot kann allein geprüft werden – das geht auch, während er läuft, in einem
zweiten Terminal:

```bash
cd ~/InvChecker/bot
node tools/check.js Greatcat14     # <— durch einen echten Spielernamen ersetzen
```

Das liefert dasselbe Ergebnis wie die Mod, plus Latenzmessung. Ohne
Minecraft-Server zum Testen:

```bash
npm test          # End-to-End-Test gegen einen 1.21.4-Fake-Server
```

## Bot im Hintergrund laufen lassen

Einfachste Variante – eigenes Terminal oder `tmux`:

```bash
tmux new -s invchecker
cd ~/InvChecker/bot && npm start
# abkoppeln: Strg+B dann D   |   wiederholen: tmux attach -t invchecker
```

Als Benutzer-Dienst (startet bei deiner Anmeldung, kein `sudo` nötig):

```bash
mkdir -p ~/.config/systemd/user
NODE_BIN=$(command -v node)          # z. B. /usr/bin/node oder /usr/local/bin/node
echo "node liegt unter: $NODE_BIN"

cat > ~/.config/systemd/user/invchecker-bot.service <<UNIT
[Unit]
Description=InvChecker Bot
After=network-online.target

[Service]
WorkingDirectory=%h/InvChecker/bot
ExecStart=$NODE_BIN index.js
Restart=on-failure
RestartSec=3
Environment=INVCHECKER_NO_STDIN=1

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now invchecker-bot
journalctl --user -u invchecker-bot -f      # Log mitlesen
```

Der Node-Pfad wird hier automatisch eingesetzt, weil er je nach Installation
unterschiedlich ist (`/usr/bin/node` bei NodeSource über `apt`,
`/usr/local/bin/node` bei anderen Wegen). systemd braucht einen absoluten Pfad.

`INVCHECKER_NO_STDIN=1` schaltet die Terminal-Befehle ab, weil ein Dienst kein
Terminal hat. Der erste Microsoft-Login funktioniert ohne Terminal **nicht** –
den also vorher einmal mit `npm start` im Terminal erledigen.

---

## Wenn etwas nicht geht

| Symptom | Ursache / Lösung |
| --- | --- |
| Warnung `EBADENGINE` bei `npm install` | Node ist zu alt. npm warnt nur – der Bot kann dann trotzdem später scheitern → Schritt 1 |
| Bot hängt bei der Code-Ausgabe | Der Gerätecode ist abgelaufen, Bot neu starten |
| `Kein Minecraft-Profil gefunden` | Das Microsoft-Konto besitzt die Java Edition nicht |
| Mod zeigt `verbinde erneut …` dauerhaft | Läuft der Bot? `ss -tlnp \| grep 8766` muss `LISTEN 127.0.0.1:8766` zeigen |
| HUD erscheint nicht | Bist du wirklich auf hugosmp.net? Die Mod ist nur auf Servern aus der `servers`-Liste aktiv |

Fehlercodes, die der Bot selbst meldet (alle aus `lib/mod-server.js` und
`lib/scanner.js`):

| Code | Bedeutung |
| --- | --- |
| `bad_token` | Token in `bot/config.json` und in den Mod-Einstellungen unterscheiden sich |
| `window_timeout` | Der Server hat kein invsee-Fenster geöffnet – meist eine Berechtigungsfrage |
| `chat_failed` | `/invsee` konnte nicht gesendet werden – das Bot-Konto darf den Befehl nicht nutzen, beim Admin freischalten lassen |
| `offline` | Der Bot ist noch nicht mit dem Server verbunden |
| `dedupe` | Derselbe Spieler wurde innerhalb `scan.dedupeWindowMs` schon gescannt |
| `busy` | Die Warteschlange ist voll (`scan.queueSize`, Standard 2) |
| `bad_target` | Ungültiger Spielername (nur `A–Z a–z 0–9 _`, max. 16 Zeichen) |
| `too_many_clients` | Mehr als `net.maxConnections` Mods verbunden (Standard 8) |
| `bad_json` / `unknown_type` | Kaputte oder unbekannte Nachricht – sollte mit der mitgelieferten Mod nicht vorkommen |

## Später doch von unterwegs zugreifen?

Dann `net.host` auf `0.0.0.0` stellen, Token ändern und
[`docs/pi-setup.md`](pi-setup.md) → „4. Von überall zugreifen" lesen.
