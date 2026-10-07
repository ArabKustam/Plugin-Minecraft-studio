package dev.minecraftstudio.reactor.sim;

import dev.minecraftstudio.reactor.state.ReactorState;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HeatSimulationTest {

    private final HeatSimulation sim = new HeatSimulation(HeatSimulation.Params.defaults());

    @Test
    void fullPowerWithoutCoolantHeatsUp() {
        // 2.0 * 1.0 - 0.3 passive
        assertEquals(1.7, sim.ratePerSecond(100, false, true), 1e-9);
        assertEquals(11.7, sim.step(10, 100, false, true, 1.0), 1e-9);
    }

    @Test
    void coolantKeepsModeratePowerStable() {
        // 75%: 1.5 gain - 0.3 passive - 1.5 coolant = -0.3 per second
        assertEquals(-0.3, sim.ratePerSecond(75, true, true), 1e-9);
        // 100% with coolant still creeps up slowly
        assertEquals(0.2, sim.ratePerSecond(100, true, true), 1e-9);
    }

    @Test
    void notGeneratingOnlyCools() {
        assertEquals(-1.8, sim.ratePerSecond(100, true, false), 1e-9);
        assertEquals(0.0, sim.step(1.0, 100, true, false, 1.0), 1e-9);
    }

    @Test
    void heatIsClamped() {
        assertEquals(100.0, sim.step(99.5, 100, false, true, 10), 1e-9);
        assertEquals(0.0, sim.step(0.5, 25, true, false, 10), 1e-9);
        assertEquals(0.0, HeatSimulation.clampHeat(Double.NaN), 1e-9);
    }

    @Test
    void thresholdsEscalate() {
        assertEquals(ReactorState.RUNNING, sim.evaluate(ReactorState.RUNNING, 69.9));
        assertEquals(ReactorState.WARNING, sim.evaluate(ReactorState.RUNNING, 70));
        assertEquals(ReactorState.CRITICAL, sim.evaluate(ReactorState.WARNING, 90));
        assertEquals(ReactorState.CRITICAL, sim.evaluate(ReactorState.RUNNING, 95));
        assertEquals(ReactorState.FAILED, sim.evaluate(ReactorState.CRITICAL, 100));
        assertEquals(ReactorState.FAILED, sim.evaluate(ReactorState.RUNNING, 100));
    }

    @Test
    void hysteresisPreventsFlapping() {
        // WARNING stays until heat drops below 65
        assertEquals(ReactorState.WARNING, sim.evaluate(ReactorState.WARNING, 66));
        assertEquals(ReactorState.WARNING, sim.evaluate(ReactorState.WARNING, 65));
        assertEquals(ReactorState.RUNNING, sim.evaluate(ReactorState.WARNING, 64.9));
        // CRITICAL stays until heat drops below 85 (90 - 5)
        assertEquals(ReactorState.CRITICAL, sim.evaluate(ReactorState.CRITICAL, 86));
        assertEquals(ReactorState.WARNING, sim.evaluate(ReactorState.CRITICAL, 84));
        assertEquals(ReactorState.RUNNING, sim.evaluate(ReactorState.CRITICAL, 60));
    }

    @Test
    void nonGeneratingStatesAreNotEvaluated() {
        assertEquals(ReactorState.OFF, sim.evaluate(ReactorState.OFF, 100));
        assertEquals(ReactorState.STARTING, sim.evaluate(ReactorState.STARTING, 95));
        assertEquals(ReactorState.SHUTTING_DOWN, sim.evaluate(ReactorState.SHUTTING_DOWN, 95));
    }

    @Test
    void simulatedRunawayReachesEveryStage() {
        double heat = 0;
        ReactorState state = ReactorState.RUNNING;
        boolean sawWarning = false;
        boolean sawCritical = false;
        for (int second = 0; second < 200 && state != ReactorState.FAILED; second++) {
            heat = sim.step(heat, 100, false, state.isGenerating(), 1.0);
            state = sim.evaluate(state, heat);
            sawWarning |= state == ReactorState.WARNING;
            sawCritical |= state == ReactorState.CRITICAL;
        }
        assertTrue(sawWarning);
        assertTrue(sawCritical);
        assertEquals(ReactorState.FAILED, state);
    }

    @Test
    void invalidThresholdsAreRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> new HeatSimulation.Params(1, 1, 1, 90, 70, 100, 65, 5));
        assertThrows(IllegalArgumentException.class,
                () -> new HeatSimulation.Params(-1, 1, 1, 70, 90, 100, 65, 5));
    }
}
