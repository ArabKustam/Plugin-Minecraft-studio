package dev.minecraftstudio.reactor.timeline;

/** Thrown when a timeline file cannot be used at all. */
public class TimelineParseException extends Exception {

    private static final long serialVersionUID = 1L;

    public TimelineParseException(String message) {
        super(message);
    }

    public TimelineParseException(String message, Throwable cause) {
        super(message, cause);
    }
}
