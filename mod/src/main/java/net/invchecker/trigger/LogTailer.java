package net.invchecker.trigger;

import net.fabricmc.loader.api.FabricLoader;
import net.invchecker.InvCheckerMod;
import net.invchecker.config.InvCheckerConfig;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Liest neue Zeilen aus .minecraft/logs/latest.log und gibt sie an den
 * TriggerDetector weiter.
 *
 * Standardmäßig AUS: Das Chat-/System-Event des Clients liefert exakt dieselbe
 * Zeile ("[System] [CHAT] [HugoSMP] Gegner gefunden: …") ohne Festplatten-I/O
 * und ohne die Polling-Verzögerung. Der Tailer ist nur ein Backup für den
 * Fall, dass die Nachricht den Client-Chat nicht erreicht.
 */
public final class LogTailer implements Runnable {

	private final InvCheckerConfig config;
	private final TriggerDetector detector;
	private volatile boolean enabled;
	private volatile boolean running = true;
	private long offset;
	private String watchedPath = "";

	public LogTailer(InvCheckerConfig config, TriggerDetector detector) {
		this.config = config;
		this.detector = detector;
	}

	public void start() {
		Thread thread = new Thread(this, "InvChecker-LogTailer");
		thread.setDaemon(true);
		thread.start();
	}

	public void setEnabled(boolean enabled) {
		this.enabled = enabled;
	}

	public void stop() {
		running = false;
	}

	@Override
	public void run() {
		while (running) {
			try {
				if (!enabled) {
					offset = 0;
					watchedPath = "";
					Thread.sleep(500);
					continue;
				}
				Path path = resolvePath();
				if (path == null || !Files.exists(path)) {
					Thread.sleep(1000);
					continue;
				}
				String key = path.toString();
				if (!key.equals(watchedPath)) {
					watchedPath = key;
					// Beim ersten Öffnen ans Ende springen, sonst würden alte
					// Duels aus dem Log erneut ausgelöst.
					offset = Files.size(path);
				}
				readNewLines(path);
				Thread.sleep(50);
			} catch (InterruptedException error) {
				Thread.currentThread().interrupt();
				return;
			} catch (Exception error) {
				InvCheckerMod.logError("latest.log konnte nicht gelesen werden", error);
				try {
					Thread.sleep(2000);
				} catch (InterruptedException interrupted) {
					Thread.currentThread().interrupt();
					return;
				}
			}
		}
	}

	private void readNewLines(Path path) throws IOException {
		long size = Files.size(path);
		if (size < offset) {
			offset = 0; // Log wurde rotiert
		}
		if (size == offset) {
			return;
		}
		try (RandomAccessFile file = new RandomAccessFile(path.toFile(), "r")) {
			file.seek(offset);
			byte[] buffer = new byte[(int) Math.min(64 * 1024, size - offset)];
			int read = file.read(buffer);
			if (read <= 0) {
				return;
			}
			offset += read;
			String chunk = new String(buffer, 0, read, StandardCharsets.UTF_8);
			for (String line : chunk.split("\n")) {
				detector.onLogLine(line.trim());
			}
		}
	}

	private Path resolvePath() {
		Path configured = Path.of(config.logPath);
		if (configured.isAbsolute()) {
			return configured;
		}
		Path gameDir = FabricLoader.getInstance().getGameDir();
		return gameDir != null ? gameDir.resolve(configured) : configured;
	}
}
