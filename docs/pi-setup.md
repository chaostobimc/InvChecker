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
Port im Router offen ist. `net.host` kann dann auf `127.0.0.1` bleiben, wenn
der Bot nur per Tailscale erreichbar sein soll – Tailscale lauscht lokal.

### Variante B: WireGuard auf dem Router

FritzBox & Co. können WireGuard direkt. Eigene IP notieren, in der Mod
eintragen, fertig.

### Variante C: Portforwarding (nur wenn es sein muss)

Router: TCP `8765` → Pi. Dazu **zwingend** ein langes zufälliges Token:

```bash
openssl rand -hex 16
```

Wert in `bot/config.json` (`net.token`) und in den Mod-Einstellungen
eintragen. `net.host` muss `0.0.0.0` sein. Beachte: viele Heimanschlüsse
haben keine öffentliche IPv4 mehr (CGNAT) – dann geht nur A oder B.

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
