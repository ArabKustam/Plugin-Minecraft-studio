package dev.minecraftstudio.reactor.reactor;

import dev.minecraftstudio.reactor.state.ReactorState;
import dev.minecraftstudio.reactor.util.ReactorSounds;
import org.bukkit.Location;
import org.bukkit.SoundCategory;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.DoubleSupplier;

/**
 * Re-triggers seamless ambient loops at the core location. State driven loops (engine, siren,
 * alarm beep) follow the reactor state; timeline loops ({@code sfx} cues with {@code loop: true})
 * run until stopped by a cue or until the reactor turns off. Leaving a loop stops the sound for
 * nearby players.
 */
public final class AmbientLoops {

    /** A looping sound and its re-trigger period. */
    public record LoopSpec(String sound, int intervalTicks, float volume, float pitch) {
    }

    public static final LoopSpec ENGINE = new LoopSpec(ReactorSounds.ENGINE_LOOP, 80, 1.0f, 1.0f);
    public static final LoopSpec SIREN = new LoopSpec(ReactorSounds.SIREN, 80, 2.0f, 1.0f);
    public static final LoopSpec ALARM_BEEP = new LoopSpec(ReactorSounds.ALARM_BEEP, 20, 1.0f, 1.0f);

    private static final SoundCategory CATEGORY = SoundCategory.BLOCKS;

    private static final class Active {
        private final LoopSpec spec;
        private long nextTick;

        private Active(LoopSpec spec, long nextTick) {
            this.spec = spec;
            this.nextTick = nextTick;
        }
    }

    private final Map<String, Map<String, Active>> active = new HashMap<>();
    private final Map<String, Map<String, LoopSpec>> timelineLoops = new HashMap<>();
    private final DoubleSupplier stopRadius;

    /** @param stopRadius radius in which players get a stopSound when a loop ends */
    public AmbientLoops(DoubleSupplier stopRadius) {
        this.stopRadius = stopRadius;
    }

    /** Loops that belong to a lifecycle state. */
    public static List<LoopSpec> stateLoops(ReactorState state) {
        return switch (state) {
            case RUNNING -> List.of(ENGINE);
            case WARNING -> List.of(ENGINE, ALARM_BEEP);
            case CRITICAL -> List.of(ENGINE, SIREN);
            default -> List.of();
        };
    }

    public void startTimelineLoop(Reactor reactor, LoopSpec spec) {
        timelineLoops.computeIfAbsent(reactor.id(), k -> new LinkedHashMap<>()).put(spec.sound(), spec);
    }

    /** Stops a loop (timeline or state driven) right now. State loops resume if still desired. */
    public void stop(Reactor reactor, String sound) {
        Map<String, LoopSpec> loops = timelineLoops.get(reactor.id());
        if (loops != null) {
            loops.remove(sound);
        }
        Map<String, Active> running = active.get(reactor.id());
        if (running != null) {
            running.remove(sound);
        }
        Location center = reactor.center();
        if (center != null) {
            SoundPlayer.stopNearby(center, stopRadius.getAsDouble(), sound, CATEGORY);
        }
    }

    public void clearTimelineLoops(Reactor reactor) {
        timelineLoops.remove(reactor.id());
    }

    /** Starts, re-triggers and stops loops so they match the reactor state. */
    public void tick(Reactor reactor, long now) {
        Map<String, LoopSpec> desired = new LinkedHashMap<>();
        for (LoopSpec spec : stateLoops(reactor.state())) {
            desired.put(spec.sound(), spec);
        }
        desired.putAll(timelineLoops.getOrDefault(reactor.id(), Map.of()));

        Map<String, Active> running = active.computeIfAbsent(reactor.id(), k -> new HashMap<>());
        Location center = reactor.center();
        if (center == null) {
            return;
        }
        for (String sound : new ArrayList<>(running.keySet())) {
            if (!desired.containsKey(sound)) {
                running.remove(sound);
                SoundPlayer.stopNearby(center, stopRadius.getAsDouble(), sound, CATEGORY);
            }
        }
        for (LoopSpec spec : desired.values()) {
            Active loop = running.get(spec.sound());
            if (loop == null) {
                loop = new Active(spec, now);
                running.put(spec.sound(), loop);
            }
            if (now >= loop.nextTick) {
                SoundPlayer.playAt(center, spec.sound(), CATEGORY, spec.volume(), spec.pitch());
                loop.nextTick = now + loop.spec.intervalTicks();
            }
        }
    }

    /** Stops everything for the reactor and forgets it. */
    public void forget(Reactor reactor) {
        Map<String, Active> running = active.remove(reactor.id());
        timelineLoops.remove(reactor.id());
        Location center = reactor.center();
        if (running != null && center != null) {
            running.keySet().forEach(s -> SoundPlayer.stopNearby(center, stopRadius.getAsDouble(), s, CATEGORY));
        }
    }
}
