package dev.minecraftstudio.reactor.storage;

import dev.minecraftstudio.reactor.reactor.EntityRole;
import dev.minecraftstudio.reactor.state.CoreTexture;
import dev.minecraftstudio.reactor.state.ReactorState;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Reads and writes {@code reactors.yml}. {@link #save(Snapshot)} only touches immutable data and
 * may run on an async thread; writes are serialised and atomic (temp file + move).
 */
public final class ReactorStorage {

    /** Everything that is persisted. */
    public record Snapshot(int nextId, List<ReactorRecord> reactors) {
        public Snapshot {
            reactors = List.copyOf(reactors);
        }
    }

    private static final DateTimeFormatter BACKUP_STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    private final Path file;
    private final Logger logger;
    private final Object writeLock = new Object();
    private long lastWrittenGeneration = Long.MIN_VALUE;

    public ReactorStorage(Path file, Logger logger) {
        this.file = file;
        this.logger = logger;
    }

    /**
     * Loads the file. A corrupted file is backed up and an empty snapshot is returned; broken
     * entries are skipped individually.
     */
    public Snapshot load() {
        if (!Files.isRegularFile(file)) {
            return new Snapshot(1, List.of());
        }
        YamlConfiguration yaml = new YamlConfiguration();
        try {
            yaml.loadFromString(Files.readString(file, StandardCharsets.UTF_8));
        } catch (IOException | InvalidConfigurationException | RuntimeException e) {
            logger.log(Level.SEVERE, "reactors.yml is corrupted (" + e.getMessage() + "); backing it up and starting empty");
            backupCorrupted();
            return new Snapshot(1, List.of());
        }
        return fromYaml(yaml, logger);
    }

    static Snapshot fromYaml(YamlConfiguration yaml, Logger logger) {
        List<ReactorRecord> records = new ArrayList<>();
        int maxId = 0;
        ConfigurationSection section = yaml.getConfigurationSection("reactors");
        if (section != null) {
            for (String id : section.getKeys(false)) {
                ConfigurationSection s = section.getConfigurationSection(id);
                try {
                    if (s == null) {
                        throw new IllegalArgumentException("not a section");
                    }
                    records.add(read(id, s));
                    maxId = Math.max(maxId, numericId(id));
                } catch (RuntimeException e) {
                    logger.warning("Skipping reactor '" + id + "' in reactors.yml: " + e.getMessage());
                }
            }
        }
        int nextId = Math.max(yaml.getInt("next-id", 1), maxId + 1);
        return new Snapshot(nextId, records);
    }

    private static ReactorRecord read(String id, ConfigurationSection s) {
        String world = s.getString("world");
        if (world == null || world.isBlank()) {
            throw new IllegalArgumentException("missing world");
        }
        ReactorState state = ReactorState.parse(s.getString("state", "OFF")).orElse(ReactorState.OFF);
        CoreTexture texture = CoreTexture.parse(s.getString("texture")).orElse(CoreTexture.forState(state));
        Map<EntityRole, UUID> entities = new EnumMap<>(EntityRole.class);
        ConfigurationSection es = s.getConfigurationSection("entities");
        if (es != null) {
            for (String key : es.getKeys(false)) {
                EntityRole role = EntityRole.parse(key).orElse(null);
                String raw = es.getString(key);
                if (role != null && raw != null) {
                    try {
                        entities.put(role, UUID.fromString(raw));
                    } catch (IllegalArgumentException ignored) {
                        // a fresh entity will be spawned
                    }
                }
            }
        }
        return new ReactorRecord(id, world, s.getInt("x"), s.getInt("y"), s.getInt("z"), state,
                Math.max(0, Math.min(100, s.getDouble("heat"))), s.getInt("power", 50),
                s.getBoolean("coolant", true), texture, Math.max(0, Math.min(15, s.getInt("light", 0))), entities);
    }

    static YamlConfiguration toYaml(Snapshot snapshot) {
        YamlConfiguration yaml = new YamlConfiguration();
        yaml.set("version", 1);
        yaml.set("next-id", snapshot.nextId());
        for (ReactorRecord r : snapshot.reactors()) {
            String p = "reactors." + r.id() + ".";
            yaml.set(p + "world", r.world());
            yaml.set(p + "x", r.x());
            yaml.set(p + "y", r.y());
            yaml.set(p + "z", r.z());
            yaml.set(p + "state", r.state().name());
            yaml.set(p + "heat", Math.round(r.heat() * 100) / 100.0);
            yaml.set(p + "power", r.power());
            yaml.set(p + "coolant", r.coolant());
            yaml.set(p + "texture", r.texture().name());
            yaml.set(p + "light", r.lightLevel());
            r.entities().forEach((role, uuid) -> yaml.set(p + "entities." + role.id(), uuid.toString()));
        }
        return yaml;
    }

    /**
     * Writes the snapshot atomically. Thread safe; a snapshot older than the last written one
     * ({@code generation} is increasing) is discarded so a slow async save never overwrites newer data.
     */
    public void save(Snapshot snapshot, long generation) {
        String data = toYaml(snapshot).saveToString();
        synchronized (writeLock) {
            if (generation <= lastWrittenGeneration) {
                return;
            }
            lastWrittenGeneration = generation;
            try {
                Files.createDirectories(file.getParent());
                Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
                Files.writeString(tmp, data, StandardCharsets.UTF_8);
                try {
                    Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException e) {
                    Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
                }
            } catch (IOException e) {
                logger.log(Level.SEVERE, "Could not save reactors.yml", e);
            }
        }
    }

    private void backupCorrupted() {
        try {
            Path backup = file.resolveSibling(file.getFileName() + ".corrupt-"
                    + LocalDateTime.now().format(BACKUP_STAMP) + ".bak");
            Files.copy(file, backup, StandardCopyOption.REPLACE_EXISTING);
            logger.warning("Corrupted reactors.yml copied to " + backup.getFileName());
        } catch (IOException e) {
            logger.log(Level.SEVERE, "Could not back up corrupted reactors.yml", e);
        }
    }

    private static int numericId(String id) {
        try {
            return Integer.parseInt(id);
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
