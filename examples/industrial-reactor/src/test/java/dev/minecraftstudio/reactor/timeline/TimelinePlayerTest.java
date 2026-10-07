package dev.minecraftstudio.reactor.timeline;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TimelinePlayerTest {

    private record Fired(long tick, String owner, Cue cue) {
    }

    private final List<Fired> fired = new ArrayList<>();
    private long now;
    private final TimelinePlayer player = new TimelinePlayer((owner, cue) -> fired.add(new Fired(now, owner, cue)));

    private static Timeline timeline(int duration, Cue... cues) {
        return new Timeline("t", "t", "", duration, List.of(cues), List.of());
    }

    private void runUntil(long end) {
        for (; now <= end; now++) {
            player.tick(now);
        }
    }

    @Test
    void cuesFireAtTheirTickRelativeToStart() {
        now = 100;
        AtomicInteger completed = new AtomicInteger();
        player.play("r1", timeline(20,
                new Cue.Event(0, "a"), new Cue.Event(5, "b"), new Cue.Event(20, "c")), now, completed::incrementAndGet);
        runUntil(130);
        assertEquals(List.of(100L, 105L, 120L), fired.stream().map(Fired::tick).toList());
        assertEquals(1, completed.get());
        assertFalse(player.isPlaying("r1"));
    }

    @Test
    void completionWaitsForDuration() {
        now = 0;
        AtomicInteger completed = new AtomicInteger();
        player.play("r1", timeline(50, new Cue.Event(0, "a")), now, completed::incrementAndGet);
        runUntil(49);
        assertEquals(0, completed.get());
        runUntil(50);
        assertEquals(1, completed.get());
    }

    @Test
    void particlesRepeatEveryFiveTicksDuringDuration() {
        now = 0;
        player.play("r1", timeline(0, new Cue.Particles(10, "minecraft:cloud", 3, 0, 0, 0, 1.0)), now, () -> { });
        runUntil(60);
        // tick 10 + every 5 ticks until 30 (10 + 20)
        assertEquals(List.of(10L, 15L, 20L, 25L, 30L), fired.stream().map(Fired::tick).toList());
    }

    @Test
    void cancellationStopsCuesAndSkipsCompletion() {
        now = 0;
        AtomicInteger completed = new AtomicInteger();
        player.play("r1", timeline(40, new Cue.Event(0, "a"), new Cue.Event(30, "late"),
                new Cue.Particles(1, "minecraft:cloud", 1, 0, 0, 0, 5.0)), now, completed::incrementAndGet);
        runUntil(10);
        int before = fired.size();
        assertTrue(player.cancel("r1"));
        runUntil(200);
        assertEquals(before, fired.size());
        assertEquals(0, completed.get());
        assertFalse(player.cancel("r1"));
    }

    @Test
    void newTimelineReplacesRunningOne() {
        now = 0;
        AtomicInteger firstCompleted = new AtomicInteger();
        player.play("r1", timeline(100, new Cue.Event(50, "startup-late")), now, firstCompleted::incrementAndGet);
        runUntil(10);
        player.play("r1", timeline(5, new Cue.Event(0, "scram")), now, () -> { });
        runUntil(200);
        assertEquals(1, fired.size());
        assertEquals("scram", ((Cue.Event) fired.get(0).cue()).id());
        assertEquals(0, firstCompleted.get());
    }

    @Test
    void handlerMayCancelItsOwnRunReentrantly() {
        List<String> seen = new ArrayList<>();
        TimelinePlayer[] holder = new TimelinePlayer[1];
        holder[0] = new TimelinePlayer((owner, cue) -> {
            seen.add(((Cue.Event) cue).id());
            if (((Cue.Event) cue).id().equals("fail")) {
                holder[0].cancel(owner);
            }
        });
        holder[0].play("r1", timeline(10, new Cue.Event(0, "fail"), new Cue.Event(0, "after")), 0, () -> { });
        holder[0].tick(0);
        holder[0].tick(1);
        assertEquals(List.of("fail"), seen);
    }

    @Test
    void ownersAreIndependent() {
        now = 0;
        player.play("a", timeline(0, new Cue.Event(0, "a")), now, () -> { });
        player.play("b", timeline(0, new Cue.Event(3, "b")), now, () -> { });
        player.cancel("a");
        runUntil(10);
        assertEquals(List.of("b"), fired.stream().map(Fired::owner).toList());
    }
}
