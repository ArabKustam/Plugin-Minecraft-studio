package dev.minecraftstudio.reactor.state;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The reactor transition table. Immutable and side-effect free.
 */
public final class StateTransitions {

    private static final Map<ReactorState, Set<ReactorState>> TABLE = buildTable();

    private StateTransitions() {
    }

    private static Map<ReactorState, Set<ReactorState>> buildTable() {
        Map<ReactorState, Set<ReactorState>> t = new EnumMap<>(ReactorState.class);
        t.put(ReactorState.OFF, EnumSet.of(ReactorState.STARTING));
        t.put(ReactorState.STARTING, EnumSet.of(ReactorState.RUNNING, ReactorState.SHUTTING_DOWN));
        t.put(ReactorState.RUNNING, EnumSet.of(ReactorState.WARNING, ReactorState.CRITICAL,
                ReactorState.FAILED, ReactorState.SHUTTING_DOWN));
        t.put(ReactorState.WARNING, EnumSet.of(ReactorState.RUNNING, ReactorState.CRITICAL,
                ReactorState.FAILED, ReactorState.SHUTTING_DOWN));
        t.put(ReactorState.CRITICAL, EnumSet.of(ReactorState.RUNNING, ReactorState.WARNING,
                ReactorState.FAILED, ReactorState.SHUTTING_DOWN));
        // A failed core can only be reset (stop command) once it is safe.
        t.put(ReactorState.FAILED, EnumSet.of(ReactorState.OFF));
        t.put(ReactorState.SHUTTING_DOWN, EnumSet.of(ReactorState.OFF));
        Map<ReactorState, Set<ReactorState>> frozen = new EnumMap<>(ReactorState.class);
        t.forEach((k, v) -> frozen.put(k, Collections.unmodifiableSet(v)));
        return Collections.unmodifiableMap(frozen);
    }

    public static boolean isAllowed(ReactorState from, ReactorState to) {
        return from != null && to != null && TABLE.getOrDefault(from, Set.of()).contains(to);
    }

    public static Set<ReactorState> targets(ReactorState from) {
        return TABLE.getOrDefault(from, Set.of());
    }

    /**
     * Checks structural consistency of the table: every state has an entry, there are no
     * self-loops, every state is reachable from OFF, OFF is reachable from every state and
     * every active state can be shut down.
     *
     * @return list of problems, empty when consistent
     */
    public static List<String> validate() {
        List<String> problems = new ArrayList<>();
        for (ReactorState s : ReactorState.values()) {
            if (!TABLE.containsKey(s)) {
                problems.add("no transitions defined for " + s);
            } else if (TABLE.get(s).contains(s)) {
                problems.add("self transition on " + s);
            }
            if (s.isActive() && !isAllowed(s, ReactorState.SHUTTING_DOWN)) {
                problems.add("active state " + s + " cannot shut down");
            }
            if (!reachable(s).contains(ReactorState.OFF) && s != ReactorState.OFF) {
                problems.add("OFF unreachable from " + s);
            }
        }
        Set<ReactorState> fromOff = reachable(ReactorState.OFF);
        for (ReactorState s : ReactorState.values()) {
            if (!fromOff.contains(s)) {
                problems.add(s + " unreachable from OFF");
            }
        }
        return problems;
    }

    private static Set<ReactorState> reachable(ReactorState start) {
        Set<ReactorState> seen = EnumSet.of(start);
        Deque<ReactorState> queue = new ArrayDeque<>();
        queue.add(start);
        while (!queue.isEmpty()) {
            for (ReactorState next : targets(queue.poll())) {
                if (seen.add(next)) {
                    queue.add(next);
                }
            }
        }
        return seen;
    }
}
