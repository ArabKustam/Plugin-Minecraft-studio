package dev.minecraftstudio.reactor.music;

import dev.minecraftstudio.reactor.util.SoundKeys;

import java.util.Locale;
import java.util.Optional;

/** Adaptive music moods. Higher {@link #priority()} wins when several reactors are in range. */
public enum MusicState {
    NONE(0),
    CALM(1),
    ALARM(2);

    private final int priority;

    MusicState(int priority) {
        this.priority = priority;
    }

    public int priority() {
        return priority;
    }

    public String id() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** Contract prefix of music sound events: {@code reactor:reactor.music.<state>_<part>}. */
    public static final String DEFAULT_SOUND_PREFIX = SoundKeys.reactor("reactor.music.");

    /** Sound event of a part ({@code intro}, {@code loop}, {@code outro}) of this mood. */
    public String sound(String prefix, String part) {
        return prefix + id() + "_" + part;
    }

    public String introSound() {
        return sound(DEFAULT_SOUND_PREFIX, "intro");
    }

    public String loopSound() {
        return sound(DEFAULT_SOUND_PREFIX, "loop");
    }

    public static Optional<MusicState> parse(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(valueOf(raw.trim().toUpperCase(Locale.ROOT)));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
