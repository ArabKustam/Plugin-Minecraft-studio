package dev.minecraftstudio.reactor.util;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;

/** Lenient accessors for Gson trees: missing or mistyped values fall back to defaults. */
public final class Json {

    private Json() {
    }

    public static boolean has(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e != null && !e.isJsonNull();
    }

    public static String string(JsonObject o, String key, String def) {
        JsonElement e = o.get(key);
        return e instanceof JsonPrimitive p ? p.getAsString() : def;
    }

    public static double number(JsonObject o, String key, double def) {
        JsonElement e = o.get(key);
        if (e instanceof JsonPrimitive p && p.isNumber()) {
            return p.getAsDouble();
        }
        if (e instanceof JsonPrimitive p && p.isString()) {
            try {
                return Double.parseDouble(p.getAsString().trim());
            } catch (NumberFormatException ignored) {
                return def;
            }
        }
        return def;
    }

    public static int integer(JsonObject o, String key, int def) {
        double d = number(o, key, Double.NaN);
        return Double.isNaN(d) ? def : (int) Math.round(d);
    }

    public static boolean bool(JsonObject o, String key, boolean def) {
        JsonElement e = o.get(key);
        return e instanceof JsonPrimitive p && p.isBoolean() ? p.getAsBoolean() : def;
    }

    public static JsonObject object(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e instanceof JsonObject obj ? obj : null;
    }

    public static JsonArray array(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e instanceof JsonArray arr ? arr : new JsonArray();
    }
}
