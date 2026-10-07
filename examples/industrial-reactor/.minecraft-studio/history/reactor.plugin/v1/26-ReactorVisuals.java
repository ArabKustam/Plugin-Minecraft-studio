package dev.minecraftstudio.reactor.reactor;

import dev.minecraftstudio.reactor.item.ReactorItems;
import dev.minecraftstudio.reactor.state.CoreTexture;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.type.Light;
import org.bukkit.entity.Display;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Interaction;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.util.Transformation;
import org.joml.AxisAngle4f;
import org.joml.Quaternionf;
import org.joml.Vector3f;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Spawns, re-links and drives the display entities of a reactor: core model, rotor, status lamp
 * and the interaction hitbox. Also manages the barrier block and the light block above the core.
 */
public final class ReactorVisuals {

    /** Ticks between two rotor transformation updates (interpolated client side). */
    public static final int ROTOR_STEP_TICKS = 5;

    private static final double ROTOR_HEIGHT = 1.35;
    private static final double LAMP_HEIGHT = 1.95;
    private static final float INTERACTION_SIZE = 1.1f;

    /** Looks up a loaded reactor entity by UUID. */
    public Entity entity(Reactor reactor, EntityRole role) {
        UUID uuid = reactor.entity(role);
        return uuid == null ? null : Bukkit.getEntity(uuid);
    }

    /** Places the barrier and spawns every entity that is not currently loaded. Chunk must be loaded. */
    public void ensureSpawned(Reactor reactor) {
        Location base = reactor.blockLocation();
        if (base == null) {
            return;
        }
        Block block = base.getBlock();
        if (block.getType() != Material.BARRIER) {
            block.setType(Material.BARRIER, false);
        }
        boolean spawned = false;
        for (EntityRole role : EntityRole.values()) {
            Entity existing = entity(reactor, role);
            if (existing == null || !existing.isValid()) {
                reactor.setEntity(role, spawn(reactor, role, base).getUniqueId());
                spawned = true;
            }
        }
        if (spawned) {
            applyCore(reactor);
            applyLamp(reactor, Boolean.TRUE.equals(reactor.lampLit()));
        }
    }

    private Entity spawn(Reactor reactor, EntityRole role, Location base) {
        World world = base.getWorld();
        Location center = base.clone().add(0.5, 0.5, 0.5);
        return switch (role) {
            case CORE -> world.spawn(center, ItemDisplay.class, d -> {
                configureDisplay(d, reactor, role);
                d.setItemStack(ReactorItems.model(reactor.texture().modelId()));
            });
            case ROTOR -> world.spawn(base.clone().add(0.5, ROTOR_HEIGHT, 0.5), ItemDisplay.class, d -> {
                configureDisplay(d, reactor, role);
                d.setItemStack(ReactorItems.model("rotor"));
                d.setTransformation(rotorTransformation(reactor.rotor().angle(), 0, 0));
            });
            case LAMP -> world.spawn(base.clone().add(0.5, LAMP_HEIGHT, 0.5), ItemDisplay.class, d -> {
                configureDisplay(d, reactor, role);
                d.setItemStack(ReactorItems.model("lamp_off"));
            });
            case INTERACTION -> world.spawn(base.clone().add(0.5, -0.05, 0.5), Interaction.class, i -> {
                tag(i, reactor, role);
                i.setPersistent(true);
                i.setInteractionWidth(INTERACTION_SIZE);
                i.setInteractionHeight(INTERACTION_SIZE);
                i.setResponsive(true);
            });
        };
    }

    private static void configureDisplay(ItemDisplay display, Reactor reactor, EntityRole role) {
        tag(display, reactor, role);
        display.setPersistent(true);
        display.setItemDisplayTransform(ItemDisplay.ItemDisplayTransform.FIXED);
        display.setViewRange(1.5f);
    }

    private static void tag(Entity entity, Reactor reactor, EntityRole role) {
        PersistentDataContainer pdc = entity.getPersistentDataContainer();
        pdc.set(ReactorKeys.ID, PersistentDataType.STRING, reactor.id());
        pdc.set(ReactorKeys.ROLE, PersistentDataType.STRING, role.id());
    }

    /** Reactor id stored on an entity, or null for foreign entities. */
    public static String reactorId(Entity entity) {
        return entity.getPersistentDataContainer().get(ReactorKeys.ID, PersistentDataType.STRING);
    }

    public static EntityRole role(Entity entity) {
        return EntityRole.parse(entity.getPersistentDataContainer().get(ReactorKeys.ROLE, PersistentDataType.STRING))
                .orElse(null);
    }

    public void setTexture(Reactor reactor, CoreTexture texture) {
        reactor.setTexture(texture);
        applyCore(reactor);
    }

    private void applyCore(Reactor reactor) {
        if (entity(reactor, EntityRole.CORE) instanceof ItemDisplay core) {
            core.setItemStack(ReactorItems.model(reactor.texture().modelId()));
            boolean glowing = reactor.texture() != CoreTexture.OFF;
            core.setBrightness(glowing ? new Display.Brightness(15, 15) : null);
        }
    }

    /** Switches the lamp model; no-op when unchanged. */
    public void setLamp(Reactor reactor, boolean lit) {
        if (reactor.lampLit() != null && reactor.lampLit() == lit) {
            return;
        }
        reactor.setLampLit(lit);
        applyLamp(reactor, lit);
    }

    private void applyLamp(Reactor reactor, boolean lit) {
        if (entity(reactor, EntityRole.LAMP) instanceof ItemDisplay lamp) {
            lamp.setItemStack(ReactorItems.model(lit ? "lamp_on" : "lamp_off"));
            lamp.setBrightness(lit ? new Display.Brightness(15, 15) : null);
        }
    }

    /** Sends the next interpolated rotor step. Call every {@link #ROTOR_STEP_TICKS} ticks. */
    public void stepRotor(Reactor reactor, long now) {
        RotorMotion motion = reactor.rotor();
        if (motion.isIdle(now)) {
            return;
        }
        if (!(entity(reactor, EntityRole.ROTOR) instanceof ItemDisplay rotor)) {
            return;
        }
        boolean shaking = motion.isShaking(now);
        double angle = motion.advance(now, ROTOR_STEP_TICKS);
        ThreadLocalRandom random = ThreadLocalRandom.current();
        float jx = shaking ? (float) random.nextDouble(-0.05, 0.05) : 0;
        float jz = shaking ? (float) random.nextDouble(-0.05, 0.05) : 0;
        rotor.setInterpolationDelay(0);
        rotor.setInterpolationDuration(ROTOR_STEP_TICKS);
        rotor.setTransformation(rotorTransformation(angle, jx, jz));
    }

    private static Transformation rotorTransformation(double angleDegrees, float jitterX, float jitterZ) {
        Quaternionf rotation = new Quaternionf(new AxisAngle4f((float) Math.toRadians(angleDegrees), 0, 1, 0));
        return new Transformation(new Vector3f(jitterX, 0, jitterZ), rotation, new Vector3f(1, 1, 1),
                new Quaternionf());
    }

    /** Places (level &gt; 0) or removes (0) a light block above the core. */
    public void setLight(Reactor reactor, int level) {
        reactor.setLightLevel(level);
        Location base = reactor.blockLocation();
        if (base == null || !reactor.isLoaded()) {
            return;
        }
        Block above = base.getBlock().getRelative(0, 1, 0);
        if (level <= 0) {
            if (above.getType() == Material.LIGHT) {
                above.setType(Material.AIR, false);
            }
            return;
        }
        if (above.getType().isAir() || above.getType() == Material.LIGHT) {
            Light light = (Light) Material.LIGHT.createBlockData();
            light.setLevel(Math.min(light.getMaximumLevel(), level));
            above.setBlockData(light, false);
        }
    }

    /**
     * Removes all loaded entities, the barrier and the light block. Entities of an unloaded chunk
     * are removed as orphans when they load (their reactor id no longer exists).
     */
    public void destroy(Reactor reactor) {
        for (Map.Entry<EntityRole, UUID> e : reactor.entities().entrySet()) {
            Entity entity = Bukkit.getEntity(e.getValue());
            if (entity != null) {
                entity.remove();
            }
        }
        Location base = reactor.blockLocation();
        if (base == null) {
            return;
        }
        Block block = base.getBlock();
        Block above = block.getRelative(0, 1, 0);
        if (above.getType() == Material.LIGHT) {
            above.setType(Material.AIR, false);
        }
        if (block.getType() == Material.BARRIER) {
            block.setType(Material.AIR, false);
        }
    }
}
