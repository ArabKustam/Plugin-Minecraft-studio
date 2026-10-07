package dev.minecraftstudio.reactor.music;

import java.util.List;

/**
 * Parsed Minecraft Studio music metadata ({@code music/reactor_<state>.json}).
 *
 * @param title               track title
 * @param state               mood this track belongs to
 * @param bpm                 tempo
 * @param beatsPerBar         meter numerator
 * @param beatSeconds         seconds per beat
 * @param barSeconds          seconds per bar
 * @param introSeconds        length of the intro sound (0 when the track has no intro)
 * @param outroSeconds        length of the optional outro sound (0 when the track has no outro)
 * @param loopSeconds         exact length of the seamless loop sound
 * @param loopBars            bars in the loop
 * @param transitionEveryBars bar grid on which mood changes are allowed
 * @param transitionPoints    transition points inside the loop in seconds (informational)
 */
public record MusicMetadata(String title, MusicState state, double bpm, int beatsPerBar,
                            double beatSeconds, double barSeconds, double introSeconds, double outroSeconds,
                            double loopSeconds, int loopBars, int transitionEveryBars,
                            List<Double> transitionPoints) {

    public MusicMetadata {
        transitionPoints = List.copyOf(transitionPoints);
    }

    public boolean hasOutro() {
        return outroSeconds > 0;
    }

    public BarClock clock() {
        return new BarClock(bpm, beatsPerBar);
    }

    /** Grid unit (in seconds) used for {@link Quantize#BAR} transitions. */
    public double transitionUnitSeconds() {
        return barSeconds * Math.max(1, transitionEveryBars);
    }
}
