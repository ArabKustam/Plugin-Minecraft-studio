package dev.minecraftstudio.reactor.util;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

/**
 * Reads text assets by relative path ({@code timelines/reactor_startup.json}). A file in the
 * override directory (the plugin data folder) wins over the copy bundled in the jar, so designers
 * can drop freshly generated studio files into the server and run {@code /reactor reload}.
 */
@FunctionalInterface
public interface ResourceSource {

    Optional<String> read(String path);

    /** Bundled resources only. */
    static ResourceSource classpath(ClassLoader loader) {
        return path -> {
            try (InputStream in = loader.getResourceAsStream(path)) {
                if (in == null) {
                    return Optional.empty();
                }
                return Optional.of(new String(in.readAllBytes(), StandardCharsets.UTF_8));
            } catch (IOException e) {
                throw new UncheckedIOException("cannot read resource " + path, e);
            }
        };
    }

    /** Files under {@code overrideDir} first, then {@code fallback}. */
    static ResourceSource withOverrides(Path overrideDir, ResourceSource fallback) {
        return path -> {
            Path file = overrideDir.resolve(path).normalize();
            if (file.startsWith(overrideDir) && Files.isRegularFile(file)) {
                try {
                    return Optional.of(Files.readString(file, StandardCharsets.UTF_8));
                } catch (IOException e) {
                    throw new UncheckedIOException("cannot read " + file, e);
                }
            }
            return fallback.read(path);
        };
    }
}
