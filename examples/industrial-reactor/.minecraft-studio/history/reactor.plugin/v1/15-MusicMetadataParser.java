package dev.minecraftstudio.reactor.music;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import dev.minecraftstudio.reactor.util.Json;

import java.util.ArrayList;
import java.util.List;

/** Parses music metadata JSON. Unknown fields are ignored. */
public final class MusicMetadataParser {

    private MusicMetadataParser() {
    }

    public static MusicMetadata parse(String json) {
        JsonObject root;
        try {
            JsonElement element = JsonParser.parseString(json);
            if (!element.isJsonObject()) {
                throw new IllegalArgumentException("music metadata must be a JSON object");
            }
            root = element.getAsJsonObject();
        } catch (JsonParseException e) {
            throw new IllegalArgumentException("invalid JSON: " + e.getMessage(), e);
        }

        String title = Json.string(root, "title", "untitled");
        MusicState state = MusicState.parse(Json.string(root, "state", null))
                .filter(s -> s != MusicState.NONE)
                .orElseThrow(() -> new IllegalArgumentException("'state' must be calm or alarm"));
        double bpm = Json.number(root, "bpm", 0);
        if (!(bpm > 0)) {
            throw new IllegalArgumentException("'bpm' must be positive");
        }
        JsonArray meter = Json.array(root, "meter");
        int beatsPerBar = meter.size() > 0 && meter.get(0).isJsonPrimitive() ? meter.get(0).getAsInt() : 4;
        if (beatsPerBar <= 0) {
            throw new IllegalArgumentException("meter numerator must be positive");
        }
        double beatSeconds = Json.number(root, "beat_seconds", 60.0 / bpm);
        double barSeconds = Json.number(root, "bar_seconds", beatSeconds * beatsPerBar);

        double introSeconds = 0;
        double outroSeconds = 0;
        double loopSectionSeconds = 0;
        String loopSection = null;
        JsonObject loop = Json.object(root, "loop");
        if (loop != null) {
            loopSection = Json.string(loop, "section", null);
        }
        for (JsonElement e : Json.array(root, "sections")) {
            if (!(e instanceof JsonObject section)) {
                continue;
            }
            String name = Json.string(section, "name", "");
            boolean isLoop = Json.bool(section, "loop", false) || name.equals(loopSection);
            double duration = Json.number(section, "duration_s",
                    Json.number(section, "end_s", 0) - Json.number(section, "start_s", 0));
            if (isLoop) {
                loopSectionSeconds = duration;
            } else if (name.equals("intro")) {
                introSeconds = duration;
            } else if (name.equals("outro")) {
                outroSeconds = duration;
            }
        }

        double loopSeconds = loop != null ? Json.number(loop, "duration_s", loopSectionSeconds) : loopSectionSeconds;
        if (!(loopSeconds > 0)) {
            throw new IllegalArgumentException("loop duration must be positive");
        }
        int loopBars = loop != null ? Json.integer(loop, "bars", 0) : 0;
        if (loopBars <= 0) {
            loopBars = (int) Math.max(1, Math.round(loopSeconds / barSeconds));
        }
        int every = Math.max(1, Json.integer(root, "transition_every_bars", 1));

        List<Double> points = new ArrayList<>();
        for (JsonElement e : Json.array(root, "transition_points_s")) {
            if (e.isJsonPrimitive() && e.getAsJsonPrimitive().isNumber()) {
                points.add(e.getAsDouble());
            }
        }
        return new MusicMetadata(title, state, bpm, beatsPerBar, beatSeconds, barSeconds,
                Math.max(0, introSeconds), Math.max(0, outroSeconds), loopSeconds, loopBars, every, points);
    }
}
