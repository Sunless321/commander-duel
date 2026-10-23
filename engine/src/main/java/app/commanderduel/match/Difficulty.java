package app.commanderduel.match;

import forge.ai.AIOption;
import java.util.EnumSet;
import java.util.Set;

/** Bot strength: a Forge AI profile plus AI options. */
public enum Difficulty {
    EASY("Cautious", EnumSet.noneOf(AIOption.class)),
    NORMAL("Default", EnumSet.noneOf(AIOption.class)),
    HARD("Default", EnumSet.of(AIOption.USE_HYBRID_SIMULATION));

    private final String profile;
    private final Set<AIOption> options;

    Difficulty(String profile, EnumSet<AIOption> options) {
        this.profile = profile;
        this.options = options;
    }

    /** Name of the AI profile in forge-gui/res/ai. */
    public String profile() {
        return profile;
    }

    /** A fresh, mutable copy (Forge's LobbyPlayerAi keeps the set it is given). */
    public Set<AIOption> options() {
        return options.isEmpty() ? EnumSet.noneOf(AIOption.class) : EnumSet.copyOf(options);
    }
}
