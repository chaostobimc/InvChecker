package net.invchecker.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.invchecker.InvCheckerMod;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Alles, was man an der Mod einstellen kann, liegt hier und wird als JSON in
 * .minecraft/config/invchecker.json gespeichert.
 */
public final class InvCheckerConfig {

	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

	// ------------------------------------------------------------------ Allgemein
	/** Hauptschalter der Mod. */
	public boolean enabled = true;
	/** Nur auf diesen Servern aktiv. "*" = überall. */
	public List<String> servers = new ArrayList<>(Arrays.asList("hugosmp.net"));

	// ------------------------------------------------------------------ Bot-Verbindung
	public String botHost = "127.0.0.1";
	public int botPort = 8766;
	public String token = "invchecker-change-me";
	/** Millisekunden zwischen zwei Verbindungsversuchen. */
	public int reconnectDelayMs = 1500;

	// ------------------------------------------------------------------ Auslöser
	/**
	 * Muster für die Duel-Nachricht. Gruppe 1 muss der Spielername sein.
	 * Beispielzeile:
	 * [14:59:12] [Render thread/INFO]: [System] [CHAT] [HugoSMP] Gegner gefunden: Greatcat14. Welt: Normale Welt.
	 */
	public String triggerPattern = "Gegner gefunden:\\s*([A-Za-z0-9_]{1,16})";
	/** Doppelte Treffer innerhalb dieses Fensters ignorieren (Millisekunden). */
	public int dedupeMs = 1200;
	/** latest.log zusätzlich mitlesen (Backup, kostet etwas Platten-I/O). */
	public boolean logTailing = false;
	public String logPath = "logs/latest.log";
	/** Jede Chat-/Systemzeile ins Spiel-Log schreiben – nur zur Fehlersuche. */
	public boolean debug = false;

	// ------------------------------------------------------------------ Anzeige
	/** Wie lange das HUD sichtbar bleibt (Sekunden). */
	public double displaySeconds = 15.0D;
	/** Position in Prozent der Bildschirmbreite/-höhe (0..1). */
	public double posX = 0.5D;
	public double posY = 0.25D;
	public float scale = 1.0F;

	public boolean showBackground = true;
	public int backgroundAlpha = 170;
	public boolean showShadow = true;
	public boolean showArmor = true;
	public boolean showOffhand = true;
	public boolean showSlotNumber = false;
	public boolean showCount = true;
	public boolean showEnchants = true;
	public boolean showDurability = true;
	public boolean showLatency = true;
	public int maxEntries = 24;

	/** "watchlist" = nur gemerkte Items, "all" = alles (Watchlist wird hervorgehoben). */
	public String mode = "all";
	/** "count" = nach Anzahl, "name" = alphabetisch, "slot" = nach Slot. */
	public String sort = "count";

	public int titleColor = 0xFFFF5555;
	public int normalColor = 0xFFFFFFFF;
	public int highlightColor = 0xFFFFAA00;
	public int dimColor = 0xFFAAAAAA;
	public int errorColor = 0xFFFF5555;

	/** Item-IDs ("minecraft:diamond"), die besonders wichtig sind. */
	public Set<String> watchlist = new LinkedHashSet<>();

	private transient Path file;
	private transient java.util.regex.Pattern compiledPattern;
	private transient String compiledPatternSource;

	public static InvCheckerConfig load(Path path) {
		InvCheckerConfig config = null;
		try {
			if (Files.exists(path)) {
				String json = Files.readString(path, StandardCharsets.UTF_8);
				config = GSON.fromJson(json, InvCheckerConfig.class);
			}
		} catch (Exception error) {
			InvCheckerMod.logError("config konnte nicht gelesen werden, Defaults werden benutzt", error);
		}
		if (config == null) {
			config = new InvCheckerConfig();
		}
		config.file = path;
		config.compiledPatternSource = null;
		config.save();
		return config;
	}

	public void save() {
		if (file == null) {
			return;
		}
		try {
			Files.createDirectories(file.getParent());
			Files.writeString(file, GSON.toJson(this), StandardCharsets.UTF_8);
		} catch (IOException error) {
			InvCheckerMod.logError("config konnte nicht gespeichert werden", error);
		}
	}

	/** Das (gecachte) Muster für die Duel-Nachricht. */
	public java.util.regex.Pattern pattern() {
		if (compiledPattern == null || !triggerPattern.equals(compiledPatternSource)) {
			try {
				compiledPattern = java.util.regex.Pattern.compile(triggerPattern);
				compiledPatternSource = triggerPattern;
			} catch (Exception error) {
				InvCheckerMod.logError("triggerPattern ist ungültig: " + triggerPattern, error);
				compiledPattern = java.util.regex.Pattern.compile("Gegner gefunden:\\s*([A-Za-z0-9_]{1,16})");
				compiledPatternSource = triggerPattern;
			}
		}
		return compiledPattern;
	}

	/** Passt die Serveradresse (z. B. "hugosmp.net:25565") auf die Konfiguration? */
	public boolean matchesServer(String address) {
		if (servers == null || servers.isEmpty()) {
			return false;
		}
		String host = normalize(address);
		if (host.isEmpty()) {
			return false;
		}
		for (String entry : servers) {
			String candidate = normalize(entry);
			if (candidate.isEmpty()) {
				continue;
			}
			if (candidate.equals("*") || candidate.equals(host)) {
				return true;
			}
			// "hugosmp.net" soll auch auf "play.hugosmp.net" passen
			if (candidate.startsWith("*.") && host.endsWith(candidate.substring(1))) {
				return true;
			}
		}
		return false;
	}

	private static String normalize(String address) {
		if (address == null) {
			return "";
		}
		String value = address.trim().toLowerCase(Locale.ROOT);
		if (value.startsWith("srv.")) {
			value = value.substring(4);
		}
		int colon = value.lastIndexOf(':');
		if (colon > 0 && colon == value.length() - 6) {
			value = value.substring(0, colon);
		}
		while (value.endsWith("/")) {
			value = value.substring(0, value.length() - 1);
		}
		return value;
	}

	public boolean isWatched(String itemId) {
		return watchlist != null && watchlist.contains(itemId);
	}

	public void toggleWatched(String itemId) {
		if (watchlist == null) {
			watchlist = new LinkedHashSet<>();
		}
		if (!watchlist.remove(itemId)) {
			watchlist.add(itemId);
		}
		save();
	}
}
