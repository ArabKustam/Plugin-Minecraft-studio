package dev.minecraftstudio.reactor.listener;

import dev.minecraftstudio.reactor.config.Messages;
import dev.minecraftstudio.reactor.item.ReactorItems;
import dev.minecraftstudio.reactor.reactor.Reactor;
import dev.minecraftstudio.reactor.reactor.ReactorManager;
import org.bukkit.GameMode;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.plugin.Plugin;

import java.util.function.Supplier;

/** Placing the Reactor Core item builds a reactor; the core barrier cannot be broken by hand. */
public final class ReactorBlockListener implements Listener {

    private final Plugin plugin;
    private final ReactorManager manager;
    private final Supplier<Messages> messages;

    public ReactorBlockListener(Plugin plugin, ReactorManager manager, Supplier<Messages> messages) {
        this.plugin = plugin;
        this.manager = manager;
        this.messages = messages;
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        if (!ReactorItems.is(event.getItemInHand(), ReactorItems.Kind.CORE)) {
            return;
        }
        // The iron block is never placed. The server reverts the cancelled placement after this
        // handler, so the reactor (and its barrier) is built on the next tick.
        event.setCancelled(true);
        Player player = event.getPlayer();
        if (!player.hasPermission("reactor.use")) {
            messages.get().send(player, "no-permission");
            return;
        }
        Block block = event.getBlockPlaced();
        EquipmentSlot hand = event.getHand();
        plugin.getServer().getScheduler().runTask(plugin, () -> build(player, block, hand));
    }

    private void build(Player player, Block block, EquipmentSlot hand) {
        if (!player.isOnline() || manager.at(block).isPresent()
                || !(block.getType().isAir() || block.isReplaceable())) {
            return;
        }
        if (player.getGameMode() != GameMode.CREATIVE && !consumeCore(player.getInventory(), hand)) {
            return;
        }
        Reactor reactor = manager.create(block);
        messages.get().send(player, "placed", "id", reactor.id());
    }

    /** Removes one core item, preferring the hand that placed it. */
    private static boolean consumeCore(PlayerInventory inventory, EquipmentSlot hand) {
        ItemStack inHand = inventory.getItem(hand);
        if (ReactorItems.is(inHand, ReactorItems.Kind.CORE)) {
            inHand.setAmount(inHand.getAmount() - 1);
            inventory.setItem(hand, inHand.getAmount() > 0 ? inHand : null);
            return true;
        }
        for (int slot = 0; slot < inventory.getSize(); slot++) {
            ItemStack item = inventory.getItem(slot);
            if (ReactorItems.is(item, ReactorItems.Kind.CORE)) {
                item.setAmount(item.getAmount() - 1);
                inventory.setItem(slot, item.getAmount() > 0 ? item : null);
                return true;
            }
        }
        return false;
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        if (manager.at(event.getBlock()).isPresent()) {
            event.setCancelled(true);
        }
    }
}
