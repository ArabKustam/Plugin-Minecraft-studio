package dev.minecraftstudio.reactor.state;

import java.util.Locale;
import java.util.Optional;

/**
 * Lifecycle states of a reactor. Allowed transitions are defined in {@link StateTransitions}.
 */
public enum ReactorState {
    OFF,
    STARTING,
    RUNNING,
    WARNING,
    CRITICAL,
    FAILED,
    SHUTTING_DOWN;

    /** States from which a regular stop or an emergency SCRAM is accepted. */
    public boolean isActive() {
        return this == STARTING || this == RUNNING || this == WARNING || this == CRITICAL;
    }

    /** States in which the core produces power and therefore heat. */
    public boolean isGenerating() {
        return this == RUNNING || this == WARNING || this == CRITICAL;
    }

    /** States considered alarming (alarm music, sirens, blinking lamp). */
    public boolean isAlarm() {
        return this == WARNING || this == CRITICAL;
    }

    public static Optional<ReactorState> parse(String raw) {
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
