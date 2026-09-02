package net.invchecker.gui;

import net.invchecker.InvCheckerMod;
import net.invchecker.config.InvCheckerConfig;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Die komplette Item-Liste von Minecraft mit Suche. Ein Klick wählt ein Item
 * für die Watchlist an oder ab.
 *
 * Die Item-Liste wird einmalig gebaut und gecacht – gesucht wird nur in der
 * gecachten Liste, dadurch bleibt die Eingabe flüssig.
 */
public class WatchlistScreen extends Screen {

	private static final int PER_PAGE = 36;
	private static final int COLUMNS = 2;

	private final Screen parent;
	private final InvCheckerConfig config;

	private static List<CatalogEntry> catalog;

	private final List<CatalogEntry> filtered = new ArrayList<>();
	private String search = "";
	private int page;

	public WatchlistScreen(Screen parent) {
		super(Text.literal("InvChecker – Item-Liste"));
		this.parent = parent;
		this.config = InvCheckerMod.getConfig();
	}

	@Override
	protected void init() {
		super.init();
		if (catalog == null) {
			catalog = buildCatalog();
		}
		rebuildWidgetsForPage();
	}

	private void rebuildWidgetsForPage() {
		clearChildren();
		applyFilter();

		TextFieldWidget searchField = new TextFieldWidget(textRenderer, this.width / 2 - 155, 32, 200, 20,
				Text.literal("Suche"));
		searchField.setSuggestion("z. B. totem");
		searchField.setMaxLength(64);
		searchField.setText(search);
		searchField.setChangedListener(value -> {
			search = value == null ? "" : value;
			page = 0;
			rebuildWidgetsForPage();
		});
		addDrawableChild(searchField);

		addDrawableChild(ButtonWidget.builder(Text.literal("Suchen"), button -> {
			page = 0;
			rebuildWidgetsForPage();
		}).dimensions(this.width / 2 + 55, 32, 60, 20).build());

		addDrawableChild(ButtonWidget.builder(Text.literal("Alle Treffer an"), button -> {
			setWatchedForFiltered(true);
		}).dimensions(this.width / 2 - 155, 56, 100, 20).build());

		addDrawableChild(ButtonWidget.builder(Text.literal("Alle Treffer aus"), button -> {
			setWatchedForFiltered(false);
		}).dimensions(this.width / 2 - 50, 56, 100, 20).build());

		addDrawableChild(ButtonWidget.builder(Text.literal("Fertig"), button -> close())
				.dimensions(this.width / 2 + 55, 56, 100, 20).build());

		int pages = Math.max(1, (filtered.size() + PER_PAGE - 1) / PER_PAGE);
		page = Math.max(0, Math.min(page, pages - 1));

		int startX = this.width / 2 - 155;
		int startY = 84;
		int cellWidth = 155;
		int index = 0;
		for (int i = page * PER_PAGE; i < Math.min(filtered.size(), (page + 1) * PER_PAGE); i++) {
			CatalogEntry entry = filtered.get(i);
			int column = index % COLUMNS;
			int row = index / COLUMNS;
			int x = startX + column * (cellWidth + 5);
			int y = startY + row * 20;
			boolean watched = config.isWatched(entry.id);
			ButtonWidget widget = ButtonWidget.builder(
					Text.literal((watched ? "§a✔ " : "§8○ ") + entry.name), button -> {
				config.toggleWatched(entry.id);
				InvCheckerMod.getScanState().rebuildVisible();
				rebuildWidgetsForPage();
			}).dimensions(x, y, cellWidth, 18).build();
			widget.setTooltip(net.minecraft.client.gui.tooltip.Tooltip.of(Text.literal(entry.id)));
			addDrawableChild(widget);
			index++;
		}

		addDrawableChild(ButtonWidget.builder(Text.literal("< Seite"), button -> {
			page = Math.max(0, page - 1);
			rebuildWidgetsForPage();
		}).dimensions(this.width / 2 - 155, this.height - 30, 100, 20).build());

		addDrawableChild(ButtonWidget.builder(Text.literal("Seite >"), button -> {
			page = Math.min(pages - 1, page + 1);
			rebuildWidgetsForPage();
		}).dimensions(this.width / 2 + 55, this.height - 30, 100, 20).build());
	}

	private void setWatchedForFiltered(boolean watched) {
		for (CatalogEntry entry : filtered) {
			if (config.isWatched(entry.id) != watched) {
				config.toggleWatched(entry.id);
			}
		}
		InvCheckerMod.getScanState().rebuildVisible();
		rebuildWidgetsForPage();
	}

	private void applyFilter() {
		filtered.clear();
		String needle = search.trim().toLowerCase(Locale.ROOT).replace("minecraft:", "");
		for (CatalogEntry entry : catalog) {
			if (needle.isEmpty() || entry.id.contains(needle) || entry.name.toLowerCase(Locale.ROOT).contains(needle)) {
				filtered.add(entry);
			}
		}
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float delta) {
		renderBackground(context, mouseX, mouseY, delta);
		super.render(context, mouseX, mouseY, delta);
		int pages = Math.max(1, (filtered.size() + PER_PAGE - 1) / PER_PAGE);
		context.drawTextWithShadow(textRenderer, Text.literal("Item-Liste – Klicken wählt ab/an"),
				this.width / 2 - 155, 16, 0xFFFFFFFF);
		context.drawTextWithShadow(textRenderer,
				Text.literal(filtered.size() + " Items, " + config.watchlist.size() + " ausgewählt, Seite " + (page + 1) + "/" + pages),
				this.width / 2 - 155, this.height - 44, 0xFFAAAAAA);
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
		int pages = Math.max(1, (filtered.size() + PER_PAGE - 1) / PER_PAGE);
		page = Math.max(0, Math.min(pages - 1, (int) (page - verticalAmount)));
		rebuildWidgetsForPage();
		return true;
	}

	@Override
	public void close() {
		config.save();
		InvCheckerMod.getScanState().rebuildVisible();
		client.setScreen(parent);
	}

	@Override
	public boolean shouldPause() {
		return false;
	}

	private static List<CatalogEntry> buildCatalog() {
		List<CatalogEntry> entries = new ArrayList<>();
		for (Item item : Registries.ITEM) {
			if (item == null || item == Items.AIR) {
				continue;
			}
			Identifier id = Registries.ITEM.getId(item);
			if (id == null) {
				continue;
			}
			String name;
			try {
				name = new ItemStack(item).getName().getString();
			} catch (Exception error) {
				name = id.getPath();
			}
			entries.add(new CatalogEntry(id.toString(), name.isEmpty() ? id.getPath() : name));
		}
		entries.sort(Comparator.comparing(entry -> entry.name.toLowerCase(Locale.ROOT)));
		InvCheckerMod.log("Item-Katalog geladen: " + entries.size() + " Einträge");
		return entries;
	}

	private record CatalogEntry(String id, String name) {
	}
}
