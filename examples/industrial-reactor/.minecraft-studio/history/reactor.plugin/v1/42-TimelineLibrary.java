package dev.minecraftstudio.reactor.timeline;

import dev.minecraftstudio.reactor.util.ResourceSource;

import java.io.UncheckedIOException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.logging.Level;
import java.util.logging.Logger;

/** The compiled timelines the plugin knows about, loaded from {@code timelines/<id>.json}. */
public final class TimelineLibrary {

    public static final String STARTUP = "reactor_startup";
    public static final String SHUTDOWN = "reactor_shutdown";
    public static final String SCRAM = "reactor_scram";
    public static final List<String> REQUIRED = List.of(STARTUP, SHUTDOWN, SCRAM);

    private final Map<String, Timeline> timelines;

    private TimelineLibrary(Map<String, Timeline> timelines) {
        this.timelines = Collections.unmodifiableMap(timelines);
    }

    public static String path(String id) {
        return "timelines/" + id + ".json";
    }

    /** Loads all required timelines; missing or broken files are logged and skipped. */
    public static TimelineLibrary load(ResourceSource source, Logger logger) {
        Map<String, Timeline> loaded = new LinkedHashMap<>();
        for (String id : REQUIRED) {
            try {
                Optional<String> json = source.read(path(id));
                if (json.isEmpty()) {
                    logger.warning("Timeline " + path(id) + " not found; the reactor will skip it");
                    continue;
                }
                Timeline timeline = TimelineParser.parse(json.get());
                timeline.warnings().forEach(w -> logger.warning("Timeline " + id + ": " + w));
                loaded.put(id, timeline);
            } catch (TimelineParseException | UncheckedIOException e) {
                logger.log(Level.WARNING, "Cannot load timeline " + id + ": " + e.getMessage());
            }
        }
        return new TimelineLibrary(loaded);
    }

    public Optional<Timeline> get(String id) {
        return Optional.ofNullable(timelines.get(id));
    }

    /** Spoken length of a voice sound in ticks, as declared by any timeline cue (0 when unknown). */
    public long voiceTicks(String sound) {
        double seconds = 0;
        for (Timeline timeline : timelines.values()) {
            for (Cue cue : timeline.cues()) {
                if (cue instanceof Cue.Voice voice && voice.sound().equals(sound)) {
                    seconds = Math.max(seconds, voice.durationSeconds());
                }
            }
        }
        return Math.round(seconds * 20);
    }

    public int size() {
        return timelines.size();
    }
}
