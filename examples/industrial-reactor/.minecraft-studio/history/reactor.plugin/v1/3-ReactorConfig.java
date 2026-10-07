package dev.minecraftstudio.reactor.config;

import dev.minecraftstudio.reactor.music.MusicState;
import dev.minecraftstudio.reactor.sim.HeatSimulation;
import org.bukkit.configuration.ConfigurationSection;

import java.util.logging.Logger;

/** Immutable snapshot of {@code config.yml}. */
public record ReactorConfig(String language, double musicRadius, double voiceRadius, long voiceMinGapTicks,
                            HeatSimulation.Params heat, int defaultPower, int runningLightLevel,
                            double rotorSpeed, double panelRange, int autosaveMinutes, boolean bossbar,
                            String musicSoundPrefix) {

    public static ReactorConfig from(ConfigurationSection c, Logger logger) {
        HeatSimulation.Params defaults = HeatSimulation.Params.defaults();
        HeatSimulation.Params heat;
        try {
            heat = new HeatSimulation.Params(
                    c.getDouble("heat.gain-at-full-power", defaults.gainAtFullPower()),
                    c.getDouble("heat.coolant-cooling", defaults.coolantCooling()),
                    c.getDouble("heat.passive-cooling", defaults.passiveCooling()),
                    c.getDouble("heat.warning-threshold", defaults.warning()),
                    c.getDouble("heat.critical-threshold", defaults.critical()),
                    c.getDouble("heat.failure-threshold", defaults.failure()),
                    c.getDouble("heat.resume-threshold", defaults.resume()),
                    c.getDouble("heat.critical-hysteresis", defaults.criticalHysteresis()));
        } catch (IllegalArgumentException e) {
            logger.warning("Invalid heat settings (" + e.getMessage() + "); using defaults");
            heat = defaults;
        }
        return new ReactorConfig(
                c.getString("language", "en"),
                Math.max(1, c.getDouble("music-radius", 48)),
                Math.max(1, c.getDouble("voice-radius", 32)),
                Math.max(0, c.getLong("voice-min-gap-ticks", 50)),
                heat,
                normalizePower(c.getInt("default-power", 50)),
                Math.max(0, Math.min(15, c.getInt("running-light-level", 12))),
                Math.max(0.5, Math.min(18, c.getDouble("rotor-speed", 18))),
                Math.max(1, c.getDouble("panel-range", 8)),
                Math.max(1, c.getInt("autosave-minutes", 5)),
                c.getBoolean("bossbar", true),
                c.getString("music-sound-prefix", MusicState.DEFAULT_SOUND_PREFIX));
    }

    public static final int MIN_POWER = 25;
    public static final int MAX_POWER = 100;

    /** Power is adjustable between 25 and 100 percent. */
    public static int normalizePower(int power) {
        return Math.max(MIN_POWER, Math.min(MAX_POWER, power));
    }
}
