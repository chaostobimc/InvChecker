package net.invchecker.scan;

import java.util.ArrayList;
import java.util.List;

/**
 * Ein gescanntes Inventar, genau so wie der Bot es schickt.
 * Die Feldnamen entsprechen dem JSON des Bots (bot/lib/scanner.js).
 */
public final class ScanResult {

	public String target = "?";
	public String targetName = "";
	public String windowTitle = "";
	public boolean titleMatched;
	public String windowType = "";
	public List<Entry> items = new ArrayList<>();
	public List<Entry> armor = new ArrayList<>();
	public List<Entry> offhand = new ArrayList<>();
	public long totalMs = -1;
	public long commandToWindowMs = -1;
	public long windowToReadMs = -1;
	public long receivedAtMs;

	public boolean isEmpty() {
		return items.isEmpty() && armor.isEmpty() && offhand.isEmpty();
	}

	/** Ein einzelner Stack. */
	public static final class Entry {
		public int slot;
		public String id = "minecraft:air";
		public String name = "?";
		public String customName;
		public int count = 1;
		public List<String> enchants = new ArrayList<>();
		public String durability;

		// Caches, damit das HUD pro Frame nichts neu bauen muss.
		public transient net.minecraft.item.ItemStack cachedStack;
		public transient String cachedDisplayName;
		public transient int cachedWidth = -1;

		public String displayName() {
			if (cachedDisplayName == null) {
				cachedDisplayName = (customName != null && !customName.isBlank()) ? customName : name;
			}
			return cachedDisplayName;
		}

		public boolean isDamageable() {
			return durability != null && !durability.isEmpty();
		}

		public float durabilityFraction() {
			if (durability == null) {
				return 1.0F;
			}
			int slash = durability.indexOf('/');
			if (slash <= 0) {
				return 1.0F;
			}
			try {
				int left = Integer.parseInt(durability.substring(0, slash).trim());
				int max = Integer.parseInt(durability.substring(slash + 1).trim());
				return max <= 0 ? 1.0F : Math.max(0.0F, Math.min(1.0F, (float) left / max));
			} catch (NumberFormatException error) {
				return 1.0F;
			}
		}
	}
}
