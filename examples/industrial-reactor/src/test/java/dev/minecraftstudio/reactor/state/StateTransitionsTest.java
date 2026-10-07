package dev.minecraftstudio.reactor.state;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import static dev.minecraftstudio.reactor.state.ReactorState.CRITICAL;
import static dev.minecraftstudio.reactor.state.ReactorState.FAILED;
import static dev.minecraftstudio.reactor.state.ReactorState.OFF;
import static dev.minecraftstudio.reactor.state.ReactorState.RUNNING;
import static dev.minecraftstudio.reactor.state.ReactorState.SHUTTING_DOWN;
import static dev.minecraftstudio.reactor.state.ReactorState.STARTING;
import static dev.minecraftstudio.reactor.state.ReactorState.WARNING;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StateTransitionsTest {

    @Test
    void tableIsConsistent() {
        assertEquals(java.util.List.of(), StateTransitions.validate());
    }

    @Test
    void happyPathLifecycle() {
        assertTrue(StateTransitions.isAllowed(OFF, STARTING));
        assertTrue(StateTransitions.isAllowed(STARTING, RUNNING));
        assertTrue(StateTransitions.isAllowed(RUNNING, WARNING));
        assertTrue(StateTransitions.isAllowed(WARNING, CRITICAL));
        assertTrue(StateTransitions.isAllowed(CRITICAL, FAILED));
        assertTrue(StateTransitions.isAllowed(SHUTTING_DOWN, OFF));
    }

    @Test
    void hysteresisFallbacksAreAllowed() {
        assertTrue(StateTransitions.isAllowed(WARNING, RUNNING));
        assertTrue(StateTransitions.isAllowed(CRITICAL, WARNING));
        assertTrue(StateTransitions.isAllowed(CRITICAL, RUNNING));
    }

    @ParameterizedTest
    @EnumSource(value = ReactorState.class, names = {"STARTING", "RUNNING", "WARNING", "CRITICAL"})
    void everyActiveStateCanShutDownOrScram(ReactorState state) {
        assertTrue(state.isActive());
        assertTrue(StateTransitions.isAllowed(state, SHUTTING_DOWN));
    }

    @Test
    void illegalTransitionsAreRejected() {
        assertFalse(StateTransitions.isAllowed(OFF, RUNNING));
        assertFalse(StateTransitions.isAllowed(OFF, SHUTTING_DOWN));
        assertFalse(StateTransitions.isAllowed(STARTING, WARNING));
        assertFalse(StateTransitions.isAllowed(FAILED, STARTING));
        assertFalse(StateTransitions.isAllowed(FAILED, SHUTTING_DOWN));
        assertFalse(StateTransitions.isAllowed(SHUTTING_DOWN, RUNNING));
        assertFalse(StateTransitions.isAllowed(OFF, null));
        assertFalse(StateTransitions.isAllowed(null, OFF));
    }

    @ParameterizedTest
    @EnumSource(ReactorState.class)
    void noSelfTransitions(ReactorState state) {
        assertFalse(StateTransitions.isAllowed(state, state));
    }

    @Test
    void failedCanOnlyBeReset() {
        assertEquals(java.util.Set.of(OFF), StateTransitions.targets(FAILED));
    }

    @Test
    void parseIsCaseInsensitive() {
        assertEquals(RUNNING, ReactorState.parse(" running ").orElseThrow());
        assertTrue(ReactorState.parse("melting").isEmpty());
        assertTrue(ReactorState.parse(null).isEmpty());
    }

    @Test
    void stateFlags() {
        assertTrue(RUNNING.isGenerating());
        assertFalse(STARTING.isGenerating());
        assertTrue(WARNING.isAlarm());
        assertFalse(FAILED.isActive());
        assertEquals(CoreTexture.CRITICAL, CoreTexture.forState(FAILED));
        assertEquals("core_active", CoreTexture.ACTIVE.modelId());
    }
}
