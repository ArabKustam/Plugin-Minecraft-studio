package dev.minecraftstudio.reactor.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SoundKeysTest {

    @Test
    void wellFormedKeys() {
        assertTrue(SoundKeys.isWellFormed("reactor:reactor.voice.startup"));
        assertTrue(SoundKeys.isWellFormed("minecraft:block.note_block.harp"));
        assertTrue(SoundKeys.isWellFormed("ambient.cave"));
        assertTrue(SoundKeys.isWellFormed("my-pack:music/loop_1"));
    }

    @Test
    void malformedKeys() {
        assertFalse(SoundKeys.isWellFormed(null));
        assertFalse(SoundKeys.isWellFormed(""));
        assertFalse(SoundKeys.isWellFormed("Reactor:button"));
        assertFalse(SoundKeys.isWellFormed("reactor:"));
        assertFalse(SoundKeys.isWellFormed(":button"));
        assertFalse(SoundKeys.isWellFormed("a:b:c"));
        assertFalse(SoundKeys.isWellFormed("reactor:has space"));
        assertFalse(SoundKeys.isWellFormed("re/actor:button"));
    }

    @Test
    void builtInSoundsAreWellFormed() {
        ReactorSounds.ALL.forEach(key -> assertTrue(SoundKeys.isWellFormed(key), key));
        assertEquals("reactor:reactor.engine_loop", ReactorSounds.ENGINE_LOOP);
    }
}
