package dev.minecraftstudio.reactor.sim;

import dev.minecraftstudio.reactor.state.ReactorState;

/**
 * Pure heat model of the reactor core. Heat is expressed in percent (0..100).
 *
 * <p>Per simulated second: {@code heat += gainAtFullPower * power/100 - passiveCooling - (coolant ? coolantCooling : 0)}.
 * Threshold evaluation uses hysteresis so the reactor does not flap between states.</p>
 */
public final class HeatSimulation {

    public static final double MIN_HEAT = 0.0;
    public static final double MAX_HEAT = 100.0;

    /**
     * Tunables of the heat model.
     *
     * @param gainAtFullPower    heat gained per second at 100% power
     * @param coolantCooling     heat removed per second while coolant pumps are on
     * @param passiveCooling     heat always dissipated per second
     * @param warning            entering WARNING at or above this heat
     * @param critical           entering CRITICAL at or above this heat
     * @param failure            FAILED at or above this heat
     * @param resume             back to RUNNING strictly below this heat
     * @param criticalHysteresis CRITICAL drops to WARNING below {@code critical - criticalHysteresis}
     */
    public record Params(double gainAtFullPower, double coolantCooling, double passiveCooling,
                         double warning, double critical, double failure, double resume,
                         double criticalHysteresis) {

        public Params {
            if (!(resume <= warning && warning < critical && critical < failure)) {
                throw new IllegalArgumentException(
                        "thresholds must satisfy resume <= warning < critical < failure");
            }
            if (gainAtFullPower < 0 || coolantCooling < 0 || passiveCooling < 0 || criticalHysteresis < 0) {
                throw new IllegalArgumentException("rates must not be negative");
            }
        }

        public static Params defaults() {
            return new Params(2.0, 1.5, 0.3, 70, 90, 100, 65, 5);
        }
    }

    private final Params params;

    public HeatSimulation(Params params) {
        this.params = params;
    }

    public Params params() {
        return params;
    }

    /** Net heat change per second for the given operating point. */
    public double ratePerSecond(int powerPercent, boolean coolant, boolean generating) {
        double gain = generating ? params.gainAtFullPower() * clampPower(powerPercent) / 100.0 : 0.0;
        double cooling = params.passiveCooling() + (coolant ? params.coolantCooling() : 0.0);
        return gain - cooling;
    }

    /** Advances the heat by {@code dtSeconds}, clamped to 0..100. */
    public double step(double heat, int powerPercent, boolean coolant, boolean generating, double dtSeconds) {
        return clampHeat(heat + ratePerSecond(powerPercent, coolant, generating) * dtSeconds);
    }

    /**
     * Returns the state a generating reactor should be in for the given heat. Non generating states
     * are returned unchanged.
     */
    public ReactorState evaluate(ReactorState current, double heat) {
        if (!current.isGenerating()) {
            return current;
        }
        if (heat >= params.failure()) {
            return ReactorState.FAILED;
        }
        if (heat >= params.critical()) {
            return ReactorState.CRITICAL;
        }
        if (current == ReactorState.CRITICAL) {
            if (heat < params.resume()) {
                return ReactorState.RUNNING;
            }
            return heat < params.critical() - params.criticalHysteresis()
                    ? ReactorState.WARNING : ReactorState.CRITICAL;
        }
        if (current == ReactorState.WARNING) {
            return heat < params.resume() ? ReactorState.RUNNING : ReactorState.WARNING;
        }
        return heat >= params.warning() ? ReactorState.WARNING : ReactorState.RUNNING;
    }

    public static int clampPower(int powerPercent) {
        return Math.max(0, Math.min(100, powerPercent));
    }

    public static double clampHeat(double heat) {
        if (Double.isNaN(heat)) {
            return MIN_HEAT;
        }
        return Math.max(MIN_HEAT, Math.min(MAX_HEAT, heat));
    }
}
