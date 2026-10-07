package dev.minecraftstudio.reactor.reactor;

import dev.minecraftstudio.reactor.config.ReactorConfig;
import dev.minecraftstudio.reactor.item.ReactorItems;
import dev.minecraftstudio.reactor.music.MusicState;
import dev.minecraftstudio.reactor.music.Quantize;
import dev.minecraftstudio.reactor.sim.HeatSimulation;
import dev.minecraftstudio.reactor.state.CoreTexture;
import dev.minecraftstudio.reactor.state.ReactorState;
import dev.minecraftstudio.reactor.state.StateTransitions;
import dev.minecraftstudio.reactor.storage.ReactorRecord;
import dev.minecraftstudio.reactor.storage.ReactorStorage;
import dev.minecraftstudio.reactor.timeline.Cue;
import dev.minecraftstudio.reactor.timeline.Timeline;
import dev.minecraftstudio.reactor.timeline.TimelineLibrary;
import dev.minecraftstudio.reactor.timeline.TimelinePlayer;
import dev.minecraftstudio.reactor.util.ReactorSounds;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.SoundCategory;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.logging.Logger;

/**
 * Owns all reactors: registry, state machine enforcement, state side effects and the per tick
 * simulation. Main thread only.
 */
public final class ReactorManager {

    /** Outcome of a player/command action. */
    public enum ActionResult { OK, NOT_ALLOWED, TOO_HOT, RESET }

    private static final int RELINK_INTERVAL_TICKS = 100;
    private static final int BOSSBAR_INTERVAL_TICKS = 10;

    private final Supplier<ReactorConfig> config;
    private final Supplier<TimelineLibrary> timelines;
    private final ReactorItems items;
    private final Logger logger;
    private final ReactorVisuals visuals = new ReactorVisuals();
    private final AmbientLoops ambient;
    private final ReactorBossBars bossBars;
    private final TimelinePlayer timelinePlayer;
    private final Runnable onStructureChanged;
    private final Map<String, Reactor> reactors = new LinkedHashMap<>();
    private final Set<String> pendingRelink = new HashSet<>();

    private int nextId = 1;
    private long now;

    public ReactorManager(Supplier<ReactorConfig> config, Supplier<TimelineLibrary> timelines, ReactorItems items,
                          ReactorBossBars bossBars, Logger logger, Runnable onStructureChanged) {
        this.config = config;
        this.timelines = timelines;
        this.items = items;
        this.bossBars = bossBars;
        this.logger = logger;
        this.onStructureChanged = onStructureChanged;
        this.ambient = new AmbientLoops(() -> config.get().musicRadius());
        this.timelinePlayer = new TimelinePlayer(new ReactorCueHandler(this, visuals, ambient, logger));
    }

    // ------------------------------------------------------------------ registry

    public long currentTick() {
        return now;
    }

    public Optional<Reactor> get(String id) {
        return Optional.ofNullable(id == null ? null : reactors.get(id));
    }

    public Collection<Reactor> all() {
        return Collections.unmodifiableCollection(reactors.values());
    }

    public Optional<Reactor> nearest(Location location, double range) {
        Reactor best = null;
        double bestDistance = range * range;
        for (Reactor reactor : reactors.values()) {
            Location center = reactor.center();
            if (center == null || !center.getWorld().equals(location.getWorld())) {
                continue;
            }
            double d = center.distanceSquared(location);
            if (d <= bestDistance) {
                best = reactor;
                bestDistance = d;
            }
        }
        return Optional.ofNullable(best);
    }

    public Optional<Reactor> at(Block block) {
        for (Reactor reactor : reactors.values()) {
            if (reactor.worldName().equals(block.getWorld().getName()) && reactor.x() == block.getX()
                    && reactor.y() == block.getY() && reactor.z() == block.getZ()) {
                return Optional.of(reactor);
            }
        }
        return Optional.empty();
    }

    public Reactor create(Block block) {
        ReactorConfig cfg = config.get();
        String id = String.valueOf(nextId++);
        Reactor reactor = new Reactor(id, block.getWorld().getName(), block.getX(), block.getY(), block.getZ(),
                cfg.rotorSpeed(), cfg.voiceMinGapTicks());
        reactor.setPower(cfg.defaultPower());
        reactors.put(id, reactor);
        visuals.ensureSpawned(reactor);
        onStructureChanged.run();
        return reactor;
    }

    public void remove(Reactor reactor, boolean dropItem) {
        timelinePlayer.cancel(reactor.id());
        ambient.forget(reactor);
        bossBars.remove(reactor.id());
        Location center = reactor.center();
        visuals.destroy(reactor);
        reactors.remove(reactor.id());
        pendingRelink.remove(reactor.id());
        if (dropItem && center != null) {
            center.getWorld().dropItemNaturally(center, items.create(ReactorItems.Kind.CORE));
        }
        onStructureChanged.run();
    }

    // ------------------------------------------------------------------ actions

    public ActionResult start(Reactor reactor) {
        if (reactor.state() != ReactorState.OFF) {
            return ActionResult.NOT_ALLOWED;
        }
        if (reactor.heat() >= config.get().heat().resume()) {
            return ActionResult.TOO_HOT;
        }
        return transition(reactor, ReactorState.STARTING) ? ActionResult.OK : ActionResult.NOT_ALLOWED;
    }

    /** Regular shutdown of an active reactor, or reset of a failed one once it cooled down. */
    public ActionResult stop(Reactor reactor) {
        if (reactor.state() == ReactorState.FAILED) {
            if (reactor.heat() >= config.get().heat().warning()) {
                return ActionResult.TOO_HOT;
            }
            return transition(reactor, ReactorState.OFF) ? ActionResult.RESET : ActionResult.NOT_ALLOWED;
        }
        if (!reactor.state().isActive()) {
            return ActionResult.NOT_ALLOWED;
        }
        reactor.setShutdownMode(Reactor.ShutdownMode.NORMAL);
        return transition(reactor, ReactorState.SHUTTING_DOWN) ? ActionResult.OK : ActionResult.NOT_ALLOWED;
    }

    public ActionResult scram(Reactor reactor) {
        if (!reactor.state().isActive()) {
            return ActionResult.NOT_ALLOWED;
        }
        reactor.setShutdownMode(Reactor.ShutdownMode.SCRAM);
        return transition(reactor, ReactorState.SHUTTING_DOWN) ? ActionResult.OK : ActionResult.NOT_ALLOWED;
    }

    public void setPower(Reactor reactor, int power) {
        reactor.setPower(ReactorConfig.normalizePower(power));
    }

    public void setCoolant(Reactor reactor, boolean coolant) {
        reactor.setCoolant(coolant);
    }

    /** Admin/testing: sets the heat and immediately re-evaluates the thresholds. */
    public void setHeat(Reactor reactor, double heat) {
        reactor.setHeat(HeatSimulation.clampHeat(heat));
        evaluateHeat(reactor);
    }

    // ------------------------------------------------------------------ state machine

    /** Applies a transition if the table allows it, running the side effects of the new state. */
    public boolean transition(Reactor reactor, ReactorState to) {
        ReactorState from = reactor.state();
        if (!StateTransitions.isAllowed(from, to)) {
            logger.fine(() -> "Reactor #" + reactor.id() + ": rejected transition " + from + " -> " + to);
            return false;
        }
        reactor.setState(to);
        logger.fine(() -> "Reactor #" + reactor.id() + ": " + from + " -> " + to);
        onEnter(reactor, from, to);
        return true;
    }

    /** {@code state} cues may only finish the timeline-owned states STARTING and SHUTTING_DOWN. */
    void applyTimelineState(Reactor reactor, ReactorState target) {
        ReactorState current = reactor.state();
        if (current == target) {
            return;
        }
        if (current == ReactorState.STARTING || current == ReactorState.SHUTTING_DOWN) {
            transition(reactor, target);
        } else {
            logger.fine(() -> "Reactor #" + reactor.id() + ": ignoring state cue " + target + " while " + current);
        }
    }

    private void onEnter(Reactor reactor, ReactorState from, ReactorState to) {
        ReactorConfig cfg = config.get();
        switch (to) {
            case STARTING -> {
                visuals.setTexture(reactor, CoreTexture.OFF);
                Optional<Timeline> startup = timelines.get().get(TimelineLibrary.STARTUP);
                if (startup.map(t -> !t.hasCue(Cue.Music.class)).orElse(true)) {
                    reactor.setMusic(MusicState.CALM, Quantize.BAR);
                }
                if (startup.isPresent()) {
                    timelinePlayer.play(reactor.id(), startup.get(), now, () -> {
                        if (reactor.state() == ReactorState.STARTING) {
                            transition(reactor, ReactorState.RUNNING);
                        }
                    });
                } else {
                    reactor.rotor().apply(RotorAnimation.SPIN_UP, 2.0, now);
                    transition(reactor, ReactorState.RUNNING);
                }
            }
            case RUNNING -> {
                visuals.setTexture(reactor, CoreTexture.ACTIVE);
                reactor.setMusic(MusicState.CALM, Quantize.BAR);
                if (reactor.rotor().targetSpeed() == 0) {
                    reactor.rotor().apply(RotorAnimation.SPIN_UP, 1.0, now);
                }
                if (reactor.lightLevel() == 0) {
                    visuals.setLight(reactor, cfg.runningLightLevel());
                }
                if (from == ReactorState.STARTING && !timelineHasVoice(TimelineLibrary.STARTUP, "online")) {
                    voice(reactor, ReactorSounds.VOICE_ONLINE);
                }
            }
            case WARNING -> {
                visuals.setTexture(reactor, CoreTexture.WARNING);
                reactor.setMusic(MusicState.ALARM, Quantize.BAR);
                if (from == ReactorState.RUNNING) {
                    voice(reactor, ReactorSounds.VOICE_WARNING);
                }
            }
            case CRITICAL -> {
                visuals.setTexture(reactor, CoreTexture.CRITICAL);
                reactor.setMusic(MusicState.ALARM, Quantize.BAR);
                voice(reactor, ReactorSounds.VOICE_CRITICAL);
            }
            case FAILED -> fail(reactor);
            case SHUTTING_DOWN -> shutdown(reactor);
            case OFF -> {
                if (from == ReactorState.FAILED) {
                    timelinePlayer.cancel(reactor.id());
                }
                visuals.setTexture(reactor, CoreTexture.OFF);
                visuals.setLight(reactor, 0);
                ambient.clearTimelineLoops(reactor);
                reactor.setMusic(MusicState.NONE, Quantize.BAR);
                if (reactor.rotor().targetSpeed() > 0) {
                    reactor.rotor().apply(RotorAnimation.SPIN_DOWN, 2.0, now);
                }
            }
        }
    }

    private void shutdown(Reactor reactor) {
        boolean scram = reactor.shutdownMode() == Reactor.ShutdownMode.SCRAM;
        String id = scram ? TimelineLibrary.SCRAM : TimelineLibrary.SHUTDOWN;
        Optional<Timeline> timeline = timelines.get().get(id);
        reactor.voice().clear();
        if (timeline.map(t -> !t.hasCue(Cue.Music.class)).orElse(true)) {
            reactor.setMusic(MusicState.NONE, scram ? Quantize.BEAT : Quantize.BAR);
        }
        if (timeline.isPresent()) {
            timelinePlayer.play(reactor.id(), timeline.get(), now, () -> {
                if (reactor.state() == ReactorState.SHUTTING_DOWN) {
                    transition(reactor, ReactorState.OFF);
                }
            });
        } else {
            reactor.rotor().apply(RotorAnimation.SPIN_DOWN, scram ? 1.0 : 3.0, now);
            transition(reactor, ReactorState.OFF);
        }
    }

    private void fail(Reactor reactor) {
        timelinePlayer.cancel(reactor.id());
        ambient.clearTimelineLoops(reactor);
        reactor.voice().clear();
        visuals.setTexture(reactor, CoreTexture.CRITICAL);
        visuals.setLight(reactor, 0);
        reactor.rotor().apply(RotorAnimation.STOP, 0, now);
        reactor.rotor().apply(RotorAnimation.SHAKE, 2.0, now);
        reactor.setMusic(MusicState.NONE, Quantize.BAR);
        Location center = reactor.center();
        if (center != null && reactor.isLoaded()) {
            World world = center.getWorld();
            // Visual and audible only: power 0, no fire, never breaks blocks.
            world.createExplosion(center, 0f, false, false);
            world.spawnParticle(Particle.EXPLOSION_EMITTER, center, 1);
            world.spawnParticle(Particle.LARGE_SMOKE, center, 60, 0.6, 1.2, 0.6, 0.03);
            world.spawnParticle(Particle.FLAME, center, 40, 0.5, 0.8, 0.5, 0.05);
            SoundPlayer.playAt(center, ReactorSounds.POWER_DOWN, SoundCategory.BLOCKS, 2.0f, 0.8f);
        }
        logger.warning("Reactor #" + reactor.id() + " FAILED (heat " + Math.round(reactor.heat()) + "%)");
    }

    private boolean timelineHasVoice(String timelineId, String line) {
        return timelines.get().get(timelineId)
                .map(t -> t.cues().stream().anyMatch(c -> c instanceof Cue.Voice v && v.line().equals(line)))
                .orElse(false);
    }

    void voice(Reactor reactor, String sound) {
        reactor.voice().offer(sound, now, timelines.get().voiceTicks(sound)).ifPresent(s -> playVoice(reactor, s));
    }

    private void playVoice(Reactor reactor, String sound) {
        Location center = reactor.center();
        if (center != null) {
            SoundPlayer.playToNearby(center, config.get().voiceRadius(), sound, SoundCategory.VOICE, 1.0f);
        }
    }

    // ------------------------------------------------------------------ ticking

    /** Global per tick update; reactors in unloaded chunks are skipped. */
    public void tick(long tick) {
        this.now = tick;
        timelinePlayer.tick(now);
        boolean relinkAll = now % RELINK_INTERVAL_TICKS == 0;
        for (Reactor reactor : new ArrayList<>(reactors.values())) {
            if (!reactors.containsKey(reactor.id()) || !reactor.isLoaded()) {
                continue;
            }
            if (relinkAll || pendingRelink.remove(reactor.id())) {
                visuals.ensureSpawned(reactor);
            }
            if (now % 20 == 0) {
                simulateHeat(reactor);
            }
            if (now % ReactorVisuals.ROTOR_STEP_TICKS == 0) {
                visuals.stepRotor(reactor, now);
            }
            visuals.setLamp(reactor, lampLit(reactor.state(), now));
            ambient.tick(reactor, now);
            reactor.voice().poll(now).ifPresent(s -> playVoice(reactor, s));
        }
        if (now % BOSSBAR_INTERVAL_TICKS == 0) {
            bossBars.update(reactors.values(), now);
        }
    }

    private void simulateHeat(Reactor reactor) {
        HeatSimulation sim = new HeatSimulation(config.get().heat());
        reactor.setHeat(sim.step(reactor.heat(), reactor.power(), reactor.coolant(),
                reactor.state().isGenerating(), 1.0));
        evaluateHeat(reactor);
    }

    private void evaluateHeat(Reactor reactor) {
        HeatSimulation sim = new HeatSimulation(config.get().heat());
        ReactorState next = sim.evaluate(reactor.state(), reactor.heat());
        if (next != reactor.state()) {
            transition(reactor, next);
        }
    }

    static boolean lampLit(ReactorState state, long now) {
        return switch (state) {
            case STARTING, RUNNING -> true;
            case WARNING -> (now / 10) % 2 == 0;
            case CRITICAL -> (now / 4) % 2 == 0;
            case SHUTTING_DOWN -> (now / 20) % 2 == 0;
            case OFF, FAILED -> false;
        };
    }

    // ------------------------------------------------------------------ entities & persistence

    /**
     * Re-links reactor entities after their chunk loaded: adopts entities with a known reactor id,
     * removes orphans and duplicates, and schedules missing entities to be respawned next tick.
     */
    public void onEntitiesLoaded(World world, int chunkX, int chunkZ, List<Entity> entities) {
        Set<UUID> present = new HashSet<>();
        entities.forEach(e -> present.add(e.getUniqueId()));
        for (Entity entity : entities) {
            String id = ReactorVisuals.reactorId(entity);
            if (id == null) {
                continue;
            }
            Reactor reactor = reactors.get(id);
            EntityRole role = ReactorVisuals.role(entity);
            if (reactor == null || role == null) {
                entity.remove();
                continue;
            }
            UUID known = reactor.entity(role);
            if (known == null || known.equals(entity.getUniqueId())) {
                reactor.setEntity(role, entity.getUniqueId());
            } else if (present.contains(known) || isAlive(known)) {
                entity.remove();
            } else {
                reactor.setEntity(role, entity.getUniqueId());
            }
        }
        for (Reactor reactor : reactors.values()) {
            if (reactor.isInChunk(world.getName(), chunkX, chunkZ)) {
                pendingRelink.add(reactor.id());
            }
        }
    }

    private static boolean isAlive(UUID uuid) {
        Entity entity = Bukkit.getEntity(uuid);
        return entity != null && entity.isValid();
    }

    public ReactorStorage.Snapshot snapshot() {
        List<ReactorRecord> records = new ArrayList<>();
        for (Reactor r : reactors.values()) {
            records.add(new ReactorRecord(r.id(), r.worldName(), r.x(), r.y(), r.z(), r.state(), r.heat(),
                    r.power(), r.coolant(), r.texture(), r.lightLevel(), r.entities()));
        }
        return new ReactorStorage.Snapshot(nextId, records);
    }

    /** Restores reactors from disk. Transitional states fall back to OFF. */
    public void restore(ReactorStorage.Snapshot snapshot) {
        ReactorConfig cfg = config.get();
        nextId = Math.max(nextId, snapshot.nextId());
        for (ReactorRecord record : snapshot.reactors()) {
            Reactor reactor = new Reactor(record.id(), record.world(), record.x(), record.y(), record.z(),
                    cfg.rotorSpeed(), cfg.voiceMinGapTicks());
            ReactorState state = switch (record.state()) {
                case STARTING, SHUTTING_DOWN -> ReactorState.OFF;
                default -> record.state();
            };
            reactor.setState(state);
            reactor.setHeat(HeatSimulation.clampHeat(record.heat()));
            reactor.setPower(ReactorConfig.normalizePower(record.power()));
            reactor.setCoolant(record.coolant());
            reactor.setTexture(state == record.state() ? record.texture() : CoreTexture.forState(state));
            reactor.setLightLevel(state.isGenerating() ? record.lightLevel() : 0);
            record.entities().forEach(reactor::setEntity);
            if (state.isGenerating()) {
                reactor.rotor().apply(RotorAnimation.IDLE_SPIN, 0, now);
                reactor.setMusic(state.isAlarm() ? MusicState.ALARM : MusicState.CALM, Quantize.BAR);
            }
            reactors.put(reactor.id(), reactor);
            pendingRelink.add(reactor.id());
            nextId = Math.max(nextId, parseId(record.id()) + 1);
        }
    }

    private static int parseId(String id) {
        try {
            return Integer.parseInt(id);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** Stops timelines and loops (plugin disable). Entities stay in the world for the next start. */
    public void shutdownAll() {
        timelinePlayer.cancelAll();
        for (Reactor reactor : reactors.values()) {
            ambient.forget(reactor);
        }
        bossBars.removeAll();
    }
}
