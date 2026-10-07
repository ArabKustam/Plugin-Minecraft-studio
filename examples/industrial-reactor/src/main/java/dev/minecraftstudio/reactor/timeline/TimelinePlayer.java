package dev.minecraftstudio.reactor.timeline;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Plays timelines tick by tick on the main thread. At most one timeline runs per owner; starting a
 * new one cancels the previous run (e.g. SCRAM during startup).
 */
public final class TimelinePlayer {

    private final CueHandler handler;
    private final Map<String, TimelineRun> runs = new HashMap<>();

    public TimelinePlayer(CueHandler handler) {
        this.handler = handler;
    }

    /**
     * Starts {@code timeline} for {@code ownerId}. Cues at tick 0 fire on the next {@link #tick(long)}.
     *
     * @param onComplete called once when the run finishes normally (never when cancelled)
     */
    public TimelineRun play(String ownerId, Timeline timeline, long nowTick, Runnable onComplete) {
        cancel(ownerId);
        TimelineRun run = new TimelineRun(ownerId, timeline, nowTick, onComplete);
        runs.put(ownerId, run);
        return run;
    }

    /** Cancels the run of {@code ownerId}; pending cues are dropped and completion is not reported. */
    public boolean cancel(String ownerId) {
        TimelineRun run = runs.remove(ownerId);
        if (run != null) {
            run.cancel();
            return true;
        }
        return false;
    }

    public void cancelAll() {
        runs.values().forEach(TimelineRun::cancel);
        runs.clear();
    }

    public Optional<TimelineRun> current(String ownerId) {
        return Optional.ofNullable(runs.get(ownerId));
    }

    public boolean isPlaying(String ownerId) {
        return runs.containsKey(ownerId);
    }

    /** Advances every run. Handlers may start or cancel runs re-entrantly. */
    public void tick(long nowTick) {
        for (TimelineRun run : new ArrayList<>(runs.values())) {
            if (run.isCancelled()) {
                continue;
            }
            boolean finished = run.advance(nowTick, handler);
            if (finished && runs.get(run.ownerId()) == run) {
                runs.remove(run.ownerId());
            }
        }
    }
}
