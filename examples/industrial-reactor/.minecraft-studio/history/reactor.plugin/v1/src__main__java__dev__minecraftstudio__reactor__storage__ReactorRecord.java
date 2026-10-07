package dev.minecraftstudio.reactor.storage;

import dev.minecraftstudio.reactor.reactor.EntityRole;
import dev.minecraftstudio.reactor.state.CoreTexture;
import dev.minecraftstudio.reactor.state.ReactorState;

import java.util.Map;
import java.util.UUID;

/** Immutable persisted snapshot of a reactor. Safe to hand to another thread. */
public record ReactorRecord(String id, String world, int x, int y, int z, ReactorState state, double heat,
                            int power, boolean coolant, CoreTexture texture, int lightLevel,
                            Map<EntityRole, UUID> entities) {

    public ReactorRecord {
        entities = Map.copyOf(entities);
    }
}
