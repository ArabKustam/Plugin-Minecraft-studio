package dev.minecraftstudio.reactor.timeline;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/** Mutable progress of one timeline playing for one owner. Main thread only. */
public final class TimelineRun {

    /** Particle cues are re-emitted every this many ticks during their duration. */
    public static final int PARTICLE_INTERVAL_TICKS = 5;

    private final String ownerId;
    private final Timeline timeline;
    private final long startTick;
    private final Runnable onComplete;
    private final List<Emitter> emitters = new ArrayList<>();
    private int nextCue;
    private boolean cancelled;

    TimelineRun(String ownerId, Timeline timeline, long startTick, Runnable onComplete) {
        this.ownerId = ownerId;
        this.timeline = timeline;
        this.startTick = startTick;
        this.onComplete = onComplete;
    }

    public String ownerId() {
        return ownerId;
    }

    public Timeline timeline() {
        return timeline;
    }

    public long startTick() {
        return startTick;
    }

    public boolean isCancelled() {
        return cancelled;
    }

    void cancel() {
        cancelled = true;
        emitters.clear();
    }

    /**
     * Executes everything due at {@code now}.
     *
     * @return true when the run has finished (all cues fired, emitters done, duration elapsed)
     */
    boolean advance(long now, CueHandler handler) {
        long elapsed = now - startTick;
        List<Cue> cues = timeline.cues();
        while (!cancelled && nextCue < cues.size() && cues.get(nextCue).tick() <= elapsed) {
            Cue cue = cues.get(nextCue++);
            handler.handle(ownerId, cue);
            if (cue instanceof Cue.Particles p && p.durationSeconds() > 0) {
                long until = startTick + p.tick() + Math.round(p.durationSeconds() * 20);
                emitters.add(new Emitter(p, startTick + p.tick() + PARTICLE_INTERVAL_TICKS, until));
            }
        }
        Iterator<Emitter> it = emitters.iterator();
        while (!cancelled && it.hasNext()) {
            Emitter e = it.next();
            if (e.nextTick > e.untilTick) {
                it.remove();
            } else if (now >= e.nextTick) {
                handler.handle(ownerId, e.cue);
                e.nextTick += PARTICLE_INTERVAL_TICKS;
            }
        }
        if (cancelled) {
            return true;
        }
        boolean done = nextCue >= cues.size() && emitters.isEmpty() && elapsed >= timeline.durationTicks();
        if (done) {
            onComplete.run();
        }
        return done;
    }

    private static final class Emitter {
        private final Cue.Particles cue;
        private final long untilTick;
        private long nextTick;

        private Emitter(Cue.Particles cue, long nextTick, long untilTick) {
            this.cue = cue;
            this.nextTick = nextTick;
            this.untilTick = untilTick;
        }
    }
}
