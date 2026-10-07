package dev.minecraftstudio.reactor.reactor;

import dev.minecraftstudio.reactor.music.MusicState;
import dev.minecraftstudio.reactor.music.Quantize;
import dev.minecraftstudio.reactor.state.CoreTexture;
import dev.minecraftstudio.reactor.state.ReactorState;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;

import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;

/**
 * One placed reactor: persistent data plus transient runtime state. Accessed on the main thread
 * only.
 */
public final class Reactor {

    /** How a running shutdown sequence was requested. */
    public enum ShutdownMode { NORMAL, SCRAM }

    /** Temporary boss bar text pushed by a timeline {@code ui} cue. */
    public record UiOverride(String title, float progress, String color, long untilTick) {
    }

    private final String id;
    private final String worldName;
    private final int x;
    private final int y;
    private final int z;

    private ReactorState state = ReactorState.OFF;
    private double heat;
    private int power;
    private boolean coolant = true;
    private CoreTexture texture = CoreTexture.OFF;
    private int lightLevel;
    private final Map<EntityRole, UUID> entities = new EnumMap<>(EntityRole.class);

    // transient
    private final RotorMotion rotor;
    private final VoiceGate voice;
    private ShutdownMode shutdownMode = ShutdownMode.NORMAL;
    private MusicState musicState = MusicState.NONE;
    private Quantize musicQuantize = Quantize.BAR;
    private UiOverride uiOverride;
    private Boolean lampLit;

    public Reactor(String id, String worldName, int x, int y, int z, double rotorSpeed, long voiceGapTicks) {
        this.id = id;
        this.worldName = worldName;
        this.x = x;
        this.y = y;
        this.z = z;
        this.rotor = new RotorMotion(rotorSpeed);
        this.voice = new VoiceGate(voiceGapTicks);
    }

    public String id() {
        return id;
    }

    public String worldName() {
        return worldName;
    }

    public int x() {
        return x;
    }

    public int y() {
        return y;
    }

    public int z() {
        return z;
    }

    public World world() {
        return Bukkit.getWorld(worldName);
    }

    /** True when the world and the core chunk (including its entities) are loaded. */
    public boolean isLoaded() {
        World world = world();
        return world != null && world.isChunkLoaded(x >> 4, z >> 4)
                && world.getChunkAt(x >> 4, z >> 4).isEntitiesLoaded();
    }

    public boolean isInChunk(String world, int chunkX, int chunkZ) {
        return worldName.equals(world) && (x >> 4) == chunkX && (z >> 4) == chunkZ;
    }

    /** Block position of the core (null when the world is not loaded). */
    public Location blockLocation() {
        World world = world();
        return world == null ? null : new Location(world, x, y, z);
    }

    /** Centre of the core block (null when the world is not loaded). */
    public Location center() {
        World world = world();
        return world == null ? null : new Location(world, x + 0.5, y + 0.5, z + 0.5);
    }

    public ReactorState state() {
        return state;
    }

    void setState(ReactorState state) {
        this.state = state;
    }

    public double heat() {
        return heat;
    }

    public void setHeat(double heat) {
        this.heat = heat;
    }

    public int power() {
        return power;
    }

    public void setPower(int power) {
        this.power = power;
    }

    public boolean coolant() {
        return coolant;
    }

    public void setCoolant(boolean coolant) {
        this.coolant = coolant;
    }

    public CoreTexture texture() {
        return texture;
    }

    void setTexture(CoreTexture texture) {
        this.texture = texture;
    }

    public int lightLevel() {
        return lightLevel;
    }

    void setLightLevel(int lightLevel) {
        this.lightLevel = lightLevel;
    }

    public UUID entity(EntityRole role) {
        return entities.get(role);
    }

    public void setEntity(EntityRole role, UUID uuid) {
        if (uuid == null) {
            entities.remove(role);
        } else {
            entities.put(role, uuid);
        }
    }

    public Map<EntityRole, UUID> entities() {
        return Map.copyOf(entities);
    }

    public RotorMotion rotor() {
        return rotor;
    }

    public VoiceGate voice() {
        return voice;
    }

    public ShutdownMode shutdownMode() {
        return shutdownMode;
    }

    void setShutdownMode(ShutdownMode shutdownMode) {
        this.shutdownMode = shutdownMode;
    }

    public MusicState musicState() {
        return musicState;
    }

    public Quantize musicQuantize() {
        return musicQuantize;
    }

    public void setMusic(MusicState state, Quantize quantize) {
        this.musicState = state;
        this.musicQuantize = quantize;
    }

    public UiOverride uiOverride(long now) {
        if (uiOverride != null && now >= uiOverride.untilTick()) {
            uiOverride = null;
        }
        return uiOverride;
    }

    public void setUiOverride(UiOverride uiOverride) {
        this.uiOverride = uiOverride;
    }

    Boolean lampLit() {
        return lampLit;
    }

    void setLampLit(Boolean lampLit) {
        this.lampLit = lampLit;
    }
}
