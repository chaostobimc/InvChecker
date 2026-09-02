package net.invchecker.net;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.invchecker.InvCheckerMod;
import net.invchecker.config.InvCheckerConfig;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;

/**
 * TCP-Verbindung zum Mineflayer-Bot.
 *
 * Protokoll: eine JSON-Zeile pro Nachricht, getrennt durch '\n'.
 * Der Socket bleibt dauerhaft offen, damit ein Trigger sofort rausgeht
 * (kein Verbindungsaufbau pro Duel – das kostet sonst 10-100 ms).
 */
public final class BotConnection {

	private static final int CONNECT_TIMEOUT_MS = 3000;
	private static final long PING_INTERVAL_MS = 5000;

	private final InvCheckerConfig config;
	private final Consumer<JsonObject> resultConsumer;

	private final Object lock = new Object();
	private Socket socket;
	private OutputStream out;
	private Thread readThread;

	private volatile boolean running = true;
	private volatile String state = "nie verbunden";
	private volatile String botName = "";
	private volatile boolean botOnline;
	private volatile long lastActivityMs;
	private volatile long lastPingMs;
	private volatile boolean reconnectRequested;
	private String connectedHost;
	private int connectedPort;

	public BotConnection(InvCheckerConfig config, Consumer<JsonObject> resultConsumer) {
		this.config = config;
		this.resultConsumer = resultConsumer;
	}

	public void connectAsync() {
		synchronized (lock) {
			if (readThread != null && readThread.isAlive()) {
				reconnectRequested = true;
				return;
			}
			readThread = new Thread(this::loop, "InvChecker-BotConnection");
			readThread.setDaemon(true);
			readThread.start();
		}
	}

	/** Wird jeden Client-Tick aufgerufen: hält die Verbindung frisch. */
	public void tick() {
		boolean settingsChanged = socket != null && socket.isConnected()
				&& (!config.botHost.equals(connectedHost) || config.botPort != connectedPort);
		if (settingsChanged) {
			InvCheckerMod.log("Bot-Adresse geändert – verbinde neu mit " + config.botHost + ":" + config.botPort);
			reconnectRequested = true;
		}
		long now = System.currentTimeMillis();
		if (isConnected() && now - lastPingMs >= PING_INTERVAL_MS) {
			lastPingMs = now;
			sendRaw("{\"type\":\"ping\"}\n");
		}
	}

	private void loop() {
		while (running) {
			reconnectRequested = false;
			String host = config.botHost;
			int port = config.botPort;
			try (Socket newSocket = new Socket()) {
				state = "verbinde mit " + host + ":" + port + " …";
				newSocket.setTcpNoDelay(true);
				newSocket.setKeepAlive(true);
				newSocket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);

				socket = newSocket;
				out = newSocket.getOutputStream();
				connectedHost = host;
				connectedPort = port;
				lastActivityMs = System.currentTimeMillis();
				state = "verbunden";
				InvCheckerMod.log("Mit Bot verbunden: " + host + ":" + port);

				BufferedReader reader = new BufferedReader(new InputStreamReader(newSocket.getInputStream(), StandardCharsets.UTF_8));
				String line;
				while (running && !reconnectRequested && (line = reader.readLine()) != null) {
					if (!line.isBlank()) {
						handleLine(line);
					}
				}
			} catch (IOException error) {
				if (running && !reconnectRequested) {
					state = "keine Verbindung (" + error.getClass().getSimpleName() + ")";
				}
			} finally {
				closeQuietly();
			}

			if (!running) {
				return;
			}
			if (!reconnectRequested) {
				state = "verbinde erneut in " + Math.max(200, config.reconnectDelayMs) + " ms …";
			}
			sleep(Math.max(200, config.reconnectDelayMs));
		}
	}

	private void handleLine(String line) {
		JsonObject json;
		try {
			json = JsonParser.parseString(line).getAsJsonObject();
		} catch (Exception error) {
			InvCheckerMod.logError("Bot hat unlesbares JSON geschickt", error);
			return;
		}
		lastActivityMs = System.currentTimeMillis();
		String type = json.has("type") ? json.get("type").getAsString() : "";
		switch (type) {
			case "hello":
				botName = json.has("botName") && !json.get("botName").isJsonNull() ? json.get("botName").getAsString() : "";
				botOnline = json.has("botOnline") && json.get("botOnline").getAsBoolean();
				state = botOnline ? "verbunden, Bot ist eingeloggt" : "verbunden, Bot loggt noch ein";
				sendSettings();
				break;
			case "status":
				botOnline = json.has("state") && "ready".equals(json.get("state").getAsString());
				state = botOnline ? "verbunden, Bot ist eingeloggt" : "verbunden, Bot ist offline";
				break;
			case "pong":
				break;
			case "result":
				resultConsumer.accept(json);
				break;
			case "error":
				String error = json.has("error") ? json.get("error").getAsString() : "?";
				String message = json.has("message") ? json.get("message").getAsString() : "";
				InvCheckerMod.log("Bot-Fehler: " + error + " " + message);
				if (InvCheckerMod.getScanState() != null) {
					InvCheckerMod.getScanState().setStatus("Bot: " + error + (message.isEmpty() ? "" : " – " + message),
							config.errorColor, 4000);
				}
				break;
			default:
				break;
		}
	}

	/** Schickt dem Bot die Einstellungen (Watchlist), damit er sie loggen kann. */
	private void sendSettings() {
		StringBuilder builder = new StringBuilder(256);
		builder.append("{\"type\":\"config\",\"token\":").append(jsonString(config.token));
		builder.append(",\"patch\":{\"displaySeconds\":").append(config.displaySeconds);
		builder.append(",\"mode\":").append(jsonString(config.mode));
		builder.append(",\"watchlist\":[");
		boolean first = true;
		for (String id : config.watchlist) {
			if (!first) {
				builder.append(',');
			}
			builder.append(jsonString(id));
			first = false;
		}
		builder.append("]}}\n");
		sendRaw(builder.toString());
	}

	/**
	 * Der eigentliche Trigger. Läuft auf dem Client-Thread und schreibt nur ein
	 * paar Bytes in einen offenen Socket – schneller geht es nicht.
	 */
	public boolean sendTrigger(String target, String source) {
		String message = "{\"type\":\"trigger\",\"token\":" + jsonString(config.token)
				+ ",\"target\":" + jsonString(target)
				+ ",\"triggerAt\":" + System.currentTimeMillis()
				+ ",\"source\":" + jsonString(source) + "}\n";
		boolean sent = sendRaw(message);
		if (!sent) {
			state = "keine Verbindung zum Bot";
		}
		return sent;
	}

	private boolean sendRaw(String message) {
		OutputStream stream = out;
		if (stream == null) {
			return false;
		}
		try {
			stream.write(message.getBytes(StandardCharsets.UTF_8));
			stream.flush();
			return true;
		} catch (IOException error) {
			InvCheckerMod.log("Senden an Bot fehlgeschlagen: " + error.getMessage());
			reconnectRequested = true;
			return false;
		}
	}

	private void closeQuietly() {
		synchronized (lock) {
			out = null;
			if (socket != null) {
				try {
					socket.close();
				} catch (IOException ignored) {
					// nichts zu tun
				}
				socket = null;
			}
		}
	}

	private static void sleep(long millis) {
		try {
			Thread.sleep(millis);
		} catch (InterruptedException error) {
			Thread.currentThread().interrupt();
		}
	}

	private static String jsonString(String value) {
		if (value == null) {
			return "\"\"";
		}
		StringBuilder builder = new StringBuilder(value.length() + 2);
		builder.append('"');
		for (int i = 0; i < value.length(); i++) {
			char character = value.charAt(i);
			switch (character) {
				case '"' -> builder.append("\\\"");
				case '\\' -> builder.append("\\\\");
				case '\n' -> builder.append("\\n");
				case '\r' -> builder.append("\\r");
				case '\t' -> builder.append("\\t");
				default -> {
					if (character < 0x20) {
						builder.append(String.format("\\u%04x", (int) character));
					} else {
						builder.append(character);
					}
				}
			}
		}
		builder.append('"');
		return builder.toString();
	}

	public boolean isConnected() {
		Socket current = socket;
		return current != null && current.isConnected() && !current.isClosed();
	}

	public String getState() {
		return state;
	}

	public String getBotName() {
		return botName;
	}

	public boolean isBotOnline() {
		return botOnline;
	}

	public void close() {
		running = false;
		reconnectRequested = true;
		closeQuietly();
	}
}
