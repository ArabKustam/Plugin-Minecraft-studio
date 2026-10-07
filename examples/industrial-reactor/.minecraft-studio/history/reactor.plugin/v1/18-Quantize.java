package dev.minecraftstudio.reactor.music;

import java.util.Locale;
import java.util.Optional;

/** Musical grid used when switching tracks. */
public enum Quantize {
    BAR,
    BEAT,
    NONE;

    public static Optional<Quantize> parse(String raw) {
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
