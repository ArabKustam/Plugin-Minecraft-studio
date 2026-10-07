package dev.minecraftstudio.reactor.reactor;

import dev.minecraftstudio.reactor.config.Messages;
import dev.minecraftstudio.reactor.config.ReactorConfig;
import dev.minecraftstudio.reactor.state.ReactorState;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;

import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

/** One Adventure boss bar per reactor, shown to players within the music radius. */
public final class ReactorBossBars {

    private final Supplier<ReactorConfig> config;
    private final Supplier<Messages> messages;
    private final Map<String, BossBar> bars = new HashMap<>();
    private final Map<String, Set<UUID>> viewers = new HashMap<>();

    public ReactorBossBars(Supplier<ReactorConfig> config, Supplier<Messages> messages) {
        this.config = config;
        this.messages = messages;
    }

    public static BossBar.Color colorFor(ReactorState state) {
        return switch (state) {
            case OFF -> BossBar.Color.WHITE;
            case STARTING, SHUTTING_DOWN -> BossBar.Color.BLUE;
            case RUNNING -> BossBar.Color.GREEN;
            case WARNING -> BossBar.Color.YELLOW;
            case CRITICAL -> BossBar.Color.RED;
            case FAILED -> BossBar.Color.PURPLE;
        };
    }

    /** Refreshes titles and the viewer sets of every reactor. */
    public void update(Collection<Reactor> reactors, long now) {
        ReactorConfig cfg = config.get();
        for (Reactor reactor : reactors) {
            BossBar bar = bars.computeIfAbsent(reactor.id(), id -> BossBar.bossBar(Component.empty(), 0f,
                    BossBar.Color.WHITE, BossBar.Overlay.NOTCHED_10));
            Reactor.UiOverride override = reactor.uiOverride(now);
            render(reactor, bar, override);
            boolean visible = cfg.bossbar() && reactor.isLoaded()
                    && (reactor.state() != ReactorState.OFF || override != null);
            Location center = visible ? reactor.center() : null;
            Set<UUID> shown = viewers.computeIfAbsent(reactor.id(), id -> new HashSet<>());
            double r2 = cfg.musicRadius() * cfg.musicRadius();
            for (Player player : Bukkit.getOnlinePlayers()) {
                boolean inRange = center != null && player.getWorld().equals(center.getWorld())
                        && player.getLocation().distanceSquared(center) <= r2;
                if (inRange && shown.add(player.getUniqueId())) {
                    player.showBossBar(bar);
                } else if (!inRange && shown.remove(player.getUniqueId())) {
                    player.hideBossBar(bar);
                }
            }
        }
    }

    private void render(Reactor reactor, BossBar bar, Reactor.UiOverride override) {
        if (override != null) {
            bar.name(Component.text(override.title()));
            bar.progress(override.progress());
            BossBar.Color color = override.color() == null ? null : BossBar.Color.NAMES.value(override.color());
            bar.color(color != null ? color : colorFor(reactor.state()));
            return;
        }
        bar.name(messages.get().get("bossbar",
                "id", reactor.id(),
                "state", reactor.state().name(),
                "heat", String.valueOf((int) Math.round(reactor.heat())),
                "power", String.valueOf(reactor.power())));
        bar.progress((float) Math.max(0, Math.min(1, reactor.heat() / 100.0)));
        bar.color(colorFor(reactor.state()));
    }

    public void forgetPlayer(UUID player) {
        viewers.values().forEach(set -> set.remove(player));
    }

    /** Hides and drops the bar of a removed reactor. */
    public void remove(String reactorId) {
        BossBar bar = bars.remove(reactorId);
        Set<UUID> shown = viewers.remove(reactorId);
        if (bar != null && shown != null) {
            for (UUID uuid : shown) {
                Player player = Bukkit.getPlayer(uuid);
                if (player != null) {
                    player.hideBossBar(bar);
                }
            }
        }
    }

    public void removeAll() {
        for (String id : Set.copyOf(bars.keySet())) {
            remove(id);
        }
    }
}
