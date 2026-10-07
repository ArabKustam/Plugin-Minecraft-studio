package dev.minecraftstudio.reactor.util;

import java.util.regex.Pattern;

/** Helpers for resource-pack sound event keys. */
public final class SoundKeys {

    public static final String NAMESPACE = "reactor";

    private static final Pattern NAMESPACE_PATTERN = Pattern.compile("[a-z0-9_.-]+");
    private static final Pattern PATH_PATTERN = Pattern.compile("[a-z0-9_./-]+");

    private SoundKeys() {
    }

    /** {@code reactor:<event>} for a sound event declared in the reactor resource pack. */
    public static String reactor(String event) {
        return NAMESPACE + ":" + event;
    }

    /**
     * Returns whether the key is a well formed resource location ({@code namespace:path} or a bare
     * path that implies {@code minecraft:}).
     */
    public static boolean isWellFormed(String key) {
        if (key == null || key.isEmpty()) {
            return false;
        }
        int colon = key.indexOf(':');
        if (colon < 0) {
            return PATH_PATTERN.matcher(key).matches();
        }
        if (key.indexOf(':', colon + 1) >= 0) {
            return false;
        }
        String namespace = key.substring(0, colon);
        String path = key.substring(colon + 1);
        return NAMESPACE_PATTERN.matcher(namespace).matches() && PATH_PATTERN.matcher(path).matches();
    }
}
