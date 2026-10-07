package dev.minecraftstudio.reactor.command;

import dev.minecraftstudio.reactor.config.Messages;
import dev.minecraftstudio.reactor.gui.ControlPanelGui;
import dev.minecraftstudio.reactor.reactor.Reactor;
import dev.minecraftstudio.reactor.reactor.ReactorManager;
import dev.minecraftstudio.reactor.reactor.ReactorManager.ActionResult;
import org.bukkit.command.CommandSender;

import java.util.function.Supplier;

/** User facing reactor actions shared by the command and the control panel GUI. */
public final class ReactorActions {

    private final ReactorManager manager;
    private final ControlPanelGui gui;
    private final Supplier<Messages> messages;

    public ReactorActions(ReactorManager manager, ControlPanelGui gui, Supplier<Messages> messages) {
        this.manager = manager;
        this.gui = gui;
        this.messages = messages;
    }

    public void start(CommandSender sender, Reactor reactor) {
        report(sender, reactor, manager.start(reactor), "started");
    }

    public void stop(CommandSender sender, Reactor reactor) {
        report(sender, reactor, manager.stop(reactor), "stopped");
    }

    public void scram(CommandSender sender, Reactor reactor) {
        report(sender, reactor, manager.scram(reactor), "scrammed");
    }

    public void power(CommandSender sender, Reactor reactor, int power) {
        manager.setPower(reactor, power);
        messages.get().send(sender, "power-set", "id", reactor.id(), "power", String.valueOf(reactor.power()));
        gui.refreshOpen(reactor);
    }

    public void coolant(CommandSender sender, Reactor reactor, boolean on) {
        manager.setCoolant(reactor, on);
        Messages m = messages.get();
        m.send(sender, "coolant-set", "id", reactor.id(), "coolant", m.raw(on ? "on" : "off"));
        gui.refreshOpen(reactor);
    }

    public void heat(CommandSender sender, Reactor reactor, double heat) {
        manager.setHeat(reactor, heat);
        messages.get().send(sender, "heat-set", "id", reactor.id(),
                "heat", String.valueOf((int) Math.round(reactor.heat())));
        gui.refreshOpen(reactor);
    }

    public void remove(CommandSender sender, Reactor reactor, boolean dropItem) {
        gui.closeFor(reactor.id());
        manager.remove(reactor, dropItem);
        messages.get().send(sender, "removed", "id", reactor.id());
    }

    private void report(CommandSender sender, Reactor reactor, ActionResult result, String okKey) {
        Messages m = messages.get();
        switch (result) {
            case OK -> m.send(sender, okKey, "id", reactor.id());
            case RESET -> m.send(sender, "reset", "id", reactor.id());
            case TOO_HOT -> m.send(sender, "too-hot", "id", reactor.id(),
                    "heat", String.valueOf((int) Math.round(reactor.heat())));
            case NOT_ALLOWED -> m.send(sender, "not-allowed", "id", reactor.id(), "state", reactor.state().name());
        }
        gui.refreshOpen(reactor);
    }
}
