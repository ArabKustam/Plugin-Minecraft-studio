package dev.minecraftstudio.reactor.music;

/**
 * Per player music playback state (pure bookkeeping, no server access). Times are anchored at
 * {@link #anchorTick()}, the tick the intro (bar 0) of the current track started.
 */
public final class MusicSession {

    private MusicMetadata track;
    private MusicState playing = MusicState.NONE;
    private long anchorTick;
    private long loopsStarted;
    private long nextTriggerTick;
    private boolean inIntro;

    private MusicState outro;
    private MusicState pending;
    private long switchTick;

    public MusicState playing() {
        return playing;
    }

    public MusicMetadata track() {
        return track;
    }

    public long anchorTick() {
        return anchorTick;
    }

    public boolean inIntro() {
        return inIntro;
    }

    /** Mood whose outro may still be ringing (null when none). */
    public MusicState outro() {
        return outro;
    }

    /** Records that the outro of {@code state} was started after its loop stopped. */
    public void outroStarted(MusicState state) {
        outro = state;
    }

    public MusicState pending() {
        return pending;
    }

    public long switchTick() {
        return switchTick;
    }

    /**
     * Requests a mood. Returns without changes when it is already playing or pending. Otherwise the
     * switch is scheduled on the next grid point of the current track ({@code now} when silent).
     */
    public void request(MusicState desired, Quantize quantize, long now) {
        MusicState goal = pending != null ? pending : playing();
        if (desired == goal) {
            return;
        }
        if (desired == playing()) {
            pending = null;
            return;
        }
        if (pending == null) {
            switchTick = track == null ? now
                    : BarClock.nextBoundaryTick(anchorTick, now, unitSeconds(track, quantize));
            if (quantize == Quantize.NONE) {
                switchTick = now;
            }
        }
        pending = desired;
    }

    private static double unitSeconds(MusicMetadata track, Quantize quantize) {
        return quantize == Quantize.BEAT ? track.beatSeconds() : track.transitionUnitSeconds();
    }

    /** True when a pending switch is due. */
    public boolean switchDue(long now) {
        return pending != null && now >= switchTick;
    }

    /**
     * Starts {@code next} for mood {@code state} (silence when {@code next} is null) at {@code now}.
     *
     * @return true when an intro has to be played right away (false: the loop starts via {@link #loopDue})
     */
    public boolean start(MusicState state, MusicMetadata next, long now) {
        pending = null;
        outro = null;
        track = next;
        playing = next == null ? MusicState.NONE : state;
        anchorTick = now;
        loopsStarted = 0;
        if (next == null) {
            inIntro = false;
            return false;
        }
        inIntro = next.introSeconds() > 0;
        nextTriggerTick = BarClock.loopTriggerTick(anchorTick, next.introSeconds(), next.loopSeconds(), 0);
        return inIntro;
    }

    /** True when the loop has to be (re-)triggered now. */
    public boolean loopDue(long now) {
        return track != null && now >= nextTriggerTick;
    }

    /** Marks a loop iteration as started and schedules the next one without drift. */
    public void loopStarted() {
        inIntro = false;
        loopsStarted++;
        nextTriggerTick = BarClock.loopTriggerTick(anchorTick, track.introSeconds(), track.loopSeconds(),
                loopsStarted);
    }

    public long nextTriggerTick() {
        return nextTriggerTick;
    }
}
