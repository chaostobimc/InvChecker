package net.invchecker;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.fabricmc.loader.api.FabricLoader;
import net.invchecker.config.InvCheckerConfig;
import net.invchecker.gui.ConfigScreen;
import net.invchecker.hud.HudRenderer;
import net.invchecker.net.BotConnection;
import net.invchecker.scan.ScanState;
import net.invchecker.trigger.LogTailer;
import net.invchecker.trigger.TriggerDetector;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.Identifier;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.hit.EntityHitResult;
import net.minecraft.util.math.BlockPos;
import org.lwjgl.glfw.GLFW;

/**
 * Einstiegspunkt der Mod.
 *
 * Datenfluss:
 *   Chat-/Systemnachricht  ─┐
 *                          ├─► TriggerDetector ─► BotConnection (TCP) ─► Bot führt /invsee aus
 *   latest.log (optional)  ─┘                                                  │
 *                                                                              ▼
 *   HUD im Spiel  ◄────────────────────  ScanState  ◄────────────────────  Ergebnis
 */
public final class InvCheckerMod implements ClientModInitializer {

	public static final String MOD_ID = "invchecker";
	public static final Identifier HUD_ELEMENT_ID = Identifier.of(MOD_ID, "invchecker_hud");

	private static InvCheckerConfig config;
	private static ScanState scanState;
	private static BotConnection connection;
	private static TriggerDetector detector;
	private static LogTailer logTailer;
	private static KeyBinding openConfigKey;
	private static KeyBinding manualScanKey;
	private static KeyBinding pullKey;

	@Override
	public void onInitializeClient() {
		config = InvCheckerConfig.load(FabricLoader.getInstance().getConfigDir().resolve("invchecker.json"));
		scanState = new ScanState(config);
		detector = new TriggerDetector(config);
		connection = new BotConnection(config, scanState::onResult);
		logTailer = new LogTailer(config, detector);

		// 1. Hauptquelle: Chat-/Systemnachrichten direkt vom Client.
		//    Das ist exakt der Text, der sonst als "[System] [CHAT] …" im
		//    latest.log landet – nur ohne Festplatten-Umweg und ohne Polling.
		ClientReceiveMessageEvents.GAME.register((message, overlay) -> detector.onMessage(message.getString()));
		ClientReceiveMessageEvents.CHAT.register((message, signedMessage, sender, params, receptionTimestamp) ->
				detector.onMessage(message.getString()));

		// 2. Backup: latest.log mitlesen (in der Config abschaltbar).
		logTailer.start();

		// 1.21.11: Der letzte Konstruktor-Parameter ist kein String mehr, sondern
		// ein KeyBinding.Category-Record. Fuer eine eigene Kategorie gaebe es
		// KeyBinding.Category.create(Identifier.of(MOD_ID, "invchecker")); deren
		// Anzeigetext laeuft aber ueber einen Uebersetzungsschluessel, den wir
		// nicht sicher kennen – deshalb die fertige Vanilla-Kategorie MISC.
		openConfigKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
				"key.invchecker.open_config", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_K, KeyBinding.Category.MISC));
		manualScanKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
				"key.invchecker.manual_scan", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_J, KeyBinding.Category.MISC));

		// V = Rechtsklick des Bots auf den gemerkten Block (addpull).
		pullKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
				"key.invchecker.pull", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_V, KeyBinding.Category.MISC));

		// Client-Befehl /addpull: Block, den man ansieht, an den Bot schicken.
		ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) ->
				dispatcher.register(ClientCommandManager.literal("addpull").executes(context -> {
					MinecraftClient c = MinecraftClient.getInstance();
					if (c != null && c.crosshairTarget instanceof BlockHitResult hit) {
						BlockPos pos = hit.getBlockPos();
						boolean sent = connection.sendAddPull(pos.getX(), pos.getY(), pos.getZ());
						log(sent ? "addpull: Block " + pos.toShortString() + " an den Bot geschickt."
								: "addpull: keine Verbindung zum Bot.");
					} else {
						log("addpull: Du schaust gerade keinen Block an.");
					}
					return 1;
				})));

		ClientTickEvents.END_CLIENT_TICK.register(InvCheckerMod::onClientTick);

		// fabric-api >= 0.141: Die Layer-API (HudLayerRegistrationCallback /
		// IdentifiedLayer) wurde durch HudElementRegistry + VanillaHudElements
		// ersetzt. attachElementAfter erbt die Render-Bedingung des Elements,
		// an das es angehaengt wird – bei allen Vanilla-Elementen ausser SLEEP
		// ist das Options#hideGui, also genau das gewuenschte Verhalten.
		HudElementRegistry.attachElementAfter(VanillaHudElements.MISC_OVERLAYS, HUD_ELEMENT_ID,
				(context, tickCounter) -> HudRenderer.render(context, MinecraftClient.getInstance()));

		connection.connectAsync();
		log("Geladen. K = Einstellungen, J = manueller Scan, V = Bot-Rechtsklick (addpull), /addpull = Block merken.");
	}

	private static void onClientTick(MinecraftClient client) {
		if (openConfigKey != null && openConfigKey.wasPressed()) {
			client.setScreen(new ConfigScreen(client.currentScreen));
		}
		if (manualScanKey != null && manualScanKey.wasPressed()) {
			detector.manualTrigger(targetedPlayerName(client));
		}
		if (pullKey != null && pullKey.wasPressed()) {
			connection.sendPull();
		}
		scanState.tick(client);
		connection.tick();
		logTailer.setEnabled(config.logTailing && isActiveOnCurrentServer());
	}

	/**
	 * Name des Spielers, den du gerade ansiehst. Fällt auf den eigenen Namen
	 * zurück, damit man die Verbindung zum Bot testen kann.
	 */
	private static String targetedPlayerName(MinecraftClient client) {
		if (client.crosshairTarget instanceof EntityHitResult hit && hit.getEntity() instanceof PlayerEntity player) {
			return player.getName().getString();
		}
		return client.player != null ? client.player.getName().getString() : "";
	}

	/** Die Mod tut nur etwas, wenn wir wirklich auf dem konfigurierten Server sind. */
	public static boolean isActiveOnCurrentServer() {
		if (config == null) {
			return false;
		}
		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null || client.getCurrentServerEntry() == null) {
			return false;
		}
		return config.matchesServer(client.getCurrentServerEntry().address);
	}

	public static boolean isEnabled() {
		return config != null && config.enabled && isActiveOnCurrentServer();
	}

	public static InvCheckerConfig getConfig() {
		return config;
	}

	public static ScanState getScanState() {
		return scanState;
	}

	public static BotConnection getConnection() {
		return connection;
	}

	public static TriggerDetector getDetector() {
		return detector;
	}

	public static void log(String message) {
		System.out.println("[InvChecker] " + message);
	}

	public static void logError(String message, Throwable error) {
		System.err.println("[InvChecker] " + message + (error != null ? ": " + error : ""));
	}
}
