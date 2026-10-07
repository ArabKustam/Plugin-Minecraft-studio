package dev.minecraftstudio.reactor.gui;

import dev.minecraftstudio.reactor.config.Messages;
import dev.minecraftstudio.reactor.reactor.Reactor;
import dev.minecraftstudio.reactor.reactor.ReactorKeys;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.List;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Supplier;

/** Builds and refreshes the 27 slot reactor control panel. */
public final class ControlPanelGui {

    public static final int SLOT_STATUS = 4;
    public static final int SLOT_START = 10;
    public static final int SLOT_STOP = 11;
    public static final int SLOT_SCRAM = 12;
    public static final int SLOT_COOLANT = 16;
    public static final int[] POWER_SLOTS = {19, 20, 21, 22};
    public static final int[] POWER_LEVELS = {25, 50, 75, 100};

    private final Supplier<Messages> messages;

    public ControlPanelGui(Supplier<Messages> messages) {
        this.messages = messages;
    }

    public void open(Player player, Reactor reactor) {
        ControlPanelHolder holder = new ControlPanelHolder(reactor.id());
        Inventory inventory = Bukkit.createInventory(holder, 27, messages.get().get("gui-title", "id", reactor.id()));
        holder.setInventory(inventory);
        render(inventory, reactor);
        player.openInventory(inventory);
    }

    /** Re-renders every open panel of {@code reactor}. */
    public void refreshOpen(Reactor reactor) {
        for (Player player : Bukkit.getOnlinePlayers()) {
            Inventory top = player.getOpenInventory().getTopInventory();
            if (top.getHolder(false) instanceof ControlPanelHolder holder && holder.reactorId().equals(reactor.id())) {
                render(top, reactor);
            }
        }
    }

    /** Re-renders every open panel (called periodically so heat and state stay live). */
    public void refreshAll(Function<String, Optional<Reactor>> lookup) {
        for (Player player : Bukkit.getOnlinePlayers()) {
            Inventory top = player.getOpenInventory().getTopInventory();
            if (top.getHolder(false) instanceof ControlPanelHolder holder) {
                lookup.apply(holder.reactorId()).ifPresent(reactor -> render(top, reactor));
            }
        }
    }

    /** Closes panels of a removed reactor. */
    public void closeFor(String reactorId) {
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.getOpenInventory().getTopInventory().getHolder(false) instanceof ControlPanelHolder holder
                    && holder.reactorId().equals(reactorId)) {
                player.closeInventory();
            }
        }
    }

    private void render(Inventory inventory, Reactor reactor) {
        Messages m = messages.get();
        String id = reactor.id();
        String heat = String.valueOf((int) Math.round(reactor.heat()));
        String power = String.valueOf(reactor.power());
        String coolant = m.raw(reactor.coolant() ? "on" : "off");

        ItemStack filler = item(Material.GRAY_STAINED_GLASS_PANE, Component.space(), List.of());
        for (int i = 0; i < inventory.getSize(); i++) {
            inventory.setItem(i, filler);
        }
        ItemStack status = item(Material.PAPER, m.get("gui-status", "id", id), List.of(
                m.get("gui-status-state", "state", reactor.state().name()),
                m.get("gui-status-heat", "heat", heat),
                m.get("gui-status-power", "power", power),
                m.get("gui-coolant", "coolant", coolant)));
        ItemMeta statusMeta = status.getItemMeta();
        statusMeta.setItemModel(ReactorKeys.model("control_panel"));
        status.setItemMeta(statusMeta);
        inventory.setItem(SLOT_STATUS, status);

        inventory.setItem(SLOT_START, item(Material.LIME_CONCRETE, m.get("gui-start"), List.of()));
        inventory.setItem(SLOT_STOP, item(Material.YELLOW_CONCRETE, m.get("gui-stop"), List.of()));
        inventory.setItem(SLOT_SCRAM, item(Material.TNT, m.get("gui-scram"), List.of(m.get("gui-scram-lore"))));
        inventory.setItem(SLOT_COOLANT, item(reactor.coolant() ? Material.BLUE_ICE : Material.MAGMA_BLOCK,
                m.get("gui-coolant", "coolant", coolant), List.of()));
        for (int i = 0; i < POWER_SLOTS.length; i++) {
            boolean selected = reactor.power() == POWER_LEVELS[i];
            ItemStack button = item(selected ? Material.LIGHT_BLUE_STAINED_GLASS : Material.WHITE_STAINED_GLASS,
                    m.get("gui-power", "power", String.valueOf(POWER_LEVELS[i])), List.of());
            button.setAmount(i + 1);
            inventory.setItem(POWER_SLOTS[i], button);
        }
    }

    private static ItemStack item(Material material, Component name, List<Component> lore) {
        ItemStack stack = new ItemStack(material);
        ItemMeta meta = stack.getItemMeta();
        meta.itemName(name);
        if (!lore.isEmpty()) {
            meta.lore(lore);
        }
        stack.setItemMeta(meta);
        return stack;
    }
}
