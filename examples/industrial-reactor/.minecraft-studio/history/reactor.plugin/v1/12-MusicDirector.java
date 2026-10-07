package dev.minecraftstudio.reactor.music;

import dev.minecraftstudio.reactor.config.ReactorConfig;
import dev.minecraftstudio.reactor.reactor.Reactor;
import dev.minecraftstudio.reactor.reactor.ReactorManager;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.SoundCategory;
import org.bukkit.entity.Player;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Per player adaptive music. Every player within the music radius of an active reactor hears the
 * mood of the most alarming reactor nearby: intro, then the seamless loop re-triggered exactly
 * every loop length; mood changes wait for the next bar / transition point.
 */
public final class MusicDirector {

    private static final int DESIRE_INTERVAL_TICKS = 10;
    private static final SoundCategory CATEGORY = SoundCategory.RECORDS;

    private record Desire(MusicState state, Quantize quantize) {
    }

    private final Supplier<ReactorConfig> config;
    private final Supplier<MusicLibrary> library;
    private final ReactorManager reactors;
    private final Map<UUID, MusicSession> sessions = new HashMap<>();

    public MusicDirector(Supplier<ReactorConfig> config, Supplier<MusicLibrary> library, ReactorManager reactors) {
        this.config = config;
        this.library = library;
        this.reactors = reactors;
    }

    public void tick(long now) {
        boolean evaluate = now % DESIRE_INTERVAL_TICKS == 0;
        for (Player player : Bukkit.getOnlinePlayers()) {
            MusicSession session = sessions.computeIfAbsent(player.getUniqueId(), id -> new MusicSession());
            if (evaluate) {
                Desire desire = desire(player);
                session.request(desire.state(), desire.quantize(), now);
            }
            if (session.switchDue(now)) {
                switchTrack(player, session, now);
            }
            if (session.loopDue(now)) {
                play(player, session.playing(), "loop");
                session.loopStarted();
            }
        }
    }

    private void play(Player player, MusicState state, String part) {
        // Emitter = the player: the music follows the listener and is never attenuated.
        player.playSound(player, state.sound(prefix(), part), CATEGORY, 1.0f, 1.0f);
    }

    private void stop(Player player, MusicState state, String part) {
        player.stopSound(state.sound(prefix(), part), CATEGORY);
    }

    private String prefix() {
        return config.get().musicSoundPrefix();
    }

    private Desire desire(Player player) {
        double radius = config.get().musicRadius();
        double r2 = radius * radius;
        Location location = player.getLocation();
        Desire best = new Desire(MusicState.NONE, Quantize.BAR);
        for (Reactor reactor : reactors.all()) {
            if (reactor.musicState().priority() <= best.state().priority()
                    || !reactor.worldName().equals(location.getWorld().getName()) || !reactor.isLoaded()) {
                continue;
            }
            Location center = reactor.center();
            if (center != null && center.distanceSquared(location) <= r2) {
                best = new Desire(reactor.musicState(), reactor.musicQuantize());
            }
        }
        return best;
    }

    private void switchTrack(Player player, MusicSession session, long now) {
        MusicState next = session.pending();
        MusicState previous = session.playing();
        MusicMetadata previousTrack = session.track();
        stopCurrent(player, session);
        MusicMetadata metadata = next == MusicState.NONE ? null : library.get().get(next).orElse(null);
        if (session.start(next, metadata, now)) {
            play(player, next, "intro");
        }
        if (metadata == null && previousTrack != null && previousTrack.hasOutro()) {
            // Going silent on a bar line: let the old mood ring out with its outro.
            play(player, previous, "outro");
            session.outroStarted(previous);
        }
        if (session.loopDue(now)) {
            play(player, next, "loop");
            session.loopStarted();
        }
    }

    private void stopCurrent(Player player, MusicSession session) {
        MusicState current = session.playing();
        if (current != MusicState.NONE) {
            stop(player, current, "intro");
            stop(player, current, "loop");
        }
        if (session.outro() != null) {
            stop(player, session.outro(), "outro");
        }
    }

    /** Immediately silences a player (world change) and lets the director pick music again. */
    public void reset(Player player) {
        MusicSession session = sessions.remove(player.getUniqueId());
        if (session != null) {
            stopCurrent(player, session);
        }
    }

    /** Drops the state of a player that left. */
    public void forget(UUID player) {
        sessions.remove(player);
    }

    /** Stops music for everyone (plugin disable). */
    public void stopAll() {
        for (Map.Entry<UUID, MusicSession> e : sessions.entrySet()) {
            Player player = Bukkit.getPlayer(e.getKey());
            if (player != null) {
                stopCurrent(player, e.getValue());
            }
        }
        sessions.clear();
    }
}
