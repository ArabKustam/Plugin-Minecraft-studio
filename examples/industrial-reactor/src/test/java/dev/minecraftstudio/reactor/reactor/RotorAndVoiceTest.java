package dev.minecraftstudio.reactor.reactor;

import dev.minecraftstudio.reactor.state.ReactorState;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RotorAndVoiceTest {

    @Test
    void spinUpRampsLinearlyToMaxSpeed() {
        RotorMotion rotor = new RotorMotion(18);
        assertTrue(rotor.isIdle(0));
        rotor.apply(RotorAnimation.SPIN_UP, 2.0, 100);
        assertEquals(0, rotor.speed(100), 1e-9);
        assertEquals(9, rotor.speed(120), 1e-9);
        assertEquals(18, rotor.speed(140), 1e-9);
        assertEquals(18, rotor.speed(10_000), 1e-9);
        assertFalse(rotor.isIdle(140));
    }

    @Test
    void spinDownEndsStopped() {
        RotorMotion rotor = new RotorMotion(18);
        rotor.apply(RotorAnimation.IDLE_SPIN, 0, 0);
        rotor.apply(RotorAnimation.SPIN_DOWN, 1.0, 50);
        assertEquals(9, rotor.speed(60), 1e-9);
        assertEquals(0, rotor.speed(70), 1e-9);
        assertTrue(rotor.isIdle(70));
    }

    @Test
    void stepsStayBelowHalfTurnSoInterpolationIsUnambiguous() {
        RotorMotion rotor = new RotorMotion(18);
        rotor.apply(RotorAnimation.IDLE_SPIN, 0, 0);
        double previous = rotor.angle();
        for (long t = 0; t < 400; t += ReactorVisuals.ROTOR_STEP_TICKS) {
            double angle = rotor.advance(t, ReactorVisuals.ROTOR_STEP_TICKS);
            double delta = ((angle - previous) % 360 + 360) % 360;
            assertEquals(90, delta, 1e-6);
            assertTrue(angle >= 0 && angle < 360);
            previous = angle;
        }
    }

    @Test
    void shakeIsTemporary() {
        RotorMotion rotor = new RotorMotion(10);
        rotor.apply(RotorAnimation.SHAKE, 1.0, 0);
        assertTrue(rotor.isShaking(19));
        assertFalse(rotor.isShaking(20));
        assertFalse(rotor.isIdle(5));
    }

    @Test
    void voiceGateQueuesLatestLine() {
        VoiceGate gate = new VoiceGate(50);
        assertEquals(Optional.of("warning"), gate.offer("warning", 0, 0));
        assertTrue(gate.offer("critical", 10, 0).isEmpty());
        assertTrue(gate.offer("critical2", 20, 0).isEmpty());
        assertTrue(gate.poll(49).isEmpty());
        assertEquals(Optional.of("critical2"), gate.poll(50));
        assertTrue(gate.poll(200).isEmpty());
        assertTrue(gate.offer("x", 60, 0).isEmpty(), "gap restarts after the released line");
        gate.clear();
        assertTrue(gate.poll(500).isEmpty());
    }

    @Test
    void voiceGateHonoursSpokenLength() {
        VoiceGate gate = new VoiceGate(50);
        assertTrue(gate.offer("startup", 0, 145).isPresent());
        assertTrue(gate.offer("online", 100, 60).isEmpty());
        assertTrue(gate.poll(144).isEmpty());
        assertEquals(Optional.of("online"), gate.poll(145));
        assertTrue(gate.offer("warning", 160, 0).isEmpty(), "online keeps the channel for 60 ticks");
        assertEquals(Optional.of("warning"), gate.poll(205));
    }

    @Test
    void stateLoops() {
        assertEquals(List.of(AmbientLoops.ENGINE), AmbientLoops.stateLoops(ReactorState.RUNNING));
        assertEquals(List.of(AmbientLoops.ENGINE, AmbientLoops.ALARM_BEEP), AmbientLoops.stateLoops(ReactorState.WARNING));
        assertEquals(List.of(AmbientLoops.ENGINE, AmbientLoops.SIREN), AmbientLoops.stateLoops(ReactorState.CRITICAL));
        assertTrue(AmbientLoops.stateLoops(ReactorState.OFF).isEmpty());
        assertEquals(80, AmbientLoops.ENGINE.intervalTicks());
        assertEquals(20, AmbientLoops.ALARM_BEEP.intervalTicks());
    }

    @Test
    void lampBlinksOnlyInAlarmStates() {
        assertTrue(ReactorManager.lampLit(ReactorState.RUNNING, 7));
        assertFalse(ReactorManager.lampLit(ReactorState.OFF, 7));
        assertTrue(ReactorManager.lampLit(ReactorState.WARNING, 0));
        assertFalse(ReactorManager.lampLit(ReactorState.WARNING, 10));
        assertTrue(ReactorManager.lampLit(ReactorState.CRITICAL, 0));
        assertFalse(ReactorManager.lampLit(ReactorState.CRITICAL, 4));
    }
}
