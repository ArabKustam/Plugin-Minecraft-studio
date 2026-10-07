package dev.minecraftstudio.reactor.listener;

import dev.minecraftstudio.reactor.command.ReactorActions;
import dev.minecraftstudio.reactor.config.Messages;
import dev.minecraftstudio.reactor.config.ReactorConfig;
import dev.minecraftstudio.reactor.gui.ControlPanelGui;
import dev.minecraftstudio.reactor.item.ReactorItems;
import dev.minecraftstudio.reactor.reactor.Reactor;
import dev.minecraftstudio.reactor.reactor.ReactorManager;
import dev.minecraftstudio.reactor.reactor.ReactorVisuals;
import io.papermc.paper.event.player.PrePlayerAttackEntityEvent;
import org.bukkit.Chunk;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.EquipmentSlot;

import java.util.Optional;
import java.util.function.Supplier;

/** Clicks on reactor entities, the Control Panel item and entity re-linking on chunk load. */
public final class ReactorEntityListener implements Listener {

    private final ReactorManager manager;
    private final ReactorActions actions;
    private final ControlPanelGui gui;
    private final Supplier<ReactorConfig> config;
    private final Supplier<Messages> messages;

    public ReactorEntityListener(ReactorManager manager, ReactorActions actions, ControlPanelGui gui,
                                 Supplier<ReactorConfig> config, Supplier<Messages> messages) {
        this.manager = manager;
        this.actions = actions;
        this.gui = gui;
        this.config = config;
        this.messages = messages;
    }

    private Optional<Reactor> reactorOf(Entity entity) {
        return manager.get(ReactorVisuals.reactorId(entity));
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onInteractEntity(PlayerInteractEntityEvent event) {
        Optional<Reactor> reactor = reactorOf(event.getRightClicked());
        if (reactor.isEmpty()) {
            return;
        }
        event.setCancelled(true);
        if (event.getHand() != EquipmentSlot.HAND) {
            return;
        }
        openPanel(event.getPlayer(), reactor.get());
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onAttack(PrePlayerAttackEntityEvent event) {
        Optional<Reactor> reactor = reactorOf(event.getAttacked());
        if (reactor.isEmpty()) {
            return;
        }
        event.setCancelled(true);
        Player player = event.getPlayer();
        if (player.isSneaking() && player.hasPermission("reactor.admin")) {
            actions.remove(player, reactor.get(), true);
        }
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onUsePanel(PlayerInteractEvent event) {
        if (event.getHand() != EquipmentSlot.HAND
                || (event.getAction() != Action.RIGHT_CLICK_AIR && event.getAction() != Action.RIGHT_CLICK_BLOCK)
                || !ReactorItems.is(event.getItem(), ReactorItems.Kind.PANEL)) {
            return;
        }
        event.setCancelled(true);
        Player player = event.getPlayer();
        Optional<Reactor> nearest = manager.nearest(player.getLocation(), config.get().panelRange());
        if (nearest.isEmpty()) {
            messages.get().send(player, "no-reactor-nearby");
            return;
        }
        openPanel(player, nearest.get());
    }

    private void openPanel(Player player, Reactor reactor) {
        if (!player.hasPermission("reactor.use")) {
            messages.get().send(player, "no-permission");
            return;
        }
        gui.open(player, reactor);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onEntitiesLoad(EntitiesLoadEvent event) {
        Chunk chunk = event.getChunk();
        manager.onEntitiesLoaded(chunk.getWorld(), chunk.getX(), chunk.getZ(), event.getEntities());
    }
}
