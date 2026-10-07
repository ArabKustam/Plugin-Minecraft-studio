package dev.minecraftstudio.reactor.reactor;

/**
 * Pure rotor kinematics: angular speed over time (ramps for spin up / spin down) plus the
 * accumulated angle. Speeds are in degrees per tick; the animator turns them into interpolated
 * display transformations.
 */
public final class RotorMotion {

    private final double maxSpeed;

    private double angle;
    private double rampFromSpeed;
    private double rampToSpeed;
    private long rampStartTick;
    private long rampEndTick;
    private long shakeUntilTick = Long.MIN_VALUE;

    /** @param maxSpeed idle spin speed in degrees per tick */
    public RotorMotion(double maxSpeed) {
        if (!(maxSpeed > 0)) {
            throw new IllegalArgumentException("maxSpeed must be positive");
        }
        this.maxSpeed = maxSpeed;
    }

    public double maxSpeed() {
        return maxSpeed;
    }

    /** Current angular speed in degrees per tick. */
    public double speed(long now) {
        if (now >= rampEndTick) {
            return rampToSpeed;
        }
        if (now <= rampStartTick) {
            return rampFromSpeed;
        }
        double f = (now - rampStartTick) / (double) (rampEndTick - rampStartTick);
        return rampFromSpeed + (rampToSpeed - rampFromSpeed) * f;
    }

    /** Speed the rotor is heading to (the end of the current ramp). */
    public double targetSpeed() {
        return rampToSpeed;
    }

    public double angle() {
        return angle;
    }

    public boolean isShaking(long now) {
        return now < shakeUntilTick;
    }

    /** True when the rotor neither turns nor shakes, so no transformation updates are needed. */
    public boolean isIdle(long now) {
        return speed(now) == 0 && rampToSpeed == 0 && !isShaking(now);
    }

    public void apply(RotorAnimation animation, double durationSeconds, long now) {
        long ticks = Math.max(0, Math.round(durationSeconds * 20));
        switch (animation) {
            case SPIN_UP -> ramp(now, ticks, maxSpeed);
            case SPIN_DOWN -> ramp(now, ticks, 0);
            case IDLE_SPIN -> ramp(now, 0, maxSpeed);
            case STOP -> ramp(now, 0, 0);
            case SHAKE -> shakeUntilTick = now + Math.max(1, ticks);
        }
    }

    private void ramp(long now, long ticks, double target) {
        rampFromSpeed = speed(now);
        rampToSpeed = target;
        rampStartTick = now;
        rampEndTick = now + ticks;
    }

    /**
     * Advances the angle by the average speed over {@code [now, now + ticks]} and returns the new
     * angle in degrees, normalised to [0, 360).
     */
    public double advance(long now, int ticks) {
        double avg = (speed(now) + speed(now + ticks)) / 2.0;
        angle = ((angle + avg * ticks) % 360 + 360) % 360;
        return angle;
    }
}
