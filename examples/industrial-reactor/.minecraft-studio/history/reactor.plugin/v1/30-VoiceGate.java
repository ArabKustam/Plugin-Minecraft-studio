package dev.minecraftstudio.reactor.reactor;

import java.util.Optional;

/**
 * Rate limiter for voice lines so announcements never overlap. A line keeps the channel busy for
 * its spoken length (when known) but at least the configured minimum gap. A line arriving while the
 * channel is busy is kept as pending (newer lines replace older pending ones) and released once the
 * channel is free.
 */
public final class VoiceGate {

    private final long minGapTicks;
    private long nextFreeTick = Long.MIN_VALUE;
    private String pending;
    private long pendingBusyTicks;

    public VoiceGate(long minGapTicks) {
        this.minGapTicks = Math.max(0, minGapTicks);
    }

    /**
     * @param busyTicks spoken length of the line in ticks (0 when unknown)
     * @return the sound to play right now, or empty when it was queued
     */
    public Optional<String> offer(String sound, long now, long busyTicks) {
        if (now >= nextFreeTick) {
            occupy(now, busyTicks);
            pending = null;
            return Optional.of(sound);
        }
        pending = sound;
        pendingBusyTicks = busyTicks;
        return Optional.empty();
    }

    /** Releases the pending line when the channel became free. */
    public Optional<String> poll(long now) {
        if (pending == null || now < nextFreeTick) {
            return Optional.empty();
        }
        String sound = pending;
        pending = null;
        occupy(now, pendingBusyTicks);
        return Optional.of(sound);
    }

    private void occupy(long now, long busyTicks) {
        nextFreeTick = now + Math.max(minGapTicks, busyTicks);
    }

    public void clear() {
        pending = null;
    }
}
