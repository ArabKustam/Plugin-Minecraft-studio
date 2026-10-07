package dev.minecraftstudio.reactor.timeline;

/** Executes cues for a timeline owner (a reactor id). Called on the main thread. */
@FunctionalInterface
public interface CueHandler {

    /**
     * @param ownerId the reactor the timeline runs for
     * @param cue     the cue to execute; {@link Cue.Particles} cues are repeated by the player while active
     */
    void handle(String ownerId, Cue cue);
}
