package net.invchecker.hud;

import net.invchecker.InvCheckerMod;
import net.invchecker.config.InvCheckerConfig;
import net.invchecker.scan.ScanResult;
import net.invchecker.scan.ScanState;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;

import java.util.List;

/**
 * Zeichnet das Ergebnis-HUD ins Spiel. Position, Größe, Farben und Inhalte
 * kommen komplett aus der Config (siehe ConfigScreen).
 */
public final class HudRenderer {

	private static final int PADDING = 4;
	private static final int ICON = 16;
	private static final int ROW_GAP = 2;

	private HudRenderer() {
	}

	public static void render(DrawContext context, MinecraftClient client) {
		if (client == null || client.player == null) {
			return;
		}
		ScanState state = InvCheckerMod.getScanState();
		InvCheckerConfig config = InvCheckerMod.getConfig();
		if (state == null || config == null) {
			return;
		}
		TextRenderer text = client.textRenderer;

		ScanResult result = state.getCurrent();
		if (result != null) {
			drawPanel(context, text, client, state, result, config);
			return;
		}

		String status = state.getStatusText();
		if (status != null && config.enabled && InvCheckerMod.isActiveOnCurrentServer()) {
			int width = text.getWidth(status) + 8;
			int x = Math.max(0, Math.min(client.getWindow().getScaledWidth() - width, (int) (config.posX * client.getWindow().getScaledWidth())));
			int y = Math.max(0, (int) (config.posY * client.getWindow().getScaledHeight()));
			if (config.showBackground) {
				context.fill(x - 2, y - 2, x + width, y + 12, withAlpha(0x000000, config.backgroundAlpha));
			}
			context.drawText(text, status, x + 2, y + 1, state.getStatusColor(), config.showShadow);
		}
	}

	private static void drawPanel(DrawContext context, TextRenderer text, MinecraftClient client,
			ScanState state, ScanResult result, InvCheckerConfig config) {
		List<ScanResult.Entry> entries = state.getVisibleEntries();

		// ---------------------------------------------------------- Layout
		int extraRows = 0;
		if (config.showArmor && !result.armor.isEmpty()) {
			extraRows++;
		}
		if (config.showOffhand && !result.offhand.isEmpty()) {
			extraRows++;
		}
		int enchantRows = 0;
		if (config.showEnchants) {
			for (ScanResult.Entry entry : entries) {
				if (!entry.enchants.isEmpty()) {
					enchantRows++;
				}
			}
		}
		int rowHeight = ICON + ROW_GAP;
		int contentHeight = 12 + 2 + entries.size() * rowHeight + enchantRows * 10 + extraRows * rowHeight;
		if (config.showLatency && result.totalMs >= 0) {
			contentHeight += 10;
		}
		int height = contentHeight + PADDING * 2;

		int width = 150;
		for (ScanResult.Entry entry : entries) {
			int entryWidth = ICON + 4 + text.getWidth(entry.displayName()) + (config.showCount ? text.getWidth("x" + entry.count) + 4 : 0);
			if (config.showDurability && entry.isDamageable()) {
				entryWidth += text.getWidth(entry.durability) + 6;
			}
			width = Math.max(width, entryWidth);
		}
		String title = result.target;
		width = Math.max(width, text.getWidth(title) + text.getWidth("99.9 s") + 16);
		if (config.showArmor) {
			for (ScanResult.Entry entry : result.armor) {
				width = Math.max(width, ICON + 4 + text.getWidth(entry.displayName()));
			}
		}
		width = Math.min(width, Math.max(120, client.getWindow().getScaledWidth() - 20));
		height = Math.min(height, Math.max(40, client.getWindow().getScaledHeight() - 20));

		int scaledWidth = client.getWindow().getScaledWidth();
		int scaledHeight = client.getWindow().getScaledHeight();
		int x = (int) Math.round(config.posX * (scaledWidth - width));
		int y = (int) Math.round(config.posY * (scaledHeight - height));
		x = Math.max(0, Math.min(scaledWidth - width, x));
		y = Math.max(0, Math.min(scaledHeight - height, y));

		// ---------------------------------------------------------- Rahmen
		if (config.showBackground) {
			context.fill(x, y, x + width, y + height, withAlpha(0x101018, config.backgroundAlpha));
			context.fill(x, y, x + width, y + 1, 0x60FFFFFF);
			context.fill(x, y + height - 1, x + width, y + height, 0x60000000);
		}

		int cursorY = y + PADDING;
		int textX = x + PADDING;

		// ---------------------------------------------------------- Titel
		context.drawText(text, title, textX, cursorY + 1, config.titleColor, config.showShadow);
		String remaining = String.format(java.util.Locale.ROOT, "%.1fs", state.remainingSeconds());
		context.drawText(text, remaining, x + width - PADDING - text.getWidth(remaining), cursorY + 1, config.dimColor, config.showShadow);
		cursorY += 11;
		context.fill(x + PADDING, cursorY, x + width - PADDING, cursorY + 1, 0x50FFFFFF);
		cursorY += 3;

		// ---------------------------------------------------------- Items
		if (entries.isEmpty()) {
			context.drawText(text, "(leer)", textX, cursorY + 4, config.dimColor, config.showShadow);
			cursorY += rowHeight;
		}
		for (ScanResult.Entry entry : entries) {
			boolean watched = config.isWatched(entry.id);
			drawRow(context, text, config, entry, textX, cursorY, width, watched ? config.highlightColor : config.normalColor);
			cursorY += rowHeight;
			if (config.showEnchants && !entry.enchants.isEmpty()) {
				String enchants = String.join(", ", entry.enchants);
				context.drawText(text, enchants, textX + ICON + 4, cursorY - ROW_GAP, 0xFFAA66FF, config.showShadow);
				cursorY += 10 - ROW_GAP;
			}
		}

		// ---------------------------------------------------------- Rüstung / Offhand
		if (config.showArmor && !result.armor.isEmpty()) {
			cursorY += 2;
			cursorY = drawEquipmentRow(context, text, config, result.armor, textX, cursorY, "Rüstung");
		}
		if (config.showOffhand && !result.offhand.isEmpty()) {
			cursorY = drawEquipmentRow(context, text, config, result.offhand, textX, cursorY, "Offhand");
		}

		// ---------------------------------------------------------- Latenz
		if (config.showLatency && result.totalMs >= 0) {
			String latency = "Scan: " + result.totalMs + " ms";
			context.drawText(text, latency, x + width - PADDING - text.getWidth(latency), y + height - PADDING - 8, config.dimColor, config.showShadow);
		}
	}

	private static void drawRow(DrawContext context, TextRenderer text, InvCheckerConfig config,
			ScanResult.Entry entry, int x, int y, int panelWidth, int color) {
		ItemStack stack = stackOf(entry);
		context.drawItem(stack, x, y - 2);
		int textX = x + ICON + 4;
		String label = entry.displayName();
		context.drawText(text, label, textX, y + 3, color, config.showShadow);
		if (config.showCount) {
			String count = "x" + entry.count;
			context.drawText(text, count, textX + text.getWidth(label) + 4, y + 3, config.dimColor, config.showShadow);
		}
		if (config.showSlotNumber && entry.slot >= 0) {
			String slot = "#" + entry.slot;
			context.drawText(text, slot, x + panelWidth - PADDING - text.getWidth(slot) - 40, y + 3, config.dimColor, config.showShadow);
		}
		if (config.showDurability && entry.isDamageable()) {
			String durability = entry.durability;
			int dx = x + panelWidth - PADDING - text.getWidth(durability);
			float fraction = entry.durabilityFraction();
			int durabilityColor = fraction > 0.5F ? 0xFF55FF55 : (fraction > 0.2F ? 0xFFFFFF55 : 0xFFFF5555);
			context.drawText(text, durability, dx, y + 3, durabilityColor, config.showShadow);
		}
	}

	private static int drawEquipmentRow(DrawContext context, TextRenderer text, InvCheckerConfig config,
			List<ScanResult.Entry> entries, int x, int y, String label) {
		int cursorX = x;
		context.drawText(text, label, cursorX, y + 3, config.dimColor, config.showShadow);
		cursorX += text.getWidth(label) + 6;
		for (ScanResult.Entry entry : entries) {
			context.drawItem(stackOf(entry), cursorX, y - 2);
			cursorX += ICON + 2;
		}
		return y + ICON + ROW_GAP + 2;
	}

	/** ItemStack für das Icon – wird pro Entry gecacht. */
	public static ItemStack stackOf(ScanResult.Entry entry) {
		if (entry.cachedStack == null) {
			Item item = resolve(entry.id);
			ItemStack stack = new ItemStack(item);
			if (entry.count > 1) {
				stack.setCount(Math.min(entry.count, stack.getMaxCount()));
			}
			entry.cachedStack = stack;
		}
		return entry.cachedStack;
	}

	private static Item resolve(String id) {
		// 1.21.11: Registries.ITEM.get(String) existiert nicht mehr, es gibt nur
		// get(Identifier), get(RegistryKey) und get(int). Also erst parsen.
		try {
			Identifier identifier = Identifier.tryParse(id);
			if (identifier != null) {
				Item item = Registries.ITEM.get(identifier);
				if (item != null && item != Items.AIR) {
					return item;
				}
			}
		} catch (Exception error) {
			// unbekannte Item-ID (z. B. von einem Mod auf dem Server)
		}
		return Items.BARRIER;
	}

	private static int withAlpha(int rgb, int alpha) {
		return ((Math.max(0, Math.min(255, alpha)) & 0xFF) << 24) | (rgb & 0x00FFFFFF);
	}
}
