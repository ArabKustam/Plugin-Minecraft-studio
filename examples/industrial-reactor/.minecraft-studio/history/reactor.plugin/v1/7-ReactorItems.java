package dev.minecraftstudio.reactor.item;

import dev.minecraftstudio.reactor.config.Messages;
import dev.minecraftstudio.reactor.reactor.ReactorKeys;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.function.Supplier;

/** Factory and recognition of the plugin's custom items. */
public final class ReactorItems {

    /** Custom item kinds, stored as {@code reactor:item} in the item PDC. */
    public enum Kind {
        CORE("core", Material.IRON_BLOCK, "core_off"),
        PANEL("panel", Material.PAPER, "control_panel");

        private final String id;
        private final Material material;
        private final String model;

        Kind(String id, Material material, String model) {
            this.id = id;
            this.material = material;
            this.model = model;
        }

        public String id() {
            return id;
        }

        public static Optional<Kind> parse(String raw) {
            if (raw == null) {
                return Optional.empty();
            }
            for (Kind kind : values()) {
                if (kind.id.equals(raw.toLowerCase(Locale.ROOT))) {
                    return Optional.of(kind);
                }
            }
            return Optional.empty();
        }
    }

    private final Supplier<Messages> messages;

    public ReactorItems(Supplier<Messages> messages) {
        this.messages = messages;
    }

    public ItemStack create(Kind kind) {
        ItemStack item = new ItemStack(kind.material);
        ItemMeta meta = item.getItemMeta();
        Messages m = messages.get();
        String nameKey = kind == Kind.CORE ? "item-core" : "item-panel";
        meta.itemName(m.get(nameKey));
        meta.lore(List.of(m.get(nameKey + "-lore")));
        meta.setItemModel(ReactorKeys.model(kind.model));
        meta.getPersistentDataContainer().set(ReactorKeys.ITEM, PersistentDataType.STRING, kind.id);
        item.setItemMeta(meta);
        return item;
    }

    public static Optional<Kind> kindOf(ItemStack item) {
        if (item == null || item.getType().isAir() || !item.hasItemMeta()) {
            return Optional.empty();
        }
        String id = item.getItemMeta().getPersistentDataContainer().get(ReactorKeys.ITEM, PersistentDataType.STRING);
        return Kind.parse(id);
    }

    public static boolean is(ItemStack item, Kind kind) {
        return kindOf(item).filter(k -> k == kind).isPresent();
    }

    /** A display-only stack rendering the given {@code reactor:<model>} item model. */
    public static ItemStack model(String modelId) {
        ItemStack item = new ItemStack(Material.PAPER);
        ItemMeta meta = item.getItemMeta();
        meta.setItemModel(ReactorKeys.model(modelId));
        item.setItemMeta(meta);
        return item;
    }
}
