package dev.minecraftstudio.reactor.timeline;

import java.util.List;

/**
 * A compiled Minecraft Studio timeline.
 *
 * @param id            timeline id (file name without extension)
 * @param title         human readable title
 * @param trigger       trigger name declared by the studio (informational)
 * @param durationTicks total length; never shorter than the last cue
 * @param cues          cues sorted by tick (stable for equal ticks)
 * @param warnings      non fatal problems found while parsing (unknown tracks, bad values)
 */
public record Timeline(String id, String title, String trigger, int durationTicks, List<Cue> cues,
                       List<String> warnings) {

    public Timeline {
        cues = List.copyOf(cues);
        warnings = List.copyOf(warnings);
    }

    public boolean hasCue(Class<? extends Cue> type) {
        return cues.stream().anyMatch(type::isInstance);
    }
}
