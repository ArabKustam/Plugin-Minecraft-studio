package dev.minecraftstudio.reactor.command;

import dev.minecraftstudio.reactor.config.Messages;
import dev.minecraftstudio.reactor.item.ReactorItems;
import dev.minecraftstudio.reactor.reactor.Reactor;
import dev.minecraftstudio.reactor.reactor.ReactorManager;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

/** {@code /reactor} (alias {@code /rx}). */
public final class ReactorCommand implements TabExecutor {

    /** Hooks into plugin level operations. */
    public interface PluginOps {
        void reload();

        /** Runs the self test, logs the result to the console and returns whether it passed. */
        boolean selfTest(CommandSender sender);
    }

    private static final String USE = "reactor.use";
    private static final String ADMIN = "reactor.admin";

    private static final Map<String, String> SUBCOMMANDS = Map.ofEntries(
            Map.entry("give", ADMIN), Map.entry("list", USE), Map.entry("status", USE),
            Map.entry("start", USE), Map.entry("stop", USE), Map.entry("scram", USE),
            Map.entry("power", USE), Map.entry("coolant", USE), Map.entry("heat", ADMIN),
            Map.entry("remove", ADMIN), Map.entry("selftest", ADMIN), Map.entry("reload", ADMIN));

    private static final Map<String, String> USAGE = Map.ofEntries(
            Map.entry("give", "/reactor give <core|panel> [player]"),
            Map.entry("status", "/reactor status <id>"),
            Map.entry("start", "/reactor start <id>"),
            Map.entry("stop", "/reactor stop <id>"),
            Map.entry("scram", "/reactor scram <id>"),
            Map.entry("power", "/reactor power <id> <25-100>"),
            Map.entry("coolant", "/reactor coolant <id> <on|off>"),
            Map.entry("heat", "/reactor heat <id> <0-100>"),
            Map.entry("remove", "/reactor remove <id>"));

    private final ReactorManager manager;
    private final ReactorActions actions;
    private final ReactorItems items;
    private final Supplier<Messages> messages;
    private final PluginOps ops;

    public ReactorCommand(ReactorManager manager, ReactorActions actions, ReactorItems items,
                          Supplier<Messages> messages, PluginOps ops) {
        this.manager = manager;
        this.actions = actions;
        this.items = items;
        this.messages = messages;
        this.ops = ops;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        Messages m = messages.get();
        String sub = args.length == 0 ? "help" : args[0].toLowerCase(Locale.ROOT);
        String permission = SUBCOMMANDS.get(sub);
        if (permission == null) {
            m.send(sender, "usage", "usage", "/" + label + " <" + String.join("|", sortedSubcommands()) + ">");
            return true;
        }
        if (!sender.hasPermission(permission)) {
            m.send(sender, "no-permission");
            return true;
        }
        switch (sub) {
            case "give" -> give(sender, args);
            case "list" -> list(sender);
            case "selftest" -> ops.selfTest(sender);
            case "reload" -> {
                ops.reload();
                messages.get().send(sender, "reloaded");
            }
            default -> withReactor(sender, sub, args);
        }
        return true;
    }

    private void withReactor(CommandSender sender, String sub, String[] args) {
        Messages m = messages.get();
        boolean needsValue = sub.equals("power") || sub.equals("heat") || sub.equals("coolant");
        if (args.length < (needsValue ? 3 : 2)) {
            m.send(sender, "usage", "usage", USAGE.get(sub));
            return;
        }
        Optional<Reactor> found = manager.get(args[1]);
        if (found.isEmpty()) {
            m.send(sender, "unknown-reactor", "id", args[1]);
            return;
        }
        Reactor reactor = found.get();
        switch (sub) {
            case "status" -> m.send(sender, "status", "id", reactor.id(), "state", reactor.state().name(),
                    "heat", String.valueOf((int) Math.round(reactor.heat())), "power", String.valueOf(reactor.power()),
                    "coolant", m.raw(reactor.coolant() ? "on" : "off"));
            case "start" -> actions.start(sender, reactor);
            case "stop" -> actions.stop(sender, reactor);
            case "scram" -> actions.scram(sender, reactor);
            case "remove" -> actions.remove(sender, reactor, false);
            case "coolant" -> {
                String value = args[2].toLowerCase(Locale.ROOT);
                if (!value.equals("on") && !value.equals("off")) {
                    m.send(sender, "usage", "usage", USAGE.get(sub));
                    return;
                }
                actions.coolant(sender, reactor, value.equals("on"));
            }
            case "power" -> parseInt(sender, args[2], 25, 100).ifPresent(p -> actions.power(sender, reactor, p));
            case "heat" -> parseInt(sender, args[2], 0, 100).ifPresent(h -> actions.heat(sender, reactor, h));
            default -> m.send(sender, "usage", "usage", USAGE.getOrDefault(sub, "/reactor"));
        }
    }

    private Optional<Integer> parseInt(CommandSender sender, String raw, int min, int max) {
        try {
            int value = Integer.parseInt(raw);
            if (value >= min && value <= max) {
                return Optional.of(value);
            }
        } catch (NumberFormatException ignored) {
            // reported below
        }
        messages.get().send(sender, "invalid-number", "value", raw);
        return Optional.empty();
    }

    private void give(CommandSender sender, String[] args) {
        Messages m = messages.get();
        Optional<ReactorItems.Kind> kind = args.length >= 2 ? ReactorItems.Kind.parse(args[1]) : Optional.empty();
        if (kind.isEmpty()) {
            m.send(sender, "usage", "usage", USAGE.get("give"));
            return;
        }
        Player target;
        if (args.length >= 3) {
            target = Bukkit.getPlayerExact(args[2]);
            if (target == null) {
                m.send(sender, "player-not-found", "name", args[2]);
                return;
            }
        } else if (sender instanceof Player player) {
            target = player;
        } else {
            m.send(sender, "player-only");
            return;
        }
        target.getInventory().addItem(items.create(kind.get()))
                .values().forEach(rest -> target.getWorld().dropItemNaturally(target.getLocation(), rest));
        m.send(sender, "given", "item", kind.get().id(), "name", target.getName());
    }

    private void list(CommandSender sender) {
        Messages m = messages.get();
        if (manager.all().isEmpty()) {
            m.send(sender, "list-empty");
            return;
        }
        m.send(sender, "list-header", "count", String.valueOf(manager.all().size()));
        for (Reactor r : manager.all()) {
            sender.sendMessage(m.get("list-entry", "id", r.id(), "state", r.state().name(),
                    "heat", String.valueOf((int) Math.round(r.heat())), "power", String.valueOf(r.power()),
                    "world", r.worldName(), "x", String.valueOf(r.x()), "y", String.valueOf(r.y()),
                    "z", String.valueOf(r.z())));
        }
    }

    private static List<String> sortedSubcommands() {
        return SUBCOMMANDS.keySet().stream().sorted().toList();
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        List<String> options = new ArrayList<>();
        if (args.length == 1) {
            for (String sub : sortedSubcommands()) {
                if (sender.hasPermission(SUBCOMMANDS.get(sub))) {
                    options.add(sub);
                }
            }
        } else {
            String sub = args[0].toLowerCase(Locale.ROOT);
            String permission = SUBCOMMANDS.get(sub);
            if (permission == null || !sender.hasPermission(permission)) {
                return List.of();
            }
            if (args.length == 2) {
                if (sub.equals("give")) {
                    for (ReactorItems.Kind kind : ReactorItems.Kind.values()) {
                        options.add(kind.id());
                    }
                } else if (USAGE.containsKey(sub)) {
                    manager.all().forEach(r -> options.add(r.id()));
                }
            } else if (args.length == 3) {
                switch (sub) {
                    case "give" -> Bukkit.getOnlinePlayers().forEach(p -> options.add(p.getName()));
                    case "power" -> options.addAll(List.of("25", "50", "75", "100"));
                    case "heat" -> options.addAll(List.of("0", "50", "75", "95", "100"));
                    case "coolant" -> options.addAll(List.of("on", "off"));
                    default -> {
                    }
                }
            }
        }
        String prefix = args[args.length - 1].toLowerCase(Locale.ROOT);
        return options.stream().filter(o -> o.toLowerCase(Locale.ROOT).startsWith(prefix)).toList();
    }
}
