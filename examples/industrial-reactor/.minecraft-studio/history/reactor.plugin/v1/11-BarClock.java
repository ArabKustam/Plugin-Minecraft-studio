package dev.minecraftstudio.reactor.music;

/**
 * Pure tempo grid math. All times are measured from an anchor tick (the tick at which the first
 * bar of a track started). Fractional times are kept in seconds and rounded to the nearest server
 * tick only when a concrete tick is requested, so long running loops never drift.
 */
public final class BarClock {

    public static final int TICKS_PER_SECOND = 20;
    private static final double EPSILON = 1e-6;

    private final double beatSeconds;
    private final double barSeconds;

    public BarClock(double bpm, int beatsPerBar) {
        if (!(bpm > 0) || beatsPerBar <= 0) {
            throw new IllegalArgumentException("bpm and beatsPerBar must be positive");
        }
        this.beatSeconds = 60.0 / bpm;
        this.barSeconds = beatSeconds * beatsPerBar;
    }

    public double beatSeconds() {
        return beatSeconds;
    }

    public double barSeconds() {
        return barSeconds;
    }

    public static long secondsToTicks(double seconds) {
        return Math.round(seconds * TICKS_PER_SECOND);
    }

    /**
     * First grid point at or after {@code nowTick}, where grid points lie at
     * {@code anchorTick + n * unitSeconds}. Ticks before the anchor return the anchor.
     */
    public static long nextBoundaryTick(long anchorTick, long nowTick, double unitSeconds) {
        if (!(unitSeconds > 0)) {
            throw new IllegalArgumentException("unitSeconds must be positive");
        }
        if (nowTick <= anchorTick) {
            return anchorTick;
        }
        double elapsed = (nowTick - anchorTick) / (double) TICKS_PER_SECOND;
        long n = (long) Math.ceil(elapsed / unitSeconds - EPSILON);
        long tick = anchorTick + secondsToTicks(n * unitSeconds);
        while (tick < nowTick) {
            n++;
            tick = anchorTick + secondsToTicks(n * unitSeconds);
        }
        return tick;
    }

    /** Next bar line (or every {@code everyBars} bars) at or after {@code nowTick}. */
    public long nextBarTick(long anchorTick, long nowTick, int everyBars) {
        return nextBoundaryTick(anchorTick, nowTick, barSeconds * Math.max(1, everyBars));
    }

    /** Next beat at or after {@code nowTick}. */
    public long nextBeatTick(long anchorTick, long nowTick) {
        return nextBoundaryTick(anchorTick, nowTick, beatSeconds);
    }

    /** Quantized switch tick for the given grid. {@link Quantize#NONE} switches immediately. */
    public long nextTick(long anchorTick, long nowTick, Quantize quantize, int everyBars) {
        return switch (quantize) {
            case BAR -> nextBarTick(anchorTick, nowTick, everyBars);
            case BEAT -> nextBeatTick(anchorTick, nowTick);
            case NONE -> nowTick;
        };
    }

    /**
     * Tick at which loop iteration {@code iteration} (0-based) must be triggered when the loop
     * starts {@code loopStartSeconds} after the anchor and lasts {@code loopSeconds}.
     */
    public static long loopTriggerTick(long anchorTick, double loopStartSeconds, double loopSeconds, long iteration) {
        return anchorTick + secondsToTicks(loopStartSeconds + iteration * loopSeconds);
    }
}
