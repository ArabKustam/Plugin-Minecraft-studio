package dev.minecraftstudio.reactor.config;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import net.kyori.adventure.text.minimessage.tag.resolver.TagResolver;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;

import java.util.ArrayList;
import java.util.List;

/** Localised MiniMessage templates from {@code config.yml} with English fallback. */
public final class Messages {

    private static final MiniMessage MINI = MiniMessage.miniMessage();

    private final ConfigurationSection selected;
    private final ConfigurationSection fallback;

    public Messages(ConfigurationSection root, String language) {
        ConfigurationSection messages = root.getConfigurationSection("messages");
        this.fallback = messages == null ? null : messages.getConfigurationSection("en");
        ConfigurationSection lang = messages == null ? null : messages.getConfigurationSection(language);
        this.selected = lang != null ? lang : fallback;
    }

    /** Raw template for {@code key}. */
    public String raw(String key) {
        String value = selected == null ? null : selected.getString(key);
        if (value == null && fallback != null) {
            value = fallback.getString(key);
        }
        return value == null ? key : value;
    }

    /**
     * Renders a message. {@code placeholders} are name/value pairs inserted as unparsed text.
     */
    public Component get(String key, String... placeholders) {
        return MINI.deserialize(raw(key), resolver(placeholders))
                .decorationIfAbsent(TextDecoration.ITALIC, TextDecoration.State.FALSE);
    }

    public void send(CommandSender sender, String key, String... placeholders) {
        sender.sendMessage(get("prefix").append(get(key, placeholders)));
    }

    private static TagResolver resolver(String... placeholders) {
        if (placeholders.length % 2 != 0) {
            throw new IllegalArgumentException("placeholders must be name/value pairs");
        }
        List<TagResolver> resolvers = new ArrayList<>();
        for (int i = 0; i < placeholders.length; i += 2) {
            resolvers.add(Placeholder.unparsed(placeholders[i], String.valueOf(placeholders[i + 1])));
        }
        return TagResolver.resolver(resolvers);
    }
}
