package app.commanderduel.protocol;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import app.commanderduel.forge.ForgeBootstrap;
import app.commanderduel.protocol.Dto.CardDto;
import app.commanderduel.protocol.Dto.GameState;
import app.commanderduel.protocol.Dto.PlayerDto;
import forge.StaticData;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class StateMapperTest {
    private Game game;
    private Player me;
    private Player opp;

    @BeforeAll
    static void boot() throws IOException {
        ForgeBootstrap.init(Path.of("../forge/forge-gui"), Files.createTempDirectory("cd"));
    }

    @BeforeEach
    void newGame() {
        List<Deck> precons = new ArrayList<>();
        FModel.getDecks().getCommanderPrecons().forEach(precons::add);
        List<RegisteredPlayer> rps = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            RegisteredPlayer rp = RegisteredPlayer.forCommander(precons.get(i));
            rp.setPlayer(GamePlayerUtil.createAiPlayer("AI" + i));
            rp.setTeamNumber(i);
            rps.add(rp);
        }
        GameRules rules = new GameRules(GameType.Commander);
        rules.setAppliedVariants(EnumSet.of(GameType.Commander));
        game = new Match(rules, rps, "t").createGame();
        for (int i = 0; i < 2; i++) {
            Player p = game.getPlayers().get(i);
            List<Card> lib = new ArrayList<>();
            for (var e : rps.get(i).getDeck().getMain()) {
                for (int n = 0; n < e.getValue(); n++) {
                    lib.add(Card.fromPaperCard(e.getKey(), p));
                }
            }
            p.getZone(ZoneType.Library).setCards(lib);
            p.initVariantsZones(rps.get(i));
            for (int n = 0; n < 7; n++) {
                game.getAction().moveToHand(p.getZone(ZoneType.Library).get(0), null);
            }
        }
        me = game.getPlayers().get(0);
        opp = game.getPlayers().get(1);
    }

    private GameState map() {
        return StateMapper.map(game.getView(), me.getView());
    }

    private PlayerDto dto(GameState s, boolean you) {
        return s.players().stream().filter(p -> p.you() == you).findFirst().orElseThrow();
    }

    private Card place(Player owner, String name, ZoneType zone) {
        PaperCard pc = StaticData.instance().getCommonCards().getCard(name);
        Card c = Card.fromPaperCard(pc, owner);
        owner.getZone(ZoneType.Library).add(c);
        return zone == ZoneType.Battlefield
                ? game.getAction().moveToPlay(c, null, null)
                : game.getAction().moveTo(zone, c, null, null);
    }

    @Test
    void opponentHandIsCountOnly() {
        GameState s = map();
        PlayerDto o = dto(s, false);
        assertTrue(o.hand().isEmpty());
        assertEquals(7, o.handCount());
        for (Card c : opp.getCardsIn(ZoneType.Hand)) {
            assertFalse(s.cards().containsKey("c" + c.getId()));
        }
    }

    @Test
    void viewerHandIsListed() {
        GameState s = map();
        PlayerDto m = dto(s, true);
        assertEquals(7, m.hand().size());
        for (String id : m.hand()) {
            assertNotNull(s.cards().get(id).name());
        }
    }

    @Test
    void libraryIsCountOnly() {
        GameState s = map();
        assertEquals(99 - 7, dto(s, true).libraryCount());
        assertEquals(99 - 7, dto(s, false).libraryCount());
        for (Player p : game.getPlayers()) {
            for (Card c : p.getCardsIn(ZoneType.Library)) {
                assertFalse(s.cards().containsKey("c" + c.getId()));
            }
        }
    }

    @Test
    void faceDownOpponentCardHasNoName() {
        Card c = place(opp, "Sol Ring", ZoneType.Battlefield);
        c.turnFaceDown(true);
        CardDto d = map().cards().get("c" + c.getId());
        assertNotNull(d);
        assertTrue(d.hidden());
        assertNull(d.name());
        assertNull(d.imageUrl());
    }

    @Test
    void commanderInCommandZone() {
        GameState s = map();
        PlayerDto m = dto(s, true);
        assertFalse(m.command().isEmpty());
        assertTrue(m.command().stream().anyMatch(id -> s.cards().get(id).commander()));
        assertEquals(40, m.life());
    }

    @Test
    void imageUrlIsScryfall() {
        Card c = place(me, "Sol Ring", ZoneType.Battlefield);
        CardDto d = map().cards().get("c" + c.getId());
        assertNotNull(d.imageUrl());
        assertTrue(d.imageUrl().startsWith("https://api.scryfall.com/cards/"));
    }

    @Test
    void serializesToJson() {
        assertTrue(Json.GSON.toJson(map()).contains("\"phase\""));
    }
}
