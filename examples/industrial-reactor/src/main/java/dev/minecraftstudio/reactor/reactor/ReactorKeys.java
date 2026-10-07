package dev.minecraftstudio.reactor.reactor;

import org.bukkit.NamespacedKey;

/** Immutable persistent data container keys and item model ids in the {@code reactor} namespace. */
public final class ReactorKeys {

    public static final String NAMESPACE = "reactor";

    /** Reactor id on every reactor entity. */
    public static final NamespacedKey ID = new NamespacedKey(NAMESPACE, "id");
    /** {@link EntityRole} on every reactor entity. */
    public static final NamespacedKey ROLE = new NamespacedKey(NAMESPACE, "role");
    /** Custom item marker ({@code core} or {@code panel}). */
    public static final NamespacedKey ITEM = new NamespacedKey(NAMESPACE, "item");

    private ReactorKeys() {
    }

    public static NamespacedKey model(String id) {
        return new NamespacedKey(NAMESPACE, id);
    }
}
