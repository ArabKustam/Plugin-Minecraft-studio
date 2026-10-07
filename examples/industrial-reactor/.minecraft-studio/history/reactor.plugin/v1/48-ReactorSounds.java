package dev.minecraftstudio.reactor.util;

import java.util.List;

/** Sound events of the {@code reactor} resource pack used directly by the plugin. */
public final class ReactorSounds {

    public static final String BUTTON = SoundKeys.reactor("reactor.button");
    public static final String RELAY = SoundKeys.reactor("reactor.relay");
    public static final String HYDRAULIC = SoundKeys.reactor("reactor.hydraulic");
    public static final String ENGINE_LOOP = SoundKeys.reactor("reactor.engine_loop");
    public static final String SIREN = SoundKeys.reactor("reactor.siren");
    public static final String ALARM_BEEP = SoundKeys.reactor("reactor.alarm_beep");
    public static final String POWER_DOWN = SoundKeys.reactor("reactor.power_down");

    public static final String VOICE_STARTUP = SoundKeys.reactor("reactor.voice.startup");
    public static final String VOICE_ONLINE = SoundKeys.reactor("reactor.voice.online");
    public static final String VOICE_WARNING = SoundKeys.reactor("reactor.voice.warning");
    public static final String VOICE_CRITICAL = SoundKeys.reactor("reactor.voice.critical");
    public static final String VOICE_SHUTDOWN = SoundKeys.reactor("reactor.voice.shutdown");

    public static final List<String> ALL = List.of(BUTTON, RELAY, HYDRAULIC, ENGINE_LOOP, SIREN, ALARM_BEEP,
            POWER_DOWN, VOICE_STARTUP, VOICE_ONLINE, VOICE_WARNING, VOICE_CRITICAL, VOICE_SHUTDOWN);

    private ReactorSounds() {
    }
}
