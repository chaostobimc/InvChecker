package net.invchecker.gui;

import net.invchecker.InvCheckerMod;
import net.invchecker.config.InvCheckerConfig;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

/**
 * Einstellungen der Mod. Alles, was man anpassen kann, ist hier erreichbar –
 * inklusive der Item-Watchlist und der HUD-Position.
 *
 * Bewusst nur mit den stabilsten Widget-Klassen gebaut (Button, Slider,
 * EditBox), damit die Mod auch nach kleinen Minecraft-Updates noch kompiliert.
 */
public class ConfigScreen extends Screen {

	private static final int ROW_HEIGHT = 24;

	private final Screen parent;
	private final InvCheckerConfig config;
	private final List<Row> rows = new ArrayList<>();
	private double scroll;

	public ConfigScreen(Screen parent) {
		super(Text.literal("InvChecker"));
		this.parent = parent;
		this.config = InvCheckerMod.getConfig();
	}

	@Override
	protected void init() {
		super.init();
		buildRows();
		rebuild();
	}

	private void rebuild() {
		clearChildren();
		int left = this.width / 2 - 155;
		int y = 34 - (int) scroll;
		for (Row row : rows) {
			if (row.header) {
				y += 10;
				continue;
			}
			if (y > 20 && y < this.height - 30) {
				row.build(this, left, y);
			}
			y += ROW_HEIGHT;
		}
		addDrawableChild(ButtonWidget.builder(Text.literal("Item-Liste (Watchlist)"),
				button -> client.setScreen(new WatchlistScreen(this))).dimensions(this.width / 2 - 155, this.height - 52, 150, 20).build());
		addDrawableChild(ButtonWidget.builder(Text.literal("HUD-Position festlegen"),
				button -> client.setScreen(new PositionScreen(this))).dimensions(this.width / 2 + 5, this.height - 52, 150, 20).build());
		addDrawableChild(ButtonWidget.builder(Text.literal("Fertig"), button -> close())
				.dimensions(this.width / 2 - 50, this.height - 28, 100, 20).build());
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float delta) {
		renderBackground(context, mouseX, mouseY, delta);
		super.render(context, mouseX, mouseY, delta);
		int y = 34 - (int) scroll;
		for (Row row : rows) {
			if (row.header) {
				if (y > 20 && y < this.height - 30) {
					context.drawTextWithShadow(textRenderer, Text.literal("§n" + row.label), this.width / 2 - 155, y, 0xFFFFFF66);
				}
				y += 10;
				continue;
			}
			if (y > 20 && y < this.height - 30) {
				context.drawTextWithShadow(textRenderer, Text.literal(row.label), this.width / 2 - 155, y + 6, 0xFFDDDDDD);
			}
			y += ROW_HEIGHT;
		}
		context.drawTextWithShadow(textRenderer, Text.literal("InvChecker – Einstellungen"), this.width / 2 - 155, 16, 0xFFFFFFFF);
		String state = InvCheckerMod.getConnection().getState();
		String serverInfo = InvCheckerMod.isActiveOnCurrentServer()
				? "§aaktiv auf diesem Server" : "§7deaktiviert (falscher Server/Einzelplayer)";
		context.drawTextWithShadow(textRenderer, Text.literal("Bot: " + state + "  ·  Mod: " + serverInfo),
				this.width / 2 - 155, 24, 0xFFAAAAAA);
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
		scroll = Math.max(0, scroll - verticalAmount * 22);
		double maxScroll = Math.max(0, rows.size() * (double) ROW_HEIGHT - (this.height - 90));
		scroll = Math.min(scroll, maxScroll);
		rebuild();
		return true;
	}

	@Override
	public void close() {
		config.save();
		InvCheckerMod.getScanState().invalidateLayout();
		client.setScreen(parent);
	}

	@Override
	public boolean shouldPause() {
		return false;
	}

	// ------------------------------------------------------------------ Reihen
	private void buildRows() {
		rows.clear();
		addHeader("Allgemein");
		addToggle("Mod aktiviert", () -> config.enabled, value -> config.enabled = value);
		addText("Server (Komma-getrennt, * = alle)", () -> String.join(", ", config.servers),
				value -> {
					List<String> servers = new ArrayList<>();
					for (String part : value.split(",")) {
						if (!part.isBlank()) {
							servers.add(part.trim());
						}
					}
					config.servers = servers;
				});

		addHeader("Bot-Verbindung");
		addText("Adresse des Bots", () -> config.botHost, value -> config.botHost = value.trim());
		addNumber("Port", () -> config.botPort, value -> config.botPort = value, 1, 65535);
		addText("Token", () -> config.token, value -> config.token = value.trim());
		addNumber("Neuer Versuch nach (ms)", () -> config.reconnectDelayMs, value -> config.reconnectDelayMs = value, 200, 30000);

		addHeader("Auslöser");
		addText("Chat-Muster (Gruppe 1 = Name)", () -> config.triggerPattern, value -> config.triggerPattern = value);
		addNumber("Doppelte Treffer sperren (ms)", () -> config.dedupeMs, value -> config.dedupeMs = value, 0, 10000);
		addToggle("latest.log mitlesen (Backup)", () -> config.logTailing, value -> config.logTailing = value);
		addToggle("Debug-Ausgabe", () -> config.debug, value -> config.debug = value);

		addHeader("Anzeige");
		addSlider("Anzeigedauer (Sekunden)", () -> config.displaySeconds,
				value -> config.displaySeconds = Math.round(value * 10.0D) / 10.0D, 1.0D, 120.0D, "%.1f s");
		addSlider("Schriftgröße", () -> (double) config.scale, value -> config.scale = value.floatValue(), 0.5D, 2.0D, "%.2f x");
		addSlider("Hintergrund-Deckkraft", () -> (double) config.backgroundAlpha,
				value -> config.backgroundAlpha = (int) Math.round(value), 0.0D, 255.0D, "%.0f");
		addNumber("Maximale Einträge", () -> config.maxEntries, value -> config.maxEntries = value, 1, 100);
		addCycle("Modus", () -> config.mode, value -> config.mode = value,
				List.of("all", "watchlist"), List.of("Alles (Watchlist hervorgehoben)", "Nur Watchlist"));
		addCycle("Sortierung", () -> config.sort, value -> config.sort = value,
				List.of("count", "name", "slot"), List.of("Nach Anzahl", "Nach Name", "Nach Slot"));

		addHeader("Inhalt");
		addToggle("Hintergrund", () -> config.showBackground, value -> config.showBackground = value);
		addToggle("Schatten", () -> config.showShadow, value -> config.showShadow = value);
		addToggle("Anzahl anzeigen", () -> config.showCount, value -> config.showCount = value);
		addToggle("Slotnummer anzeigen", () -> config.showSlotNumber, value -> config.showSlotNumber = value);
		addToggle("Verzauberungen", () -> config.showEnchants, value -> config.showEnchants = value);
		addToggle("Haltbarkeit", () -> config.showDurability, value -> config.showDurability = value);
		addToggle("Rüstung", () -> config.showArmor, value -> config.showArmor = value);
		addToggle("Offhand", () -> config.showOffhand, value -> config.showOffhand = value);
		addToggle("Scan-Dauer anzeigen", () -> config.showLatency, value -> config.showLatency = value);

		addHeader("Farben");
		addColor("Titel", () -> config.titleColor, value -> config.titleColor = value);
		addColor("Normal", () -> config.normalColor, value -> config.normalColor = value);
		addColor("Watchlist", () -> config.highlightColor, value -> config.highlightColor = value);
		addColor("Zusatzinfos", () -> config.dimColor, value -> config.dimColor = value);
		addColor("Fehler", () -> config.errorColor, value -> config.errorColor = value);
	}

	private void addHeader(String label) {
		Row row = new Row(label);
		row.header = true;
		rows.add(row);
	}

	private void addToggle(String label, Supplier<Boolean> getter, java.util.function.Consumer<Boolean> setter) {
		rows.add(new Row(label) {
			@Override
			void build(ConfigScreen screen, int x, int y) {
				ButtonWidget widget = ButtonWidget.builder(Text.literal(getter.get() ? "§aAn" : "§cAus"), button -> {
					setter.accept(!getter.get());
					config.save();
					InvCheckerMod.getScanState().invalidateLayout();
					screen.rebuild();
				}).dimensions(x + 210, y, 100, 20).build();
				screen.addDrawableChild(widget);
			}
		});
	}

	private void addText(String label, Supplier<String> getter, java.util.function.Consumer<String> setter) {
		rows.add(new Row(label) {
			@Override
			void build(ConfigScreen screen, int x, int y) {
				TextFieldWidget widget = new TextFieldWidget(screen.textRenderer, x + 160, y, 200, 20,
						Text.literal(label));
				widget.setMaxLength(512);
				widget.setText(getter.get());
				widget.setChangedListener(value -> {
					setter.accept(value);
					config.save();
				});
				screen.addDrawableChild(widget);
			}
		});
	}

	private void addNumber(String label, Supplier<Integer> getter, java.util.function.Consumer<Integer> setter, int min, int max) {
		rows.add(new Row(label) {
			@Override
			void build(ConfigScreen screen, int x, int y) {
				TextFieldWidget widget = new TextFieldWidget(screen.textRenderer, x + 210, y, 90, 20,
						Text.literal(label));
				widget.setMaxLength(8);
				widget.setText(String.valueOf(getter.get()));
				widget.setChangedListener(value -> {
					try {
						int parsed = Integer.parseInt(value.trim());
						setter.accept(Math.max(min, Math.min(max, parsed)));
						config.save();
					} catch (NumberFormatException ignored) {
						// halbe Eingaben ignorieren
					}
				});
				screen.addDrawableChild(widget);
			}
		});
	}

	private void addSlider(String label, Supplier<Double> getter, java.util.function.Consumer<Double> setter,
			double min, double max, String format) {
		rows.add(new Row(label) {
			@Override
			void build(ConfigScreen screen, int x, int y) {
				ValueSliderWidget widget = new ValueSliderWidget(x + 180, y, 180, 20, min, max, getter.get(), format,
						value -> {
							setter.accept(value);
							config.save();
							InvCheckerMod.getScanState().invalidateLayout();
						});
				screen.addDrawableChild(widget);
			}
		});
	}

	private void addCycle(String label, Supplier<String> getter, java.util.function.Consumer<String> setter,
			List<String> values, List<String> labels) {
		rows.add(new Row(label) {
			@Override
			void build(ConfigScreen screen, int x, int y) {
				int index = Math.max(0, values.indexOf(getter.get()));
				ButtonWidget widget = ButtonWidget.builder(Text.literal(labels.get(index)), button -> {
					int next = (values.indexOf(getter.get()) + 1) % values.size();
					setter.accept(values.get(next));
					config.save();
					InvCheckerMod.getScanState().invalidateLayout();
					screen.rebuild();
				}).dimensions(x + 180, y, 180, 20).build();
				screen.addDrawableChild(widget);
			}
		});
	}

	private void addColor(String label, Supplier<Integer> getter, java.util.function.Consumer<Integer> setter) {
		String[] presets = { "#FF5555", "#FFAA00", "#FFFF55", "#55FF55", "#55FFFF", "#AA66FF", "#FFFFFF", "#AAAAAA" };
		rows.add(new Row(label) {
			@Override
			void build(ConfigScreen screen, int x, int y) {
				ButtonWidget widget = ButtonWidget.builder(
						Text.literal(String.format("#%06X", getter.get() & 0xFFFFFF)), button -> {
					int current = getter.get() & 0xFFFFFF;
					int index = 0;
					for (int i = 0; i < presets.length; i++) {
						if (Integer.parseInt(presets[i].substring(1), 16) == current) {
							index = (i + 1) % presets.length;
							break;
						}
					}
					setter.accept(0xFF000000 | Integer.parseInt(presets[index].substring(1), 16));
					config.save();
					InvCheckerMod.getScanState().invalidateLayout();
					screen.rebuild();
				}).dimensions(x + 210, y, 100, 20).build();
				screen.addDrawableChild(widget);
			}
		});
	}

	private static class Row {
		final String label;
		boolean header;

		Row(String label) {
			this.label = label;
		}

		void build(ConfigScreen screen, int x, int y) {
		}
	}
}
