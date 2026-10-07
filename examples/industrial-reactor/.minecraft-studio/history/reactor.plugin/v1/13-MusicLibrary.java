package dev.minecraftstudio.reactor.music;

import dev.minecraftstudio.reactor.util.ResourceSource;

import java.io.UncheckedIOException;
import java.util.Collections;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import java.util.logging.Logger;

/** Music metadata per mood, loaded from {@code music/reactor_<state>.json}. */
public final class MusicLibrary {

    private final Map<MusicState, MusicMetadata> tracks;

    private MusicLibrary(Map<MusicState, MusicMetadata> tracks) {
        this.tracks = Collections.unmodifiableMap(tracks);
    }

    public static String path(MusicState state) {
        return "music/reactor_" + state.id() + ".json";
    }

    public static MusicLibrary load(ResourceSource source, Logger logger) {
        Map<MusicState, MusicMetadata> loaded = new EnumMap<>(MusicState.class);
        for (MusicState state : MusicState.values()) {
            if (state == MusicState.NONE) {
                continue;
            }
            try {
                Optional<String> json = source.read(path(state));
                if (json.isEmpty()) {
                    logger.warning("Music metadata " + path(state) + " not found; " + state.id() + " music disabled");
                    continue;
                }
                MusicMetadata metadata = MusicMetadataParser.parse(json.get());
                if (metadata.state() != state) {
                    logger.warning(path(state) + " declares state '" + metadata.state().id() + "'; using it as "
                            + state.id());
                }
                loaded.put(state, metadata);
            } catch (IllegalArgumentException | UncheckedIOException e) {
                logger.warning("Cannot load music metadata " + path(state) + ": " + e.getMessage());
            }
        }
        return new MusicLibrary(loaded);
    }

    public Optional<MusicMetadata> get(MusicState state) {
        return Optional.ofNullable(tracks.get(state));
    }
}
