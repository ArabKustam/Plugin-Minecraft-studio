package dev.minecraftstudio.reactor.gui;

import dev.minecraftstudio.reactor.command.ReactorActions;
import dev.minecraftstudio.reactor.reactor.Reactor;
import dev.minecraftstudio.reactor.reactor.ReactorManager;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;

/** Handles clicks in control panel inventories. All clicks are cancelled. */
public final class ControlPanelListener implements Listener {

    public static final String PERMISSION = "reactor.use";

    private final ReactorManager manager;
    private final ReactorActions actions;

    public ControlPanelListener(ReactorManager manager, ReactorActions actions) {
        this.manager = manager;
        this.actions = actions;
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onClick(InventoryClickEvent event) {
        Inventory top = event.getView().getTopInventory();
        if (!(top.getHolder(false) instanceof ControlPanelHolder holder)) {
            return;
        }
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player) || event.getClickedInventory() != top) {
            return;
        }
        Reactor reactor = manager.get(holder.reactorId()).orElse(null);
        if (reactor == null) {
            player.closeInventory();
            return;
        }
        if (!player.hasPermission(PERMISSION)) {
            return;
        }
        int slot = event.getRawSlot();
        switch (slot) {
            case ControlPanelGui.SLOT_START -> actions.start(player, reactor);
            case ControlPanelGui.SLOT_STOP -> actions.stop(player, reactor);
            case ControlPanelGui.SLOT_SCRAM -> actions.scram(player, reactor);
            case ControlPanelGui.SLOT_COOLANT -> actions.coolant(player, reactor, !reactor.coolant());
            default -> {
                for (int i = 0; i < ControlPanelGui.POWER_SLOTS.length; i++) {
                    if (ControlPanelGui.POWER_SLOTS[i] == slot) {
                        actions.power(player, reactor, ControlPanelGui.POWER_LEVELS[i]);
                    }
                }
            }
        }
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder(false) instanceof ControlPanelHolder) {
            event.setCancelled(true);
        }
    }
}
