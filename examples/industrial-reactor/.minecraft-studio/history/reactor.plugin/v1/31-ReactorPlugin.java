package dev.minecraftstudio.reactor;

import dev.minecraftstudio.reactor.command.ReactorActions;
import dev.minecraftstudio.reactor.command.ReactorCommand;
import dev.minecraftstudio.reactor.config.Messages;
import dev.minecraftstudio.reactor.config.ReactorConfig;
import dev.minecraftstudio.reactor.gui.ControlPanelGui;
import dev.minecraftstudio.reactor.gui.ControlPanelListener;
import dev.minecraftstudio.reactor.item.ReactorItems;
import dev.minecraftstudio.reactor.listener.PlayerSessionListener;
import dev.minecraftstudio.reactor.listener.ReactorBlockListener;
import dev.minecraftstudio.reactor.listener.ReactorEntityListener;
import dev.minecraftstudio.reactor.music.MusicDirector;
import dev.minecraftstudio.reactor.music.MusicLibrary;
import dev.minecraftstudio.reactor.reactor.Reactor;
import dev.minecraftstudio.reactor.reactor.ReactorBossBars;
import dev.minecraftstudio.reactor.reactor.ReactorManager;
import dev.minecraftstudio.reactor.selftest.SelfTest;
import dev.minecraftstudio.reactor.storage.ReactorStorage;
import dev.minecraftstudio.reactor.timeline.TimelineLibrary;
import dev.minecraftstudio.reactor.util.ResourceSource;
import org.bukkit.Chunk;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.util.Arrays;

/** Industrial Reactor: Minecraft Studio demo plugin. Wires all components together. */
public final class ReactorPlugin extends JavaPlugin implements ReactorCommand.PluginOps {

    private ReactorConfig settings;
    private Messages messages;
    private TimelineLibrary timelines;
    private MusicLibrary music;
    private ResourceSource resources;

    private ReactorStorage storage;
    private ReactorManager manager;
    private MusicDirector musicDirector;
    private ControlPanelGui gui;
    private BukkitTask ticker;
    private BukkitTask autosave;
    private long tick;
    private long saveGeneration;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        resources = ResourceSource.withOverrides(getDataFolder().toPath(), ResourceSource.classpath(getClassLoader()));
        loadSettings();

        storage = new ReactorStorage(getDataFolder().toPath().resolve("reactors.yml"), getLogger());
        ReactorItems items = new ReactorItems(() -> messages);
        ReactorBossBars bossBars = new ReactorBossBars(() -> settings, () -> messages);
        manager = new ReactorManager(() -> settings, () -> timelines, items, bossBars, getLogger(), this::saveAsync);
        manager.restore(storage.load());
        musicDirector = new MusicDirector(() -> settings, () -> music, manager);
        gui = new ControlPanelGui(() -> messages);
        ReactorActions actions = new ReactorActions(manager, gui, () -> messages);

        var pm = getServer().getPluginManager();
        pm.registerEvents(new ReactorBlockListener(this, manager, () -> messages), this);
        pm.registerEvents(new ReactorEntityListener(manager, actions, gui, () -> settings, () -> messages), this);
        pm.registerEvents(new ControlPanelListener(manager, actions), this);
        pm.registerEvents(new PlayerSessionListener(musicDirector, bossBars), this);

        ReactorCommand command = new ReactorCommand(manager, actions, items, () -> messages, this);
        PluginCommand reactorCommand = getCommand("reactor");
        if (reactorCommand != null) {
            reactorCommand.setExecutor(command);
            reactorCommand.setTabCompleter(command);
        }

        relinkLoadedChunks();
        ticker = getServer().getScheduler().runTaskTimer(this, this::tick, 1L, 1L);
        long autosaveTicks = settings.autosaveMinutes() * 60L * 20L;
        autosave = getServer().getScheduler().runTaskTimer(this, this::saveAsync, autosaveTicks, autosaveTicks);
        getLogger().info("Loaded " + manager.all().size() + " reactor(s), " + timelines.size() + " timeline(s)");
    }

    @Override
    public void onDisable() {
        if (ticker != null) {
            ticker.cancel();
        }
        if (autosave != null) {
            autosave.cancel();
        }
        getServer().getScheduler().cancelTasks(this);
        if (musicDirector != null) {
            musicDirector.stopAll();
        }
        if (manager != null) {
            manager.shutdownAll();
            storage.save(manager.snapshot(), ++saveGeneration);
        }
    }

    private void loadSettings() {
        settings = ReactorConfig.from(getConfig(), getLogger());
        messages = new Messages(getConfig(), settings.language());
        timelines = TimelineLibrary.load(resources, getLogger());
        music = MusicLibrary.load(resources, getLogger());
    }

    private void tick() {
        tick++;
        manager.tick(tick);
        musicDirector.tick(tick);
        if (tick % 10 == 0) {
            gui.refreshAll(manager::get);
        }
    }

    /** Re-links entities of reactors whose chunks were already loaded before the plugin enabled. */
    private void relinkLoadedChunks() {
        for (Reactor reactor : manager.all()) {
            World world = reactor.world();
            if (world == null || !world.isChunkLoaded(reactor.x() >> 4, reactor.z() >> 4)) {
                continue;
            }
            Chunk chunk = world.getChunkAt(reactor.x() >> 4, reactor.z() >> 4);
            if (chunk.isEntitiesLoaded()) {
                manager.onEntitiesLoaded(world, chunk.getX(), chunk.getZ(), Arrays.asList(chunk.getEntities()));
            }
        }
    }

    /** Snapshot on the main thread, write on an async thread. */
    private void saveAsync() {
        if (!isEnabled()) {
            return;
        }
        ReactorStorage.Snapshot snapshot = manager.snapshot();
        long generation = ++saveGeneration;
        getServer().getScheduler().runTaskAsynchronously(this, () -> storage.save(snapshot, generation));
    }

    @Override
    public void reload() {
        reloadConfig();
        loadSettings();
        if (autosave != null) {
            autosave.cancel();
        }
        long autosaveTicks = settings.autosaveMinutes() * 60L * 20L;
        autosave = getServer().getScheduler().runTaskTimer(this, this::saveAsync, autosaveTicks, autosaveTicks);
    }

    @Override
    public boolean selfTest(CommandSender sender) {
        SelfTest.Result result = new SelfTest(resources, settings.musicSoundPrefix()).run();
        result.notes().forEach(note -> getLogger().info("selftest: " + note));
        if (result.passed()) {
            getLogger().info(result.summary());
            if (!(sender instanceof ConsoleCommandSender)) {
                messages.send(sender, "selftest-passed");
            }
        } else {
            getLogger().severe(result.summary());
            if (!(sender instanceof ConsoleCommandSender)) {
                messages.send(sender, "selftest-failed", "reason", String.join("; ", result.failures()));
            }
        }
        return result.passed();
    }
}
