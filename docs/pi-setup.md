# Bot auf dem Raspberry Pi 5 einrichten

## Reicht der Pi 5 (8 GB)?

Ja, locker. Mineflayer rendert nichts und lädt keine Chunks
(`viewDistance: "tiny"`, Physik ausgeschaltet) – der Prozess liegt im
Normalbetrieb bei **ca. 100–250 MB RAM** und praktisch 0 % CPU, solange kein
Duel läuft. Zum Vergleich: Minecraft selbst braucht auf dem Client 2–4 GB.

## 1. Node.js 22 installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v      # muss v22.x zeigen
```

## 2. Bot einrichten

```bash
mkdir -p ~/invchecker && cd ~/invchecker
# bot/ aus dem Repo hierher kopieren, dann:
cd bot
npm install
npm start          # ersten Microsoft-Login durchführen
```

Danach mit `Strg+C` beenden und als Dienst einrichten:

```bash
sudo nano /etc/systemd/system/invchecker-bot.service
```

```ini
[Unit]
Description=InvChecker Mineflayer Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/invchecker/bot
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
# reicht völlig, schützt aber vor Ausreißern
MemoryMax=512M
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now invchecker-bot
journalctl -u invchecker-bot -f      # Live-Log
```

## 3. Latenz – wo die Zeit wirklich hingeht

Gemessen in diesem Repo (Trigger → fertiges Ergebnis): **11 ms**. Die Kette:

| Schritt | Dauer |
| --- | --- |
| Mod erkennt die Chatzeile | < 1 ms (Event, kein Log-Polling) |
| TCP-Paket Mod → Bot | ~0 ms lokal, sonst = halbe Ping |
| Bot schreibt `/invsee` | ~1 ms |
| **Server öffnet das Fenster** | **= 1× Ping Bot ↔ Server** |
| Slots lesen + JSON bauen | 0–1 ms |
| TCP-Paket Bot → Mod | ~0 ms lokal, sonst = halbe Ping |
| HUD zeichnen | < 1 ms |

Der **einzige** nennenswerte Block ist die Runde Bot ↔ Minecraft-Server.
Daraus folgen zwei Dinge:

1. **Am schnellsten ist der Bot auf demselben Rechner wie dein Minecraft.**
   Dann ist die Mod↔Bot-Strecke 0 ms und du zahlst nur die Ping zum Server –
   die zahlst du sowieso. Auf dem Pi im selben LAN sind es ~1 ms extra, auch
   okay.
2. **Der Bot sollte möglichst nah am Server stehen.** Steht der Server in
   Deutschland und der Pi auch, sind das typisch 10–30 ms pro Richtung.

## 4. Von überall zugreifen (Mod → Bot)

Die Mod verbindet sich mit `botHost:botPort`. Damit das von unterwegs
funktioniert, brauchst du einen Weg zum Pi. **Empfohlen: VPN, kein
Portforwarding** – ein offener Port mit einem erratenen Token ist ein
eingeladenes Einfallstor.

### Variante A: Tailscale (am einfachsten)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4        # z. B. 100.101.102.103
```

In den Mod-Einstellungen `botHost = 100.101.102.103` eintragen. Tailscale auf
dem Laptop/Handy installiert → funktioniert aus jedem Netz, ohne dass ein
Port im Router offen ist. Der Traffic ist automatisch verschlüsselt (WireGuard),
dein Token liegt also nie im Klartext im Netz.

> **Achtung, `net.host` muss `0.0.0.0` bleiben.** Tailscale liefert Pakete über
> das Interface `tailscale0` mit Zieladresse `100.x.x.x` an – ein auf
> `127.0.0.1` gebundener Socket nimmt die nicht an. Nachgemessen: Server an
> `127.0.0.1` gebunden → Verbindung über die andere IP ergibt `ECONNREFUSED`;
> an `0.0.0.0` gebunden → beide Wege verbunden. Wer den Port *nicht* im LAN
> offen haben will, bindet konkret auf die Tailscale-IP: `net.host =
> "100.101.102.103"`.

### Variante B: WireGuard auf dem Router

FritzBox & Co. können WireGuard direkt. Eigene IP notieren, in der Mod
eintragen, fertig.

### Variante C: Portforwarding (nur wenn es sein muss)

Router: TCP `8766` → Pi. Dazu **zwingend** ein langes zufälliges Token:

```bash
openssl rand -hex 16
```

Wert in `bot/config.json` (`net.token`) und in den Mod-Einstellungen
eintragen. `net.host` muss `0.0.0.0` sein. Beachte: viele Heimanschlüsse
haben keine öffentliche IPv4 mehr (CGNAT) – dann geht nur A oder B.

### Variante D: ngrok (geht, aber mit drei Haken)

```bash
ngrok tcp 8766
# Ausgabe: Forwarding  tcp://1.tcp.ngrok.io:12345 -> localhost:8766
```

In den Mod-Einstellungen `botHost = 1.tcp.ngrok.io` und `botPort = 12345`
eintragen. Die Mod löst Hostnamen per DNS auf (`new InetSocketAddress(host,
port)` in `net/BotConnection.java`), ein ngrok-Hostname funktioniert also direkt.
`net.host` kann hier auf `127.0.0.1` bleiben – der ngrok-Agent holt sich den
Traffic lokal ab, es muss kein Port im Router offen sein.

Die drei Haken, laut [ngroks eigener Doku](https://ngrok.com/docs/using-ngrok-with/minecraft#minecraft-on-ngroks-free-plan):

1. **Kreditkarte nötig.** Für TCP-Endpunkte im Free-Tier verlangt ngrok eine
   hinterlegte Kredit-/Debitkarte (wird nicht belastet, dient der Missbrauchsbekämpfung).
2. **Keine feste TCP-Adresse.** Nach jedem Neustart des Agents – also nach jedem
   Pi-Reboot – gibt es einen neuen `host:port`. Feste TCP-Adressen gibt es erst
   im Bezahltarif.
3. **Bandbreite begrenzt.** Ist sie aufgebraucht, kommt niemand mehr durch.

Punkt 2 ist der nervigste für einen Dauerbetrieb. Erleichterung: Die Mod merkt
eine geänderte Adresse selbst und verbindet neu, ohne dass du Minecraft neu
starten musst (`Bot-Adresse geändert – verbinde neu mit …` in `BotConnection.java`).

**Datenvolumen ist hier kein Thema** – nachgemessen über die echte
TCP-Schnittstelle kostet ein kompletter Scan **1419 Bytes** (`hello` 119 +
`result` 1300). Bei 1 GB/Monat sind das rund 756.000 Scans.

> **Sicherheitsbefund: Dein Token geht bei ngrok im Klartext raus.**
> Das Protokoll schickt das Token in jeder Nachricht mit (`msg.token` in
> `lib/mod-server.js`). Bei einem rohen TCP-Endpunkt verschlüsselt ngrok nur die
> Strecke Agent↔Edge („Agent-to-edge connections use TLS 1.2+",
> [ngrok.com/security](https://ngrok.com/security)); die Strecke von deinem
> Minecraft-Client zum ngrok-Edge ist unverschlüsselt, weil das Protokoll selbst
> kein TLS spricht. Wer mitlesen kann, hat das Token und kann Scans auslösen und
> Ergebnisse lesen. Tailscale/WireGuard (Variante A/B) verschlüsseln genau diese
> Strecke automatisch. Falls du ngrok trotzdem dauerhaft nutzen willst: sag
> Bescheid, dann baue ich TLS in `mod-server.js` und `BotConnection.java` ein.

## 5. Tuning, wenn es schneller sein soll

| Schraube | Wirkung |
| --- | --- |
| `bot.viewDistance: "tiny"` (Standard) | weniger Chunk-Daten, weniger CPU/RAM |
| `bot.physicsEnabled: false` (Standard) | keine Bewegungs-Berechnung |
| `scan.dedupeWindowMs` | kleiner = gleiche Gegner können öfter gescannt werden |
| `scan.minIntervalMs` | auf `0` lassen, sonst künstliche Bremse |
| `invsee.windowTimeoutMs` | nur die Fehlermeldung, nicht die Geschwindigkeit |
| `net.logTraffic: false` (Standard) | kein Logging pro Trigger |
| Mod: `logTailing: false` (Standard) | keine Festplatten-Abfrage alle 50 ms |

Was **nicht** hilft: UDP statt TCP (ein Paket hin, eines zurück – der
Unterschied liegt unter einer Millisekunde, dafür verlierst du die
Zuverlässigkeit), oder den Bot "näher" an den Chat zu bringen – die Mod liest
die Nachricht bereits aus dem Event, bevor sie im Chat gerendert wird.

## 6. Fehler suchen

```bash
journalctl -u invchecker-bot -n 100     # Was macht der Bot?
node tools/check.js Greatcat14          # Scan von Hand auslösen
```

| Symptom | Ursache |
| --- | --- |
| `window_timeout` | Bot hat keine `/invsee`-Berechtigung, Spieler ist offline, oder der Befehl heißt anders (`invsee.command` anpassen) |
| `bad_token` | Token in Mod und `bot/config.json` unterschiedlich |
| Mod: "keine Verbindung" | Bot läuft nicht, falsche IP/Port, oder Firewall/CGNAT |
| Rüstung/Offhand leer | Slot-Bereiche in `invsee.slots` passen nicht zum Plugin-GUI |
| Enchantment heißt `enchantment_7` | Server hat keine Registry geschickt – Bot neu verbinden |
