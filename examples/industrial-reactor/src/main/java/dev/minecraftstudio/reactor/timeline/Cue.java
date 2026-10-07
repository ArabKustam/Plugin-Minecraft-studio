package dev.minecraftstudio.reactor.timeline;

import dev.minecraftstudio.reactor.music.MusicState;
import dev.minecraftstudio.reactor.music.Quantize;
import dev.minecraftstudio.reactor.reactor.RotorAnimation;
import dev.minecraftstudio.reactor.state.CoreTexture;
import dev.minecraftstudio.reactor.state.ReactorState;

/** A single timeline cue. Each track maps to one record type. */
public sealed interface Cue permits Cue.Event, Cue.Sfx, Cue.Animation, Cue.Texture, Cue.Particles,
        Cue.Music, Cue.Voice, Cue.Ui, Cue.Lighting, Cue.State {

    /** Tick offset from the start of the timeline. */
    int tick();

    /** Free-form marker, only logged. */
    record Event(int tick, String id) implements Cue {
    }

    /**
     * One-shot or looping sound effect.
     *
     * @param loop      start an ambient loop re-triggered every {@code loopTicks}
     * @param loopTicks loop period in ticks
     * @param stop      stop a previously started loop / playing sound instead of playing
     */
    record Sfx(int tick, String sound, float volume, float pitch, boolean loop, int loopTicks, boolean stop)
            implements Cue {
    }

    record Animation(int tick, RotorAnimation animation, String target, double durationSeconds) implements Cue {
    }

    record Texture(int tick, CoreTexture texture) implements Cue {
    }

    record Particles(int tick, String particle, int count, double spreadX, double spreadY, double spreadZ,
                     double durationSeconds) implements Cue {
    }

    /** {@code state} is {@link MusicState#NONE} for {@code action: stop}. */
    record Music(int tick, MusicState state, Quantize quantize) implements Cue {
    }

    /** {@code durationSeconds} is the spoken length (0 when unknown); used to avoid overlapping lines. */
    record Voice(int tick, String line, String sound, double durationSeconds) implements Cue {
    }

    /** {@code color} is a boss bar colour name or {@code null} for the state colour. */
    record Ui(int tick, String title, float progress, String color) implements Cue {
    }

    record Lighting(int tick, int level) implements Cue {
    }

    record State(int tick, ReactorState state) implements Cue {
    }
}
