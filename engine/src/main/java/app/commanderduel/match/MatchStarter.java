package app.commanderduel.match;

import app.commanderduel.forge.BridgeGuiGame;
import forge.deck.Deck;
import forge.game.GameType;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.gui.GuiBase;
import forge.player.GamePlayerUtil;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;

/** Starts a Commander game: the human (seat 0, driven through the bridge GUI) against Forge AI bots. */
public final class MatchStarter {
    /** A bot seat. {@code name} may be null, which names the bot "&lt;commander name&gt; Bot". */
    public record BotSpec(Deck deck, Difficulty difficulty, String name) {}

    private MatchStarter() {}

    public static HostedMatch start(Deck you, List<BotSpec> bots, BridgeGuiGame gui) {
        List<RegisteredPlayer> players = new ArrayList<>();
        RegisteredPlayer human = RegisteredPlayer.forCommander(you).setPlayer(GamePlayerUtil.getGuiPlayer());
        human.setTeamNumber(0);
        players.add(human);
        int team = 1;
        for (BotSpec bot : bots) {
            RegisteredPlayer rp = RegisteredPlayer.forCommander(bot.deck()).setPlayer(GamePlayerUtil.createAiPlayer(
                    botName(bot), 0, 0, bot.difficulty().options(), bot.difficulty().profile()));
            rp.setTeamNumber(team++);
            players.add(rp);
        }
        HostedMatch match = GuiBase.getInterface().hostMatch();
        match.startMatch(GameType.Commander, EnumSet.of(GameType.Commander), players, human, gui);
        return match;
    }

    private static String botName(BotSpec bot) {
        if (bot.name() != null && !bot.name().isBlank()) {
            return bot.name();
        }
        return bot.deck().getCommanders().get(0).getName() + " Bot";
    }
}
