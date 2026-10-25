package app.commanderduel.forge;

import forge.ai.AIOption;
import forge.ai.LobbyPlayerAi;
import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.player.PlayerController;
import java.util.Set;

/** A Forge AI lobby player whose in-game controllers are {@link SafePlayerControllerAi}. */
public class SafeLobbyPlayerAi extends LobbyPlayerAi {
    private final AIOption option;

    public SafeLobbyPlayerAi(String name, Set<AIOption> options, String profile) {
        super(name, options);
        option = options == null || options.isEmpty() ? null : options.iterator().next();
        setAiProfile(profile);
    }

    private PlayerControllerAi controllerFor(Player ai) {
        PlayerControllerAi c = new SafePlayerControllerAi(ai.getGame(), ai, this);
        c.getAi().setUseSimulation(option);
        return c;
    }

    @Override
    public PlayerController createMindSlaveController(Player master, Player slave) {
        return controllerFor(slave);
    }

    @Override
    public Player createIngamePlayer(Game game, int id) {
        Player ai = new Player(getName(), game, id);
        ai.setFirstController(controllerFor(ai));
        return ai;
    }
}
