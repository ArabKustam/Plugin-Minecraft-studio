package dev.minecraftstudio.reactor.state;

import java.util.Locale;
import java.util.Optional;

/** Visual variants of the reactor core display ({@code reactor:core_<name>} item models). */
public enum CoreTexture {
    OFF,
    ACTIVE,
    WARNING,
    CRITICAL;

    public String modelId() {
        return "core_" + name().toLowerCase(Locale.ROOT);
    }

    public static Optional<CoreTexture> parse(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(valueOf(raw.trim().toUpperCase(Locale.ROOT)));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    /** Default core look for a lifecycle state. */
    public static CoreTexture forState(ReactorState state) {
        return switch (state) {
            case OFF, STARTING, SHUTTING_DOWN -> OFF;
            case RUNNING -> ACTIVE;
            case WARNING -> WARNING;
            case CRITICAL, FAILED -> CRITICAL;
        };
    }
}
