package dev.minecraftstudio.reactor.reactor;

import org.bukkit.Location;
import org.bukkit.SoundCategory;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** Thin wrapper around positional resource-pack sounds. */
public final class SoundPlayer {

    private SoundPlayer() {
    }

    /** Positional sound heard by everyone in normal attenuation range. */
    public static void playAt(Location location, String sound, SoundCategory category, float volume, float pitch) {
        World world = location.getWorld();
        if (world != null) {
            world.playSound(location, sound, category, volume, pitch);
        }
    }

    /**
     * Positional sound sent only to players within {@code radius}. The volume is raised so the sound
     * stays audible over the whole radius (vanilla attenuation is 16 blocks per 1.0 volume).
     */
    public static void playToNearby(Location location, double radius, String sound, SoundCategory category,
                                    float pitch) {
        World world = location.getWorld();
        if (world == null) {
            return;
        }
        float volume = (float) Math.max(1.0, radius / 16.0);
        double r2 = radius * radius;
        for (Player player : world.getPlayers()) {
            if (player.getLocation().distanceSquared(location) <= r2) {
                player.playSound(location, sound, category, volume, pitch);
            }
        }
    }

    /** Stops {@code sound} for every player within {@code radius}. */
    public static void stopNearby(Location location, double radius, String sound, SoundCategory category) {
        World world = location.getWorld();
        if (world == null) {
            return;
        }
        double r2 = radius * radius;
        for (Player player : world.getPlayers()) {
            if (player.getLocation().distanceSquared(location) <= r2) {
                player.stopSound(sound, category);
            }
        }
    }
}
