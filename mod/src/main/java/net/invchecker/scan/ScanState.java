package net.invchecker.scan;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.invchecker.InvCheckerMod;
import net.invchecker.config.InvCheckerConfig;
import net.minecraft.client.MinecraftClient;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Hält das letzte Scan-Ergebnis und entscheidet, was das HUD anzeigt.
 * Alle Methoden, die den Zustand ändern, laufen auf dem Client-Thread.
 */
public final class ScanState {

	private final InvCheckerConfig config;

	private ScanResult current;
	/** Nur für den Positions-Editor: Vorschau-Ergebnis statt echter Daten. */
	private ScanResult preview;
	private List<ScanResult.Entry> visible = new ArrayList<>();
	private long hideAtMs;
	private String statusText;
	private long statusUntilMs;
	private int statusColor;
	private long lastScanAtMs;
	/** Layout-Cache für das HUD – wird nur bei neuen Daten oder geänderten Einstellungen neu gerechnet. */
	private int layoutWidth = -1;
	private int layoutHeight = -1;
	private long layoutVersion = -1;
	private long configVersion;

	public ScanState(InvCheckerConfig config) {
		this.config = config;
	}

	/** Wird vom Socket-Thread aufgerufen. */
	public void onResult(JsonObject json) {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null) {
			return;
		}
		client.execute(() -> apply(json));
	}

	private void apply(JsonObject json) {
		boolean ok = json.has("ok") && json.get("ok").getAsBoolean();
		String target = json.has("target") ? json.get("target").getAsString() : "?";

		if (!ok) {
			String error = json.has("error") ? json.get("error").getAsString() : "unbekannt";
			String message = json.has("message") ? json.get("message").getAsString() : error;
			current = null;
			visible = new ArrayList<>();
			setStatus("Scan fehlgeschlagen (" + error + "): " + message, config.errorColor, 6000);
			InvCheckerMod.log("Scan fehlgeschlagen für " + target + ": " + message);
			return;
		}

		ScanResult result = parse(json);
		current = result;
		lastScanAtMs = System.currentTimeMillis();
		hideAtMs = lastScanAtMs + (long) (config.displaySeconds * 1000.0D);
		rebuildVisible();
		setStatus(null, 0, 0);
		InvCheckerMod.log("Inventar von " + result.target + " empfangen: " + result.items.size() + " Stacks in "
				+ result.totalMs + " ms");
	}

	private ScanResult parse(JsonObject json) {
		ScanResult result = new ScanResult();
		result.target = string(json, "target", "?");
		result.targetName = string(json, "targetName", result.target);
		result.windowTitle = string(json, "windowTitle", "");
		result.titleMatched = json.has("titleMatched") && json.get("titleMatched").getAsBoolean();
		result.windowType = string(json, "windowType", "");
		result.items = entries(json, "items");
		result.armor = entries(json, "armor");
		result.offhand = entries(json, "offhand");
		result.receivedAtMs = System.currentTimeMillis();
		if (json.has("timings") && json.get("timings").isJsonObject()) {
			JsonObject timings = json.getAsJsonObject("timings");
			result.totalMs = timings.has("totalMs") ? timings.get("totalMs").getAsLong() : -1;
			result.commandToWindowMs = timings.has("commandToWindowMs") ? timings.get("commandToWindowMs").getAsLong() : -1;
			result.windowToReadMs = timings.has("windowToReadMs") ? timings.get("windowToReadMs").getAsLong() : -1;
		}
		return result;
	}

	private static List<ScanResult.Entry> entries(JsonObject json, String key) {
		List<ScanResult.Entry> list = new ArrayList<>();
		if (!json.has(key) || !json.get(key).isJsonArray()) {
			return list;
		}
		JsonArray array = json.getAsJsonArray(key);
		for (JsonElement element : array) {
			if (!element.isJsonObject()) {
				continue;
			}
			JsonObject item = element.getAsJsonObject();
			ScanResult.Entry entry = new ScanResult.Entry();
			entry.slot = item.has("s") ? item.get("s").getAsInt() : -1;
			entry.id = string(item, "id", "minecraft:air");
			entry.name = string(item, "n", entry.id);
			entry.customName = item.has("cn") ? item.get("cn").getAsString() : null;
			entry.count = item.has("c") ? item.get("c").getAsInt() : 1;
			entry.durability = item.has("d") ? item.get("d").getAsString() : null;
			if (item.has("e") && item.get("e").isJsonArray()) {
				for (JsonElement enchant : item.getAsJsonArray("e")) {
					entry.enchants.add(enchant.getAsString());
				}
			}
			list.add(entry);
		}
		return list;
	}

	private static String string(JsonObject json, String key, String fallback) {
		return json.has(key) && !json.get(key).isJsonNull() ? json.get(key).getAsString() : fallback;
	}

	public void setStatus(String text, int color, long durationMs) {
		statusText = text;
		statusColor = color;
		statusUntilMs = text == null ? 0 : System.currentTimeMillis() + durationMs;
	}

	public void tick(MinecraftClient client) {
		long now = System.currentTimeMillis();
		if (current != null && now >= hideAtMs) {
			current = null;
			visible = new ArrayList<>();
		}
		if (statusText != null && now >= statusUntilMs) {
			statusText = null;
		}
	}

	/** Muss aufgerufen werden, wenn sich Einstellungen ändern, die das HUD betreffen. */
	public void invalidateLayout() {
		configVersion++;
		rebuildVisible();
	}

	public int getLayoutWidth() {
		return layoutWidth;
	}

	public int getLayoutHeight() {
		return layoutHeight;
	}

	public long getLayoutVersion() {
		return layoutVersion;
	}

	public void setLayout(int width, int height, long version) {
		layoutWidth = width;
		layoutHeight = height;
		layoutVersion = version;
	}

	public long getConfigVersion() {
		return configVersion;
	}

	/** Filter + Sortierung nach den aktuellen Einstellungen. */
	public void rebuildVisible() {
		List<ScanResult.Entry> list = new ArrayList<>();
		if (current == null) {
			visible = list;
			return;
		}
		// "watchlist" mit leerer Liste wuerde alles ausblenden ("(leer)") – dann
		// lieber alles zeigen, bis der Spieler tatsaechlich etwas gemerkt hat.
		boolean watchOnly = "watchlist".equals(config.mode)
				&& config.watchlist != null && !config.watchlist.isEmpty();
		for (ScanResult.Entry entry : current.items) {
			if (watchOnly && !config.isWatched(entry.id)) {
				continue;
			}
			list.add(entry);
		}
		Comparator<ScanResult.Entry> comparator;
		switch (config.sort == null ? "count" : config.sort) {
			case "name":
				comparator = Comparator.comparing(entry -> entry.name.toLowerCase(java.util.Locale.ROOT));
				break;
			case "slot":
				comparator = Comparator.comparingInt(entry -> entry.slot);
				break;
			case "count":
			default:
				comparator = (a, b) -> Integer.compare(b.count, a.count);
				break;
		}
		// Gemerkte Items immer zuerst, damit man sie sofort sieht.
		list.sort(Comparator.<ScanResult.Entry, Boolean>comparing(entry -> !config.isWatched(entry.id)).thenComparing(comparator));
		if (config.maxEntries > 0 && list.size() > config.maxEntries) {
			list = new ArrayList<>(list.subList(0, config.maxEntries));
		}
		visible = list;
	}

	public ScanResult getCurrent() {
		return preview != null ? preview : current;
	}

	public void setPreview(ScanResult result) {
		if (preview != result) {
			preview = result;
			rebuildVisible();
		}
	}

	public void clearPreview() {
		if (preview != null) {
			preview = null;
			rebuildVisible();
		}
	}

	public List<ScanResult.Entry> getVisibleEntries() {
		return visible;
	}

	/** Restliche Anzeigedauer in Sekunden. */
	public double remainingSeconds() {
		if (preview != null) {
			return config.displaySeconds;
		}
		if (current == null) {
			return 0.0D;
		}
		return Math.max(0.0D, (hideAtMs - System.currentTimeMillis()) / 1000.0D);
	}

	public boolean isVisible() {
		return getCurrent() != null;
	}

	public String getStatusText() {
		return statusText;
	}

	public int getStatusColor() {
		return statusColor;
	}

	public long getLastScanAtMs() {
		return lastScanAtMs;
	}

	public void clear() {
		current = null;
		visible = new ArrayList<>();
		statusText = null;
	}
}
