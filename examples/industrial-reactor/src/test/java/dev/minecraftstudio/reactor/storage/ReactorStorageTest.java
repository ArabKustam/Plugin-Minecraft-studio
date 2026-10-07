package dev.minecraftstudio.reactor.storage;

import dev.minecraftstudio.reactor.reactor.EntityRole;
import dev.minecraftstudio.reactor.state.CoreTexture;
import dev.minecraftstudio.reactor.state.ReactorState;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReactorStorageTest {

    private final Logger logger = quietLogger();

    private static Logger quietLogger() {
        Logger logger = Logger.getAnonymousLogger();
        logger.setUseParentHandlers(false);
        return logger;
    }

    @Test
    void roundTrip(@TempDir Path dir) {
        ReactorStorage storage = new ReactorStorage(dir.resolve("reactors.yml"), logger);
        UUID core = UUID.randomUUID();
        ReactorRecord record = new ReactorRecord("3", "world", 10, 64, -20, ReactorState.WARNING, 72.5, 75, false,
                CoreTexture.WARNING, 12, Map.of(EntityRole.CORE, core));
        storage.save(new ReactorStorage.Snapshot(4, List.of(record)), 1);

        ReactorStorage.Snapshot loaded = storage.load();
        assertEquals(4, loaded.nextId());
        assertEquals(List.of(record), loaded.reactors());
    }

    @Test
    void olderGenerationIsDiscarded(@TempDir Path dir) {
        ReactorStorage storage = new ReactorStorage(dir.resolve("reactors.yml"), logger);
        storage.save(new ReactorStorage.Snapshot(9, List.of()), 5);
        storage.save(new ReactorStorage.Snapshot(2, List.of()), 4);
        assertEquals(9, storage.load().nextId());
    }

    @Test
    void corruptedFileIsBackedUp(@TempDir Path dir) throws IOException {
        Path file = dir.resolve("reactors.yml");
        Files.writeString(file, "reactors: [unclosed\n  - : :");
        ReactorStorage.Snapshot loaded = new ReactorStorage(file, logger).load();
        assertTrue(loaded.reactors().isEmpty());
        try (var files = Files.list(dir)) {
            assertTrue(files.anyMatch(p -> p.getFileName().toString().contains(".corrupt-")));
        }
    }

    @Test
    void brokenEntriesAreSkipped(@TempDir Path dir) throws IOException {
        Path file = dir.resolve("reactors.yml");
        Files.writeString(file, """
                next-id: 2
                reactors:
                  '1':
                    world: world
                    x: 1
                    y: 2
                    z: 3
                    state: BOGUS
                    entities:
                      core: not-a-uuid
                  '7':
                    x: 5
                """);
        ReactorStorage.Snapshot loaded = new ReactorStorage(file, logger).load();
        assertEquals(1, loaded.reactors().size());
        assertEquals(ReactorState.OFF, loaded.reactors().get(0).state());
        assertTrue(loaded.reactors().get(0).entities().isEmpty());
        assertEquals(2, loaded.nextId());
    }
}
