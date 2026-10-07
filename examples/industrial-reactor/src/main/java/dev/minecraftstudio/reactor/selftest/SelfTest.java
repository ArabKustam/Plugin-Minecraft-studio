package dev.minecraftstudio.reactor.selftest;

import dev.minecraftstudio.reactor.music.MusicMetadata;
import dev.minecraftstudio.reactor.music.MusicMetadataParser;
import dev.minecraftstudio.reactor.music.MusicLibrary;
import dev.minecraftstudio.reactor.music.MusicState;
import dev.minecraftstudio.reactor.state.StateTransitions;
import dev.minecraftstudio.reactor.timeline.Cue;
import dev.minecraftstudio.reactor.timeline.Timeline;
import dev.minecraftstudio.reactor.timeline.TimelineLibrary;
import dev.minecraftstudio.reactor.timeline.TimelineParseException;
import dev.minecraftstudio.reactor.timeline.TimelineParser;
import dev.minecraftstudio.reactor.util.ReactorSounds;
import dev.minecraftstudio.reactor.util.ResourceSource;
import dev.minecraftstudio.reactor.util.SoundKeys;

import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Validates the studio generated assets and the state machine. Pure: does not touch the server, so
 * it is used both by {@code /reactor selftest} and by unit tests.
 */
public final class SelfTest {

    /** Outcome of a self test run. */
    public record Result(List<String> failures, List<String> notes) {

        public Result {
            failures = List.copyOf(failures);
            notes = List.copyOf(notes);
        }

        public boolean passed() {
            return failures.isEmpty();
        }

        public String summary() {
            return passed() ? "SELFTEST PASSED" : "SELFTEST FAILED: " + String.join("; ", failures);
        }
    }

    private final ResourceSource source;
    private final String musicPrefix;

    public SelfTest(ResourceSource source) {
        this(source, MusicState.DEFAULT_SOUND_PREFIX);
    }

    /** @param musicPrefix prefix of music sound events (see {@code music-sound-prefix} in config.yml) */
    public SelfTest(ResourceSource source, String musicPrefix) {
        this.source = source;
        this.musicPrefix = musicPrefix;
    }

    public Result run() {
        List<String> failures = new ArrayList<>();
        List<String> notes = new ArrayList<>();
        checkTimelines(failures, notes);
        checkMusic(failures, notes);
        StateTransitions.validate().forEach(p -> failures.add("state machine: " + p));
        for (String key : ReactorSounds.ALL) {
            checkSound("built-in", key, failures);
        }
        return new Result(failures, notes);
    }

    private void checkTimelines(List<String> failures, List<String> notes) {
        for (String id : TimelineLibrary.REQUIRED) {
            String path = TimelineLibrary.path(id);
            Optional<String> json = read(path, failures);
            if (json.isEmpty()) {
                continue;
            }
            try {
                Timeline timeline = TimelineParser.parse(json.get());
                if (!timeline.id().equals(id)) {
                    notes.add(path + " declares id '" + timeline.id() + "'");
                }
                if (timeline.cues().isEmpty()) {
                    failures.add(path + " has no usable cues");
                }
                timeline.warnings().forEach(w -> notes.add(path + ": " + w));
                for (Cue cue : timeline.cues()) {
                    switch (cue) {
                        case Cue.Sfx sfx -> checkSound(path, sfx.sound(), failures);
                        case Cue.Voice voice -> checkSound(path, voice.sound(), failures);
                        case Cue.Particles p -> {
                            if (!SoundKeys.isWellFormed(p.particle())) {
                                failures.add(path + ": malformed particle key '" + p.particle() + "'");
                            }
                        }
                        default -> {
                        }
                    }
                }
            } catch (TimelineParseException e) {
                failures.add(path + ": " + e.getMessage());
            }
        }
    }

    private void checkMusic(List<String> failures, List<String> notes) {
        for (MusicState state : List.of(MusicState.CALM, MusicState.ALARM)) {
            String path = MusicLibrary.path(state);
            Optional<String> json = read(path, failures);
            if (json.isEmpty()) {
                continue;
            }
            try {
                MusicMetadata metadata = MusicMetadataParser.parse(json.get());
                if (metadata.state() != state) {
                    failures.add(path + " declares state '" + metadata.state().id() + "'");
                }
                long ticks = Math.round(metadata.loopSeconds() * 20);
                notes.add(path + ": " + metadata.bpm() + " bpm, loop " + metadata.loopSeconds() + " s (~" + ticks
                        + " ticks)");
                checkSound(path, state.sound(musicPrefix, "intro"), failures);
                checkSound(path, state.sound(musicPrefix, "loop"), failures);
                if (metadata.hasOutro()) {
                    checkSound(path, state.sound(musicPrefix, "outro"), failures);
                }
            } catch (IllegalArgumentException e) {
                failures.add(path + ": " + e.getMessage());
            }
        }
    }

    private Optional<String> read(String path, List<String> failures) {
        try {
            Optional<String> json = source.read(path);
            if (json.isEmpty()) {
                failures.add(path + " is missing");
            }
            return json;
        } catch (UncheckedIOException e) {
            failures.add(path + ": " + e.getMessage());
            return Optional.empty();
        }
    }

    private static void checkSound(String where, String key, List<String> failures) {
        if (!SoundKeys.isWellFormed(key)) {
            failures.add(where + ": malformed sound key '" + key + "'");
        }
    }
}
