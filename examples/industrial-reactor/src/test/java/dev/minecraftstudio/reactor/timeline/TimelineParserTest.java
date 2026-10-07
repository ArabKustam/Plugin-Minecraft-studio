package dev.minecraftstudio.reactor.timeline;

import dev.minecraftstudio.reactor.music.MusicState;
import dev.minecraftstudio.reactor.music.Quantize;
import dev.minecraftstudio.reactor.reactor.RotorAnimation;
import dev.minecraftstudio.reactor.state.CoreTexture;
import dev.minecraftstudio.reactor.state.ReactorState;
import dev.minecraftstudio.reactor.util.ResourceSource;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class TimelineParserTest {

    private static final String SAMPLE = """
            {"id":"reactor_startup","title":"Startup","trigger":"reactor.start","duration_ticks":100,"duration":5,
             "generator":{"version":"1.2.3"},
             "cues":[{"tick":0,"t":0,"track":"sfx","sound":"reactor:reactor.button","volume":1,"pitch":1},
                     {"tick":2,"t":0.12,"track":"voice","line":"startup","sound":"reactor:reactor.voice.startup"},
                     {"tick":30,"t":1.5,"track":"animation","animation":"spin_up","target":"rotor","duration":2.0},
                     {"tick":40,"t":2.0,"track":"particles","particle":"minecraft:cloud","count":12,"spread":[0.4,1,0.4],"duration":1.0},
                     {"tick":70,"t":3.5,"track":"texture","state":"active"},
                     {"tick":70,"t":3.5,"track":"lighting","level":12},
                     {"tick":80,"t":4.0,"track":"music","action":"transition","state":"calm","quantize":"bar","fade":0.5},
                     {"tick":100,"t":5.0,"track":"ui","bossbar":"Reactor ONLINE","progress":1.0},
                     {"tick":100,"t":5.0,"track":"state","state":"RUNNING"},
                     {"tick":8,"t":0.4,"track":"sfx","sound":"reactor:reactor.relay"},
                     {"tick":9,"track":"event","id":"marker"}]}
            """;

    @Test
    void parsesAllTracksAndSortsByTick() throws TimelineParseException {
        Timeline t = TimelineParser.parse(SAMPLE);
        assertEquals("reactor_startup", t.id());
        assertEquals("reactor.start", t.trigger());
        assertEquals(100, t.durationTicks());
        assertEquals(11, t.cues().size());
        assertTrue(t.warnings().isEmpty(), t.warnings().toString());
        List<Integer> ticks = t.cues().stream().map(Cue::tick).toList();
        assertEquals(List.of(0, 2, 8, 9, 30, 40, 70, 70, 80, 100, 100), ticks);

        Cue.Voice voice = assertInstanceOf(Cue.Voice.class, t.cues().get(1));
        assertEquals("startup", voice.line());
        assertEquals(0, voice.durationSeconds(), 1e-9);
        Cue.Sfx button = assertInstanceOf(Cue.Sfx.class, t.cues().get(0));
        assertEquals("reactor:reactor.button", button.sound());
        assertFalse(button.loop());
        assertFalse(button.stop());

        Cue.Animation spin = assertInstanceOf(Cue.Animation.class, t.cues().get(4));
        assertEquals(RotorAnimation.SPIN_UP, spin.animation());
        assertEquals(2.0, spin.durationSeconds(), 1e-9);

        Cue.Particles cloud = assertInstanceOf(Cue.Particles.class, t.cues().get(5));
        assertEquals(12, cloud.count());
        assertEquals(1.0, cloud.spreadY(), 1e-9);

        assertEquals(CoreTexture.ACTIVE, assertInstanceOf(Cue.Texture.class, t.cues().get(6)).texture());
        assertEquals(12, assertInstanceOf(Cue.Lighting.class, t.cues().get(7)).level());
        Cue.Music music = assertInstanceOf(Cue.Music.class, t.cues().get(8));
        assertEquals(MusicState.CALM, music.state());
        assertEquals(Quantize.BAR, music.quantize());
        assertEquals("Reactor ONLINE", assertInstanceOf(Cue.Ui.class, t.cues().get(9)).title());
        assertEquals(ReactorState.RUNNING, assertInstanceOf(Cue.State.class, t.cues().get(10)).state());
    }

    @Test
    void tickFallsBackToSeconds() throws TimelineParseException {
        Timeline t = TimelineParser.parse("""
                {"id":"x","duration":2,"cues":[{"t":1.26,"track":"lighting","level":20}]}
                """);
        assertEquals(40, t.durationTicks());
        Cue.Lighting light = assertInstanceOf(Cue.Lighting.class, t.cues().get(0));
        assertEquals(25, light.tick());
        assertEquals(15, light.level(), "level is clamped to 0..15");
    }

    @Test
    void durationIsNeverShorterThanLastCue() throws TimelineParseException {
        Timeline t = TimelineParser.parse("""
                {"id":"x","duration_ticks":10,"cues":[{"tick":50,"track":"state","state":"OFF"}]}
                """);
        assertEquals(50, t.durationTicks());
    }

    @Test
    void unknownTracksAndBadValuesAreSkippedWithWarnings() throws TimelineParseException {
        Timeline t = TimelineParser.parse("""
                {"id":"x","cues":[
                  {"tick":0,"track":"hologram","text":"hi"},
                  {"tick":1,"track":"animation","animation":"explode"},
                  {"tick":2,"track":"sfx"},
                  {"track":"state","state":"OFF"},
                  {"tick":-5,"track":"state","state":"OFF"},
                  "garbage",
                  {"tick":3,"track":"music","action":"stop"}]}
                """);
        assertEquals(1, t.cues().size());
        assertEquals(6, t.warnings().size(), t.warnings().toString());
        Cue.Music stop = assertInstanceOf(Cue.Music.class, t.cues().get(0));
        assertEquals(MusicState.NONE, stop.state());
    }

    @Test
    void sfxLoopAndStopFlags() throws TimelineParseException {
        Timeline t = TimelineParser.parse("""
                {"id":"x","cues":[
                  {"tick":0,"track":"sfx","sound":"reactor:reactor.siren","loop":true,"loop_ticks":40},
                  {"tick":5,"track":"sfx","sound":"reactor:reactor.siren","action":"stop"},
                  {"tick":6,"track":"sfx","sound":"reactor:reactor.siren","stop":true,"pitch":9}]}
                """);
        Cue.Sfx loop = assertInstanceOf(Cue.Sfx.class, t.cues().get(0));
        assertTrue(loop.loop());
        assertEquals(40, loop.loopTicks());
        assertTrue(assertInstanceOf(Cue.Sfx.class, t.cues().get(1)).stop());
        Cue.Sfx third = assertInstanceOf(Cue.Sfx.class, t.cues().get(2));
        assertTrue(third.stop());
        assertEquals(2.0f, third.pitch(), 1e-6, "pitch clamped to the vanilla range");
        assertEquals(TimelineParser.DEFAULT_LOOP_TICKS, third.loopTicks());
    }

    @Test
    void invalidDocumentsAreRejected() {
        assertThrows(TimelineParseException.class, () -> TimelineParser.parse("{not json"));
        assertThrows(TimelineParseException.class, () -> TimelineParser.parse("[1,2]"));
        assertThrows(TimelineParseException.class, () -> TimelineParser.parse("{\"cues\":[]}"));
    }

    @Test
    void fixtureTimelinesLoad() {
        ResourceSource classpath = ResourceSource.classpath(getClass().getClassLoader());
        assertLibraryValid(path -> classpath.read("fixtures/" + path));
    }

    @Test
    void voiceDurationsAreExposed() {
        ResourceSource classpath = ResourceSource.classpath(getClass().getClassLoader());
        TimelineLibrary library = TimelineLibrary.load(path -> classpath.read("fixtures/" + path),
                java.util.logging.Logger.getAnonymousLogger());
        assertEquals(64, library.voiceTicks("reactor:reactor.voice.startup"));
        assertEquals(0, library.voiceTicks("reactor:reactor.voice.shutdown"));
        assertEquals(0, library.voiceTicks("reactor:unknown"));
    }

    @Test
    void generatedTimelinesLoadWhenPresent() {
        ResourceSource classpath = ResourceSource.classpath(getClass().getClassLoader());
        assumeTrue(TimelineLibrary.REQUIRED.stream().allMatch(id -> classpath.read(TimelineLibrary.path(id)).isPresent()),
                "studio timelines not generated yet");
        assertLibraryValid(classpath);
    }

    private static void assertLibraryValid(ResourceSource source) {
        java.util.logging.Logger logger = java.util.logging.Logger.getAnonymousLogger();
        TimelineLibrary library = TimelineLibrary.load(source, logger);
        assertEquals(3, library.size());
        for (String id : TimelineLibrary.REQUIRED) {
            Timeline t = library.get(id).orElseThrow();
            assertTrue(t.warnings().isEmpty(), id + ": " + t.warnings());
            assertFalse(t.cues().isEmpty());
        }
        assertTrue(library.get(TimelineLibrary.STARTUP).orElseThrow().cues().stream()
                .anyMatch(c -> c instanceof Cue.State s && s.state() == ReactorState.RUNNING));
        for (String id : List.of(TimelineLibrary.SHUTDOWN, TimelineLibrary.SCRAM)) {
            Timeline t = library.get(id).orElseThrow();
            assertTrue(t.cues().stream().anyMatch(c -> c instanceof Cue.State s && s.state() == ReactorState.OFF));
        }
    }
}
