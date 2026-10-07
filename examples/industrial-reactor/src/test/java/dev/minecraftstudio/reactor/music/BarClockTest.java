package dev.minecraftstudio.reactor.music;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BarClockTest {

    private final BarClock calm = new BarClock(92, 4);
    private final BarClock alarm = new BarClock(132, 4);

    @Test
    void beatAndBarLengths() {
        assertEquals(0.652174, calm.beatSeconds(), 1e-6);
        assertEquals(2.608696, calm.barSeconds(), 1e-6);
        assertEquals(1.818182, alarm.barSeconds(), 1e-6);
    }

    @Test
    void boundaryAtAnchorIsImmediate() {
        assertEquals(100, calm.nextBarTick(100, 100, 1));
        assertEquals(100, calm.nextBarTick(100, 50, 1));
    }

    @Test
    void nextBarIsRoundedToNearestTick() {
        // bar = 2.608696 s = 52.17 ticks -> 52
        assertEquals(52, calm.nextBarTick(0, 1, 1));
        assertEquals(52, calm.nextBarTick(0, 52, 1));
        // second bar 5.217 s = 104.35 ticks -> 104
        assertEquals(104, calm.nextBarTick(0, 53, 1));
    }

    @Test
    void twoBarTransitionGrid() {
        // 2 bars = 5.217391 s = 104.35 ticks
        assertEquals(104, calm.nextBarTick(0, 10, 2));
        assertEquals(209, calm.nextBarTick(0, 105, 2));
        // alarm: 2 bars = 3.636364 s = 72.7 ticks
        assertEquals(73, alarm.nextBarTick(1000, 1001, 2) - 1000);
    }

    @Test
    void beatGrid() {
        // 132 bpm beat = 0.4545 s = 9.09 ticks
        assertEquals(9, alarm.nextBeatTick(0, 1));
        assertEquals(18, alarm.nextBeatTick(0, 10));
    }

    @Test
    void quantizeNoneIsNow() {
        assertEquals(77, calm.nextTick(0, 77, Quantize.NONE, 2));
        assertEquals(calm.nextBeatTick(0, 77), calm.nextTick(0, 77, Quantize.BEAT, 2));
        assertEquals(calm.nextBarTick(0, 77, 2), calm.nextTick(0, 77, Quantize.BAR, 2));
    }

    @Test
    void boundaryNeverInThePast() {
        for (long now = 0; now < 5000; now++) {
            long next = alarm.nextBarTick(0, now, 1);
            assertTrue(next >= now, "boundary " + next + " before " + now);
            assertTrue(next - now <= 37, "boundary too far at " + now);
        }
    }

    @Test
    void loopRetriggersDoNotDrift() {
        double intro = 5.217391;
        double loop = 20.869565;
        assertEquals(104, BarClock.loopTriggerTick(0, intro, loop, 0));
        assertEquals(522, BarClock.loopTriggerTick(0, intro, loop, 1));
        assertEquals(939, BarClock.loopTriggerTick(0, intro, loop, 2));
        // after 1000 loops the error stays below half a tick
        long tick = BarClock.loopTriggerTick(0, intro, loop, 1000);
        double exact = (intro + 1000 * loop) * 20;
        assertTrue(Math.abs(tick - exact) <= 0.5);
        // naive integer accumulation (417 ticks per loop) would be ~390 ticks off by now
        assertTrue(Math.abs((104 + 1000L * 417) - exact) > 100);
    }

    @Test
    void invalidArguments() {
        assertThrows(IllegalArgumentException.class, () -> new BarClock(0, 4));
        assertThrows(IllegalArgumentException.class, () -> new BarClock(120, 0));
        assertThrows(IllegalArgumentException.class, () -> BarClock.nextBoundaryTick(0, 10, 0));
    }
}
