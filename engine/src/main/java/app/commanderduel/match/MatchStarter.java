package app.commanderduel.match;

import app.commanderduel.forge.BridgeGuiGame;
import app.commanderduel.forge.SafeLobbyPlayerAi;
import forge.deck.Deck;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.gui.GuiBase;
import forge.localinstance.properties.ForgePreferences;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
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
            // Forge's AI behind a safety net: a bot that errors while deciding makes a safe choice instead of freezing the game.
            RegisteredPlayer rp = RegisteredPlayer.forCommander(bot.deck()).setPlayer(
                    new SafeLobbyPlayerAi(botName(bot), bot.difficulty().options(), bot.difficulty().profile()));
            rp.setTeamNumber(team++);
            players.add(rp);
        }
        HostedMatch match = GuiBase.getInterface().hostMatch();
        match.startMatch(rules(), EnumSet.of(GameType.Commander), players, human, gui);
        return match;
    }

    /** HostedMatch's (private) default Commander rules, minus the "AI can't play these cards well" reveal. */
    private static GameRules rules() {
        ForgePreferences prefs = FModel.getPreferences();
        GameRules rules = new GameRules(GameType.Commander);
        rules.setPlayForAnte(prefs.getPrefBoolean(FPref.UI_ANTE));
        rules.setMatchAnteRarity(prefs.getPrefBoolean(FPref.UI_ANTE_MATCH_RARITY));
        rules.setAnteIncludeBasicLands(prefs.getPrefBoolean(FPref.UI_ANTE_INCLUDE_BASIC_LANDS));
        rules.setManaBurn(prefs.getPrefBoolean(FPref.LEGACY_MANABURN));
        rules.setOrderCombatants(prefs.getPrefBoolean(FPref.LEGACY_ORDER_COMBATANTS));
        rules.setUseGrayText(prefs.getPrefBoolean(FPref.UI_GRAY_INACTIVE_TEXT));
        rules.setGamesPerMatch(prefs.getPrefInt(FPref.UI_MATCHES_PER_GAME));
        rules.setAllowCheatShuffle(prefs.getPrefBoolean(FPref.UI_ENABLE_AI_CHEATS));
        rules.setWarnAboutAICards(false);
        return rules;
    }

    private static String botName(BotSpec bot) {
        if (bot.name() != null && !bot.name().isBlank()) {
            return bot.name();
        }
        return bot.deck().getCommanders().get(0).getName() + " Bot";
    }
}
