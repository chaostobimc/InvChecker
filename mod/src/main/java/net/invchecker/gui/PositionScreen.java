package net.invchecker.gui;

import net.invchecker.InvCheckerMod;
import net.invchecker.config.InvCheckerConfig;
import net.invchecker.hud.HudRenderer;
import net.invchecker.scan.ScanResult;
import net.minecraft.client.gui.Click;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;

/**
 * HUD-Position per Drag & Drop festlegen. Das Vorschaupanel ist ein echtes
 * Scan-Ergebnis (oder Beispieldaten), damit man genau sieht, was später im
 * Spiel angezeigt wird.
 */
public class PositionScreen extends Screen {

	private final Screen parent;
	private final InvCheckerConfig config;
	private final ScanResult preview;
	private boolean dragging;

	public PositionScreen(Screen parent) {
		super(Text.literal("InvChecker – HUD-Position"));
		this.parent = parent;
		this.config = InvCheckerMod.getConfig();
		this.preview = sampleResult();
	}

	@Override
	protected void init() {
		super.init();
		addDrawableChild(ButtonWidget.builder(Text.literal("Zentrieren"), button -> {
			config.posX = 0.5D;
			config.posY = 0.25D;
			config.save();
		}).dimensions(this.width / 2 - 155, this.height - 30, 100, 20).build());

		addDrawableChild(ButtonWidget.builder(Text.literal("Fertig"), button -> close())
				.dimensions(this.width / 2 + 55, this.height - 30, 100, 20).build());
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float delta) {
		renderBackground(context, mouseX, mouseY, delta);
		super.render(context, mouseX, mouseY, delta);
		context.drawTextWithShadow(textRenderer, Text.literal("Panel anklicken und ziehen, ESC speichert"),
				10, 10, 0xFFFFFFFF);
		context.drawTextWithShadow(textRenderer,
				Text.literal(String.format(java.util.Locale.ROOT, "Position: %.0f%% / %.0f%%", config.posX * 100, config.posY * 100)),
				10, 22, 0xFFAAAAAA);

		// Vorschau mit den echten Daten/Anzeige-Einstellungen zeichnen.
		InvCheckerMod.getScanState().setPreview(preview);
		HudRenderer.render(context, client);
	}

	// 1.21.11: Die Mouse-Events bekommen ein Click-Record (x, y, buttonInfo)
	// statt (double mouseX, double mouseY, int button).
	@Override
	public boolean mouseClicked(Click click, boolean doubled) {
		dragging = true;
		moveTo(click.x(), click.y());
		return super.mouseClicked(click, doubled);
	}

	@Override
	public boolean mouseDragged(Click click, double deltaX, double deltaY) {
		if (dragging) {
			moveTo(click.x(), click.y());
		}
		return super.mouseDragged(click, deltaX, deltaY);
	}

	@Override
	public boolean mouseReleased(Click click) {
		dragging = false;
		config.save();
		return super.mouseReleased(click);
	}

	private void moveTo(double mouseX, double mouseY) {
		int panelWidth = 220;
		int panelHeight = 160;
		double x = (mouseX - panelWidth / 2.0D) / Math.max(1, this.width - panelWidth);
		double y = (mouseY - panelHeight / 2.0D) / Math.max(1, this.height - panelHeight);
		config.posX = Math.max(0.0D, Math.min(1.0D, x));
		config.posY = Math.max(0.0D, Math.min(1.0D, y));
	}

	@Override
	public void close() {
		config.save();
		InvCheckerMod.getScanState().clearPreview();
		InvCheckerMod.getScanState().invalidateLayout();
		client.setScreen(parent);
	}

	@Override
	public boolean shouldPause() {
		return false;
	}

	private static ScanResult sampleResult() {
		ScanResult result = new ScanResult();
		result.target = "Greatcat14";
		result.targetName = "Greatcat14s Inventar";
		result.windowTitle = "Greatcat14s Inventar";
		result.totalMs = 12;
		result.commandToWindowMs = 9;
		result.windowToReadMs = 0;
		result.items = new ArrayList<>(List.of(
				entry(0, "minecraft:golden_apple", "Golden Apple", 3, null, null),
				entry(1, "minecraft:ender_pearl", "Ender Pearl", 16, null, null),
				entry(5, "minecraft:netherite_sword", "Netherite Sword", 1, List.of("sharpness V"), null),
				entry(13, "minecraft:netherite_chestplate", "Netherite Chestplate", 1, List.of("protection IV"), "472/592")));
		result.armor = new ArrayList<>(List.of(
				entry(39, "minecraft:netherite_helmet", "Netherite Helmet", 1, null, null),
				entry(40, "minecraft:netherite_chestplate", "Netherite Chestplate", 1, null, null)));
		result.offhand = new ArrayList<>(List.of(entry(43, "minecraft:shield", "Shield", 1, null, null)));
		return result;
	}

	private static ScanResult.Entry entry(int slot, String id, String name, int count, List<String> enchants, String durability) {
		ScanResult.Entry entry = new ScanResult.Entry();
		entry.slot = slot;
		entry.id = id;
		entry.name = name;
		entry.count = count;
		if (enchants != null) {
			entry.enchants = new ArrayList<>(enchants);
		}
		entry.durability = durability;
		return entry;
	}
}
