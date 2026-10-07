package dev.minecraftstudio.reactor.reactor;

import dev.minecraftstudio.reactor.timeline.Cue;
import dev.minecraftstudio.reactor.timeline.CueHandler;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Registry;
import org.bukkit.SoundCategory;
import org.bukkit.World;

import java.util.logging.Logger;

/** Executes timeline cues against a reactor in the world. */
final class ReactorCueHandler implements CueHandler {

    private static final int UI_OVERRIDE_TICKS = 60;

    private final ReactorManager manager;
    private final ReactorVisuals visuals;
    private final AmbientLoops ambient;
    private final Logger logger;

    ReactorCueHandler(ReactorManager manager, ReactorVisuals visuals, AmbientLoops ambient, Logger logger) {
        this.manager = manager;
        this.visuals = visuals;
        this.ambient = ambient;
        this.logger = logger;
    }

    @Override
    public void handle(String ownerId, Cue cue) {
        Reactor reactor = manager.get(ownerId).orElse(null);
        if (reactor == null) {
            return;
        }
        long now = manager.currentTick();
        boolean loaded = reactor.isLoaded();
        switch (cue) {
            case Cue.Event event -> logger.fine(() -> "Reactor #" + ownerId + " timeline event " + event.id());
            case Cue.Sfx sfx -> sfx(reactor, sfx, loaded);
            case Cue.Animation animation -> {
                if ("rotor".equalsIgnoreCase(animation.target())) {
                    reactor.rotor().apply(animation.animation(), animation.durationSeconds(), now);
                } else {
                    logger.fine(() -> "Ignoring animation for unknown target " + animation.target());
                }
            }
            case Cue.Texture texture -> visuals.setTexture(reactor, texture.texture());
            case Cue.Particles particles -> {
                if (loaded) {
                    particles(reactor, particles);
                }
            }
            case Cue.Music music -> reactor.setMusic(music.state(), music.quantize());
            case Cue.Voice voice -> {
                if (loaded) {
                    manager.voice(reactor, voice.sound());
                }
            }
            case Cue.Ui ui -> reactor.setUiOverride(
                    new Reactor.UiOverride(ui.title(), ui.progress(), ui.color(), now + UI_OVERRIDE_TICKS));
            case Cue.Lighting lighting -> visuals.setLight(reactor, lighting.level());
            case Cue.State state -> manager.applyTimelineState(reactor, state.state());
        }
    }

    private void sfx(Reactor reactor, Cue.Sfx sfx, boolean loaded) {
        if (sfx.stop()) {
            ambient.stop(reactor, sfx.sound());
        } else if (sfx.loop()) {
            ambient.startTimelineLoop(reactor,
                    new AmbientLoops.LoopSpec(sfx.sound(), sfx.loopTicks(), sfx.volume(), sfx.pitch()));
        } else if (loaded) {
            SoundPlayer.playAt(reactor.center(), sfx.sound(), SoundCategory.BLOCKS, sfx.volume(), sfx.pitch());
        }
    }

    private void particles(Reactor reactor, Cue.Particles cue) {
        NamespacedKey key = NamespacedKey.fromString(cue.particle());
        Particle particle = key == null ? null : Registry.PARTICLE_TYPE.get(key);
        if (particle == null || particle.getDataType() != Void.class) {
            logger.fine(() -> "Unsupported particle " + cue.particle());
            return;
        }
        Location at = reactor.center().add(0, 1.0, 0);
        World world = at.getWorld();
        world.spawnParticle(particle, at, cue.count(), cue.spreadX(), cue.spreadY(), cue.spreadZ(), 0.02);
    }
}
