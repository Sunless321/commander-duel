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
        assertTrue(o.visibleHand().isEmpty());
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
        assertTrue(dto(s, true).visibleLibrary().isEmpty());
        assertTrue(dto(s, false).visibleLibrary().isEmpty());
        for (Player p : game.getPlayers()) {
            for (Card c : p.getCardsIn(ZoneType.Library)) {
                assertFalse(s.cards().containsKey("c" + c.getId()));
            }
        }
    }

    /** A library card Forge lets the viewer look at right now (e.g. tempShow during a search) is listed. */
    @Test
    void libraryCardTheViewerMayLookAtIsListed() {
        Card shown = me.getCardsIn(ZoneType.Library).get(3);
        Card other = me.getCardsIn(ZoneType.Library).get(4);
        shown.addMayLookTemp(me);
        GameState s = map();
        PlayerDto m = dto(s, true);
        String id = "c" + shown.getId();
        assertEquals(List.of(id), m.visibleLibrary());
        assertEquals(shown.getName(), s.cards().get(id).name());
        assertEquals("Library", s.cards().get(id).zone());
        assertFalse(s.cards().containsKey("c" + other.getId()));
        assertEquals(99 - 7, m.libraryCount());
        shown.removeMayLookTemp(me);
        GameState after = map();
        assertTrue(dto(after, true).visibleLibrary().isEmpty());
        assertFalse(after.cards().containsKey(id));
    }

    /** An opponent's hand card is listed only while Forge lets the viewer look at it (Duress-style reveal). */
    @Test
    void revealedOpponentHandCardIsListed() {
        Card shown = opp.getCardsIn(ZoneType.Hand).get(0);
        Card other = opp.getCardsIn(ZoneType.Hand).get(1);
        shown.addMayLookTemp(me);
        GameState s = map();
        PlayerDto o = dto(s, false);
        String id = "c" + shown.getId();
        assertEquals(List.of(id), o.visibleHand());
        assertTrue(o.hand().isEmpty());
        assertEquals(7, o.handCount());
        assertEquals(shown.getName(), s.cards().get(id).name());
        assertFalse(s.cards().containsKey("c" + other.getId()));
        assertTrue(dto(s, true).visibleHand().isEmpty(), "own hand is in hand, not visibleHand");
    }

    /** Another player looking at a card does not let the viewer see it. */
    @Test
    void cardShownToSomeoneElseStaysHidden() {
        Card c = opp.getCardsIn(ZoneType.Library).get(0);
        c.addMayLookTemp(opp);
        GameState s = map();
        assertTrue(dto(s, false).visibleLibrary().isEmpty());
        assertFalse(s.cards().containsKey("c" + c.getId()));
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
        assertNull(d.text());
        assertNull(d.typeLine());
        assertNull(d.manaCost());
        assertNull(d.power());
        assertNull(d.toughness());
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

    private void putOnStack(Card source, Card target) {
        var sa = source.getFirstSpellAbility();
        sa.setActivatingPlayer(opp);
        if (target != null) {
            sa.setTargetCard(target);
        }
        game.getStack().add(sa);
        game.updateStackForView();
    }

    @Test
    void stackSourceInOpponentHandNotRegistered() {
        Card inHand = opp.getCardsIn(ZoneType.Hand).stream().filter(c -> c.isCreature()).findFirst().orElseThrow();
        Card libCard = opp.getCardsIn(ZoneType.Library).get(0);
        putOnStack(inHand, null);
        GameState s = map();
        assertEquals(1, s.stack().size());
        var item = s.stack().get(0);
        assertFalse(s.cards().containsKey("c" + inHand.getId()));
        assertFalse(s.cards().containsKey("c" + libCard.getId()));
        assertNull(item.sourceCardId());
        assertNull(item.text());
    }

    @Test
    void transformedDfcUsesBackFace() {
        Card c = place(me, "Delver of Secrets", ZoneType.Battlefield);
        CardDto front = map().cards().get("c" + c.getId());
        assertFalse(front.imageUrl().contains("face=back"));
        c.changeCardState("Transform", null, null);
        CardDto back = map().cards().get("c" + c.getId());
        assertTrue(back.imageUrl().contains("face=back"), back.imageUrl());
    }
}
