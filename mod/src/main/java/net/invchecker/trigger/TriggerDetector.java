package net.invchecker.trigger;

import net.invchecker.InvCheckerMod;
import net.invchecker.config.InvCheckerConfig;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;

/**
 * Findet die Duel-Nachricht und schickt den Spielernamen an den Bot.
 *
 * Hauptquelle ist das Chat-/System-Event des Clients (siehe InvCheckerMod) –
 * das ist derselbe Text, der später als "[System] [CHAT] …" im latest.log
 * landet, nur ohne den Umweg über die Festplatte. Das Mitlesen der Logdatei
 * ist als Backup zuschaltbar.
 */
public final class TriggerDetector {

	private final InvCheckerConfig config;
	private final Map<String, Long> lastTrigger = new HashMap<>();
	private long lastMessageMs;

	public TriggerDetector(InvCheckerConfig config) {
		this.config = config;
	}

	/**
	 * @param message eine Chat- oder Systemnachricht, z. B.
	 *                "[HugoSMP] Gegner gefunden: Greatcat14. Welt: Normale Welt. Teleport in 3 Sekunden."
	 * @return true, wenn ein Trigger ausgelöst wurde
	 */
	public boolean onMessage(String message) {
		if (message == null || message.isEmpty()) {
			return false;
		}
		if (config.debug) {
			InvCheckerMod.log("[debug] Nachricht: " + message);
		}
		lastMessageMs = System.currentTimeMillis();
		if (!InvCheckerMod.isEnabled()) {
			return false;
		}
		return fire(message, "chat");
	}

	/** Aufruf aus dem latest.log-Tailer. */
	public boolean onLogLine(String line) {
		if (line == null || line.isEmpty() || !InvCheckerMod.isEnabled()) {
			return false;
		}
		return fire(line, "log");
	}

	/** Manueller Trigger über die Taste – scannt den übergebenen Spielernamen. */
	public void manualTrigger(String target) {
		if (target == null || target.isBlank()) {
			return;
		}
		String name = target.trim().replaceAll("[^A-Za-z0-9_]", "");
		if (name.isEmpty()) {
			return;
		}
		if (!InvCheckerMod.isEnabled()) {
			InvCheckerMod.getScanState().setStatus("Mod ist auf diesem Server deaktiviert", config.errorColor, 3000);
			return;
		}
		send(name, "manual");
	}

	private boolean fire(String text, String source) {
		Matcher matcher = config.pattern().matcher(text);
		if (!matcher.find() || matcher.groupCount() < 1) {
			return false;
		}
		String name = matcher.group(1);
		if (name == null) {
			return false;
		}
		name = name.trim().replaceAll("[^A-Za-z0-9_]", "");
		if (name.isEmpty()) {
			return false;
		}
		long now = System.currentTimeMillis();
		Long previous = lastTrigger.get(name.toLowerCase(java.util.Locale.ROOT));
		if (previous != null && now - previous < Math.max(0, config.dedupeMs)) {
			return false;
		}
		if (lastTrigger.size() > 128) {
			lastTrigger.clear();
		}
		lastTrigger.put(name.toLowerCase(java.util.Locale.ROOT), now);
		send(name, source);
		return true;
	}

	private void send(String name, String source) {
		boolean sent = InvCheckerMod.getConnection().sendTrigger(name, source);
		if (sent) {
			InvCheckerMod.log("Trigger \"" + name + "\" an Bot gesendet (" + source + ")");
			InvCheckerMod.getScanState().setStatus("Scanne " + name + " …", config.highlightColor, 3000);
		} else {
			InvCheckerMod.getScanState().setStatus("Kein Bot verbunden – " + config.botHost + ":" + config.botPort,
					config.errorColor, 4000);
		}
	}

	public long getLastMessageMs() {
		return lastMessageMs;
	}

}
