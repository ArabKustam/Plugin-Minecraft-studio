package dev.minecraftstudio.reactor.listener;

import dev.minecraftstudio.reactor.music.MusicDirector;
import dev.minecraftstudio.reactor.reactor.ReactorBossBars;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** Per player cleanup so music sessions and boss bar viewers never leak. */
public final class PlayerSessionListener implements Listener {

    private final MusicDirector music;
    private final ReactorBossBars bossBars;

    public PlayerSessionListener(MusicDirector music, ReactorBossBars bossBars) {
        this.music = music;
        this.bossBars = bossBars;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        music.forget(event.getPlayer().getUniqueId());
        bossBars.forgetPlayer(event.getPlayer().getUniqueId());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onWorldChange(PlayerChangedWorldEvent event) {
        // Music of the old world stops immediately instead of waiting for the next bar.
        music.reset(event.getPlayer());
    }
}
