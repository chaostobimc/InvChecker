# InvChecker Mod (Fabric 1.21.4)

Client-Mod: erkennt die Duel-Nachricht, schickt den Namen an den Bot und zeigt
das Ergebnis als HUD.

Bauen (JDK 21):

```bash
gradle wrapper --gradle-version 8.11.1   # einmalig
./gradlew build
```

Tasten: `K` Einstellungen, `J` manueller Scan.

| Datei | Aufgabe |
| --- | --- |
| `InvCheckerMod.java` | Einstieg, Events, Tasten, HUD-Layer |
| `config/InvCheckerConfig.java` | alle Einstellungen, JSON in `config/invchecker.json` |
| `trigger/TriggerDetector.java` | Mustererkennung + Entdoppelung |
| `trigger/LogTailer.java` | optional: `latest.log` mitlesen (Backup) |
| `net/BotConnection.java` | dauerhafte TCP-Verbindung zum Bot |
| `scan/ScanState.java` | letztes Ergebnis, Filter, Sortierung |
| `hud/HudRenderer.java` | HUD zeichnen |
| `gui/*` | Einstellungen, Item-Liste mit Suche, Positions-Editor |
