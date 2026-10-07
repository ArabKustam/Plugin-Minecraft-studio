package dev.minecraftstudio.reactor.timeline;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import dev.minecraftstudio.reactor.music.MusicState;
import dev.minecraftstudio.reactor.music.Quantize;
import dev.minecraftstudio.reactor.reactor.RotorAnimation;
import dev.minecraftstudio.reactor.state.CoreTexture;
import dev.minecraftstudio.reactor.state.ReactorState;
import dev.minecraftstudio.reactor.util.Json;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Parses compiled timeline JSON. Unknown fields are ignored; cues on unknown tracks or with
 * unusable values are skipped and reported as warnings.
 */
public final class TimelineParser {

    public static final int DEFAULT_LOOP_TICKS = 80;

    private TimelineParser() {
    }

    public static Timeline parse(String json) throws TimelineParseException {
        JsonObject root;
        try {
            JsonElement element = JsonParser.parseString(json);
            if (!element.isJsonObject()) {
                throw new TimelineParseException("timeline must be a JSON object");
            }
            root = element.getAsJsonObject();
        } catch (JsonParseException e) {
            throw new TimelineParseException("invalid JSON: " + e.getMessage(), e);
        }

        String id = Json.string(root, "id", null);
        if (id == null || id.isBlank()) {
            throw new TimelineParseException("timeline has no 'id'");
        }
        List<String> warnings = new ArrayList<>();
        List<Cue> cues = new ArrayList<>();
        JsonArray rawCues = Json.array(root, "cues");
        for (int i = 0; i < rawCues.size(); i++) {
            if (!(rawCues.get(i) instanceof JsonObject cueObject)) {
                warnings.add("cue #" + i + " is not an object");
                continue;
            }
            try {
                Optional<Cue> cue = parseCue(cueObject);
                if (cue.isPresent()) {
                    cues.add(cue.get());
                } else {
                    warnings.add("cue #" + i + " has unknown track '" + Json.string(cueObject, "track", "?") + "'");
                }
            } catch (IllegalArgumentException e) {
                warnings.add("cue #" + i + ": " + e.getMessage());
            }
        }
        cues.sort(Comparator.comparingInt(Cue::tick));

        int lastTick = cues.isEmpty() ? 0 : cues.get(cues.size() - 1).tick();
        int duration;
        if (Json.has(root, "duration_ticks")) {
            duration = Json.integer(root, "duration_ticks", 0);
        } else {
            duration = (int) Math.round(Json.number(root, "duration", 0) * 20);
        }
        duration = Math.max(duration, lastTick);
        return new Timeline(id, Json.string(root, "title", id), Json.string(root, "trigger", ""),
                duration, cues, warnings);
    }

    static Optional<Cue> parseCue(JsonObject o) {
        int tick = tickOf(o);
        String track = Json.string(o, "track", "").toLowerCase(Locale.ROOT);
        Cue cue = switch (track) {
            case "event" -> new Cue.Event(tick, Json.string(o, "id", Json.string(o, "event", "")));
            case "sfx" -> sfx(o, tick);
            case "animation" -> animation(o, tick);
            case "texture" -> new Cue.Texture(tick, CoreTexture.parse(Json.string(o, "state", null))
                    .orElseThrow(() -> new IllegalArgumentException(
                            "unknown texture state '" + Json.string(o, "state", "") + "'")));
            case "particles" -> particles(o, tick);
            case "music" -> music(o, tick);
            case "voice" -> new Cue.Voice(tick, Json.string(o, "line", ""), required(o, "sound"),
                    nonNegative(Json.number(o, "duration", 0)));
            case "ui" -> new Cue.Ui(tick, Json.string(o, "bossbar", Json.string(o, "title", "")),
                    (float) clamp(Json.number(o, "progress", 1.0), 0, 1), Json.string(o, "color", null));
            case "lighting" -> new Cue.Lighting(tick, (int) clamp(Json.integer(o, "level", 0), 0, 15));
            case "state" -> new Cue.State(tick, ReactorState.parse(Json.string(o, "state", null))
                    .orElseThrow(() -> new IllegalArgumentException(
                            "unknown state '" + Json.string(o, "state", "") + "'")));
            default -> null;
        };
        return Optional.ofNullable(cue);
    }

    private static int tickOf(JsonObject o) {
        int tick;
        if (Json.has(o, "tick")) {
            tick = Json.integer(o, "tick", 0);
        } else if (Json.has(o, "t")) {
            tick = (int) Math.round(Json.number(o, "t", 0) * 20);
        } else {
            throw new IllegalArgumentException("cue has neither 'tick' nor 't'");
        }
        if (tick < 0) {
            throw new IllegalArgumentException("negative tick " + tick);
        }
        return tick;
    }

    private static Cue.Animation animation(JsonObject o, int tick) {
        String name = Json.string(o, "animation", "");
        RotorAnimation animation = RotorAnimation.parse(name)
                .orElseThrow(() -> new IllegalArgumentException("unknown animation '" + name + "'"));
        return new Cue.Animation(tick, animation, Json.string(o, "target", "rotor"),
                nonNegative(Json.number(o, "duration", 0)));
    }

    private static Cue.Sfx sfx(JsonObject o, int tick) {
        String action = Json.string(o, "action", "play").toLowerCase(Locale.ROOT);
        boolean stop = Json.bool(o, "stop", false) || action.equals("stop");
        int loopTicks = Json.integer(o, "loop_ticks", DEFAULT_LOOP_TICKS);
        return new Cue.Sfx(tick, required(o, "sound"),
                (float) nonNegative(Json.number(o, "volume", 1.0)),
                (float) clamp(Json.number(o, "pitch", 1.0), 0.5, 2.0),
                Json.bool(o, "loop", false), Math.max(1, loopTicks), stop);
    }

    private static Cue.Particles particles(JsonObject o, int tick) {
        JsonArray spread = Json.array(o, "spread");
        double[] s = {0, 0, 0};
        for (int i = 0; i < 3 && i < spread.size(); i++) {
            JsonElement e = spread.get(i);
            if (e.isJsonPrimitive() && e.getAsJsonPrimitive().isNumber()) {
                s[i] = e.getAsDouble();
            }
        }
        return new Cue.Particles(tick, required(o, "particle"),
                Math.max(0, Json.integer(o, "count", 1)), s[0], s[1], s[2],
                nonNegative(Json.number(o, "duration", 0)));
    }

    private static Cue.Music music(JsonObject o, int tick) {
        String action = Json.string(o, "action", "transition").toLowerCase(Locale.ROOT);
        Quantize quantize = Quantize.parse(Json.string(o, "quantize", "bar")).orElse(Quantize.BAR);
        MusicState state = switch (action) {
            case "stop" -> MusicState.NONE;
            case "transition" -> {
                String name = Json.string(o, "state", "none");
                yield MusicState.parse(name)
                        .orElseThrow(() -> new IllegalArgumentException("unknown music state '" + name + "'"));
            }
            default -> throw new IllegalArgumentException("unknown music action '" + action + "'");
        };
        return new Cue.Music(tick, state, quantize);
    }

    private static String required(JsonObject o, String key) {
        String value = Json.string(o, key, null);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("missing '" + key + "'");
        }
        return value;
    }

    private static double nonNegative(double v) {
        return Double.isNaN(v) ? 0 : Math.max(0, v);
    }

    private static double clamp(double v, double min, double max) {
        return Double.isNaN(v) ? min : Math.max(min, Math.min(max, v));
    }
}
