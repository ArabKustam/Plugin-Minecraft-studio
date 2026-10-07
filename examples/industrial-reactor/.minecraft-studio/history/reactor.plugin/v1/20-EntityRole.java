package dev.minecraftstudio.reactor.reactor;

import java.util.Locale;
import java.util.Optional;

/** The entities that make up a reactor. Stored in each entity's PDC as {@code reactor:role}. */
public enum EntityRole {
    CORE,
    ROTOR,
    LAMP,
    INTERACTION;

    public String id() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static Optional<EntityRole> parse(String raw) {
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
