package dev.minecraftstudio.reactor.gui;

import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;

/** Marks a control panel inventory and remembers which reactor it controls. */
public final class ControlPanelHolder implements InventoryHolder {

    private final String reactorId;
    private Inventory inventory;

    ControlPanelHolder(String reactorId) {
        this.reactorId = reactorId;
    }

    public String reactorId() {
        return reactorId;
    }

    void setInventory(Inventory inventory) {
        this.inventory = inventory;
    }

    @Override
    public Inventory getInventory() {
        return inventory;
    }
}
