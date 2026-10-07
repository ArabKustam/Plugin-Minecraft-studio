package dev.minecraftstudio.reactor.reactor;

import java.util.Locale;
import java.util.Optional;

/** Rotor animations addressable from timelines ({@code track: animation}). */
public enum RotorAnimation {
    SPIN_UP,
    SPIN_DOWN,
    IDLE_SPIN,
    SHAKE,
    STOP;

    public static Optional<RotorAnimation> parse(String raw) {
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
