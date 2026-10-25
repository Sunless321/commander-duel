package app.commanderduel.match;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import app.commanderduel.decks.DeckStore;
import app.commanderduel.forge.BridgeGuiGame;
import app.commanderduel.forge.ForgeBootstrap;
import app.commanderduel.match.MatchStarter.BotSpec;
import app.commanderduel.protocol.PendingRequests;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import forge.StaticData;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.HostedMatch;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BiPredicate;
import java.util.function.Predicate;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

/** Real Commander games against Forge's AI on bundled precons, driven through the bridge by a scripted client. */
@Timeout(value = 3, unit = TimeUnit.MINUTES)
class BridgeGameTest {
    private static DeckStore decks;

    private ScriptedClient client;
    private BridgeGuiGame gui;
    private HostedMatch match;

    @BeforeAll
    static void boot() throws IOException {
        ForgeBootstrap.init(Path.of("../forge/forge-gui"), Files.createTempDirectory("cd"));
        decks = new DeckStore(Files.createTempDirectory("decks"));
    }

    @AfterEach
    void endGame() throws InterruptedException {
        if (client != null) {
            client.shutdown();
        }
        if (match != null) {
            Game game = match.getGame();
            if (game != null && !game.isGameOver()) {
                game.getAction().invoke(() -> game.setGameOver(GameEndReason.Draw));
            }
            client.await(c -> match.getGame() == null || match.getGame().isGameOver(), 30_000);
        }
    }

    private static Deck precon(int index) {
        return decks.loadPrecon(decks.precons().get(index).id());
    }

    private void start(int botCount) {
        start(botCount, null);
    }

    private void start(int botCount, BiPredicate<JsonObject, JsonObject> pauseOn) {
        client = new ScriptedClient();
        client.pauseOn = pauseOn;
        gui = new BridgeGuiGame(client, new PendingRequests());
        client.attach(gui);
        List<BotSpec> bots = new ArrayList<>();
        for (int i = 0; i < botCount; i++) {
            bots.add(new BotSpec(precon(i + 1), Difficulty.NORMAL, null));
        }
        match = MatchStarter.start(precon(0), bots, gui);
    }

    /** The game log reaches the client in order, turns included, without mana or phase lines. */
    @Test
    void gameLogIsRelayedWithoutManaOrPhaseLines() throws Exception {
        start(1);
        assertTrue(client.await(c -> c.latestTurn() >= 3, 120_000), "reached turn 3");
        assertTrue(client.await(c -> c.ofType("log").stream().anyMatch(m -> hasKind(m, "TURN")), 10_000), "a TURN line");
        List<String> kinds = new ArrayList<>();
        for (JsonObject m : client.ofType("log")) {
            for (JsonElement e : m.getAsJsonArray("entries")) {
                kinds.add(e.getAsJsonObject().get("kind").getAsString());
                assertFalse(e.getAsJsonObject().get("text").getAsString().isEmpty(), "log text");
            }
        }
        assertFalse(kinds.contains("MANA"), "kinds: " + kinds);
        assertFalse(kinds.contains("PHASE"), "kinds: " + kinds);
    }

    private static boolean hasKind(JsonObject log, String kind) {
        for (JsonElement e : log.getAsJsonArray("entries")) {
            if (kind.equals(e.getAsJsonObject().get("kind").getAsString())) {
                return true;
            }
        }
        return false;
    }

    @Test
    void humanVsBotPlaysToTurn4WithNoRejections() throws Exception {
        start(1);
        assertTrue(client.await(c -> c.latestTurn() >= 4, 120_000), "reached turn 4, at turn " + client.latestTurn());
        assertTrue(client.rejections.isEmpty(), "rejections: " + client.rejections);
        assertFalse(client.ofType("state").isEmpty());
    }

    /**
     * Every prompt, request and selection is stamped with the seq of the state sent just before it, and that
     * state is the nearest preceding state/prompt/request/selection message (so it was flushed for it).
     */
    @Test
    void stateImmediatelyPrecedesEveryPromptRequestAndSelection() throws Exception {
        start(1);
        assertTrue(client.await(c -> c.latestTurn() >= 4, 120_000), "reached turn 4");
        List<JsonObject> all;
        synchronized (client.messages) {
            all = new ArrayList<>(client.messages);
        }
        JsonObject prev = null; // nearest preceding state/prompt/request/selection
        int checked = 0;
        long lastSeq = 0;
        for (JsonObject m : all) {
            String type = m.get("type").getAsString();
            boolean decision = type.equals("prompt") || type.equals("request") || type.equals("selection");
            if (decision) {
                assertTrue(m.has("stateSeq"), type + " carries stateSeq");
                long stamp = m.get("stateSeq").getAsLong();
                if (prev != null && prev.get("type").getAsString().equals("state")) {
                    assertEquals(prev.get("seq").getAsLong(), stamp, type + " stateSeq");
                    checked++;
                } else {
                    // no state could be sent just before it: the stamp must be a not-yet-sent seq
                    assertTrue(stamp > lastSeq, type + " follows no state, so its stateSeq " + stamp + " must be above " + lastSeq);
                }
            }
            if (type.equals("state")) {
                lastSeq = m.get("seq").getAsLong();
            }
            if (decision || type.equals("state")) {
                prev = m;
            }
        }
        assertTrue(checked > 10, "checked " + checked);
        long last = 0;
        for (JsonObject m : all) {
            if (m.get("type").getAsString().equals("state")) {
                long seq = m.get("seq").getAsLong();
                assertTrue(seq > last, "state seq increases");
                last = seq;
            }
        }
    }

    /** A failed pre-prompt flush stamps the seq the retried state will carry, never the older applied seq. */
    @Test
    void failedFlushReservesTheNextSeqAndTheRetriedStateCarriesIt() throws Exception {
        start(1);
        gui.failNextFlush = true;
        assertTrue(client.await(c -> c.latestTurn() >= 2, 120_000), "game progressed");
        List<JsonObject> all;
        synchronized (client.messages) {
            all = new ArrayList<>(client.messages);
        }
        long maxSeq = 0;
        long reserved = -1;
        boolean carried = false;
        for (JsonObject m : all) {
            String type = m.get("type").getAsString();
            if (type.equals("state")) {
                long seq = m.get("seq").getAsLong();
                if (reserved > 0 && !carried) {
                    assertEquals(reserved, seq, "the retried state carries the reserved seq");
                    carried = true;
                }
                maxSeq = seq;
            } else if (m.has("stateSeq") && m.get("stateSeq").getAsLong() > maxSeq && reserved < 0) {
                reserved = m.get("stateSeq").getAsLong();
                assertEquals(maxSeq + 1, reserved);
            }
        }
        assertTrue(reserved > 0, "a prompt was stamped with a seq above every state sent before it");
        assertTrue(carried, "the reserved seq was sent");
    }

    /** With 3+ players the toss winner picks the starting portrait before the mulligan; the board needs a state for that. */
    @Test
    void threeBotGameReachesFirstPriorityAfterPortraitPick() throws Exception {
        start(3);
        assertTrue(client.await(c -> c.first("prompt", m -> m.get("inputKind").getAsString().equals("priority")) != null, 120_000),
                "reached a priority prompt");
        assertTrue(client.rejections.isEmpty(), "rejections: " + client.rejections);
        List<JsonObject> all;
        synchronized (client.messages) {
            all = new ArrayList<>(client.messages);
        }
        // Any selection offering players arrived after a state with all four players, so the UI had panels to click.
        JsonObject lastState = null;
        for (JsonObject m : all) {
            String type = m.get("type").getAsString();
            if (type.equals("state")) {
                lastState = m;
            } else if (type.equals("selection")) {
                boolean players = false;
                for (JsonElement e : m.getAsJsonArray("selectable")) {
                    players |= e.getAsString().startsWith("p");
                }
                if (players) {
                    assertTrue(lastState != null, "state before a player selection");
                    assertEquals(4, lastState.getAsJsonObject("state").getAsJsonArray("players").size());
                }
            }
        }
    }

    /** Forge's "AI can't play these cards well" reveal is noise for a player; the pod starts without it. */
    @Test
    void noAiUnplayableCardsNoticeAtStart() throws Exception {
        // Kaalia of the Vast's precon lists cards the AI flags (Master Warcraft, Cleansing Beam, ...).
        Deck kaalia = decks.precons().stream().filter(p -> p.commanders().contains("Kaalia of the Vast"))
                .findFirst().map(p -> decks.loadPrecon(p.id())).orElseThrow();
        client = new ScriptedClient();
        gui = new BridgeGuiGame(client, new PendingRequests());
        client.attach(gui);
        match = MatchStarter.start(precon(0), List.of(new BotSpec(kaalia, Difficulty.NORMAL, null)), gui);
        assertTrue(client.await(c -> c.latestTurn() >= 1, 120_000), "the game reached turn 1");
        List<String> titles = new ArrayList<>();
        for (JsonObject m : client.ofType("request")) {
            titles.add(String.valueOf(str(m, "title")));
        }
        assertFalse(titles.stream().anyMatch(t -> t.contains("AI can't play")), "requests: " + titles);
    }

    @Test
    void threeBotPodStarts() throws Exception {
        start(3);
        assertTrue(client.await(c -> !c.ofType("state").isEmpty(), 60_000));
        // States now flow from game creation (before commanders are dealt): all four players are there from the first.
        assertEquals(4, client.ofType("state").get(0).getAsJsonObject("state").getAsJsonArray("players").size());
        Predicate<JsonObject> dealt = st -> {
            for (JsonElement e : st.getAsJsonObject("state").getAsJsonArray("players")) {
                if (e.getAsJsonObject().getAsJsonArray("command").isEmpty()) {
                    return false;
                }
            }
            return true;
        };
        assertTrue(client.await(c -> c.ofType("state").stream().anyMatch(dealt), 60_000), "commanders dealt");
        JsonObject state = client.ofType("state").stream().filter(dealt).findFirst().get().getAsJsonObject("state");
        assertEquals(4, state.getAsJsonArray("players").size());
        for (JsonElement p : state.getAsJsonArray("players")) {
            JsonObject player = p.getAsJsonObject();
            assertEquals(40, player.get("life").getAsInt(), player.get("name").getAsString());
            assertFalse(player.getAsJsonArray("command").isEmpty(), player.get("name").getAsString());
        }
        List<String> names = new ArrayList<>();
        state.getAsJsonArray("players").forEach(p -> names.add(p.getAsJsonObject().get("name").getAsString()));
        assertEquals(4, names.stream().distinct().count(), "distinct names: " + names);
        assertTrue(names.stream().filter(n -> n.endsWith(" Bot")).count() == 3, "bot names: " + names);
    }

    @Test
    void playableMessagesSent() throws Exception {
        start(1);
        assertTrue(client.await(c -> c.first("playable", m -> !m.getAsJsonArray("cardIds").isEmpty()) != null, 120_000),
                "a non-empty playable message");
        JsonObject playable = client.first("playable", m -> !m.getAsJsonArray("cardIds").isEmpty());
        for (JsonElement id : playable.getAsJsonArray("cardIds")) {
            assertTrue(id.getAsString().startsWith("c"), "card ids are prefixed: " + id);
        }
    }

    private static String str(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? null : e.getAsString();
    }

    private static JsonObject yourPlayer(JsonObject state) {
        for (JsonElement p : state.getAsJsonArray("players")) {
            if (p.getAsJsonObject().get("you").getAsBoolean()) {
                return p.getAsJsonObject();
            }
        }
        throw new AssertionError("no you in state");
    }

    /** No library card and no opponent's hand card is in the snapshot (nothing lets you look at them). */
    private static void assertNoHiddenCards(JsonObject state) {
        String you = str(state, "youId");
        for (var e : state.getAsJsonObject("cards").entrySet()) {
            JsonObject c = e.getValue().getAsJsonObject();
            String zone = str(c, "zone");
            assertFalse("Library".equals(zone), "library card listed: " + e.getKey() + " " + str(c, "name"));
            assertFalse("Hand".equals(zone) && !you.equals(str(c, "controllerId")),
                    "opponent hand card listed: " + e.getKey() + " " + str(c, "name"));
        }
        for (JsonElement p : state.getAsJsonArray("players")) {
            assertTrue(p.getAsJsonObject().getAsJsonArray("visibleLibrary").isEmpty(), "visibleLibrary");
            assertTrue(p.getAsJsonObject().getAsJsonArray("visibleHand").isEmpty(), "visibleHand");
        }
    }

    /**
     * Cracking a fetchland asks through a board-click selection over library cards (UI_SELECT_FROM_CARD_DISPLAYS).
     * Those cards must be in the state sent just before the selection (Forge temp-shows them to the searcher),
     * listed in your visibleLibrary; picking one puts it onto your battlefield. Before and after, the library is hidden.
     */
    @Test
    void fetchlandSearchListsTheLibraryCardsItOffers() throws Exception {
        fetchlandSearch();
    }

    private static final BiPredicate<JsonObject, JsonObject> YOUR_EMPTY_MAIN1 = (state, prompt) ->
            "priority".equals(str(prompt, "inputKind"))
                    && str(state, "youId").equals(str(state, "activePlayerId"))
                    && "MAIN1".equals(str(state, "phase"))
                    && state.getAsJsonArray("stack").isEmpty();

    private long latestPromptSeq() {
        List<JsonObject> prompts = client.ofType("prompt");
        return prompts.get(prompts.size() - 1).get("promptSeq").getAsLong();
    }

    /** A second OK aimed at a prompt that was already answered must not act on the next input (double-click). */
    @Test
    void okAimedAtAnAnsweredPromptIsRejected() throws Exception {
        start(1, YOUR_EMPTY_MAIN1);
        assertTrue(client.await(c -> c.pausedAt != null, 120_000), "paused at priority in your main phase");
        long seq = client.pausedAt.get("promptSeq").getAsLong();
        gui.onAction("ok", null, null, seq);
        assertTrue(client.await(c -> latestPromptSeq() > seq, 30_000), "a newer prompt after passing priority");
        int before = client.rejections.size();
        gui.onAction("ok", null, null, seq);
        assertTrue(client.await(c -> c.rejections.size() > before, 10_000), "the stale OK is rejected");
        assertTrue(client.rejections.get(before).startsWith("stale"), "reason: " + client.rejections.get(before));
    }

    /** OK while the engine has it disabled (targeting with no target picked) is rejected, not applied. */
    @Test
    void okWhileDisabledIsRejectedAndTheSpellKeepsTargeting() throws Exception {
        start(1, YOUR_EMPTY_MAIN1);
        assertTrue(client.await(c -> c.pausedAt != null, 120_000), "paused at priority in your main phase");
        Player you = humanPlayer();
        Card growth = Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Giant Growth"), you);
        Card forest = Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Forest"), you);
        Card bear = Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Grizzly Bears"), you);
        you.getZone(ZoneType.Hand).add(growth);
        you.getZone(ZoneType.Battlefield).add(forest);
        you.getZone(ZoneType.Battlefield).add(bear);
        long priority = client.pausedAt.get("promptSeq").getAsLong();
        gui.onAction("selectCard", "c" + growth.getId(), null, priority);
        assertTrue(client.await(c -> {
            List<JsonObject> p = c.ofType("prompt");
            return !p.isEmpty() && "target".equals(str(p.get(p.size() - 1), "inputKind"));
        }, 30_000), "asked for Giant Growth's target");
        List<JsonObject> prompts = client.ofType("prompt");
        JsonObject target = prompts.get(prompts.size() - 1);
        assertFalse(target.getAsJsonObject("ok").get("enabled").getAsBoolean(), "OK starts disabled: " + target);
        int before = client.rejections.size();
        gui.onAction("ok", null, null, target.get("promptSeq").getAsLong());
        assertTrue(client.await(c -> c.rejections.size() > before, 10_000), "the disabled OK is rejected");
        Thread.sleep(500);
        List<JsonObject> after = client.ofType("prompt");
        assertEquals("target", str(after.get(after.size() - 1), "inputKind"), "still targeting");
        assertFalse(you.getZone(ZoneType.Graveyard).contains(growth), "Giant Growth is not in the graveyard");
    }

    /** Wire actions must say which prompt they answer. */
    @Test
    void actionWithoutPromptSeqIsRejected() throws Exception {
        start(1, YOUR_EMPTY_MAIN1);
        assertTrue(client.await(c -> c.pausedAt != null, 120_000), "paused at priority in your main phase");
        int before = client.rejections.size();
        gui.onAction("ok", null, null, null);
        assertTrue(client.await(c -> c.rejections.size() > before, 10_000), "rejected");
        assertTrue(client.rejections.get(before).startsWith("stale"), "reason: " + client.rejections.get(before));
    }

    /**
     * Seen in a real game: a bot cast Flawless Forgery on the human's Wurmquake and the game thread died, leaving
     * the game frozen. The bot gets Forgery and the mana for it, Wurmquake goes into the human's graveyard, and
     * the game must reach the next turns with no uncaught error on the game thread.
     */
    @Test
    void botCastingFlawlessForgeryOnWurmquakeKeepsTheGameGoing() throws Exception {
        List<Throwable> uncaught = java.util.Collections.synchronizedList(new ArrayList<>());
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            uncaught.add(e);
            e.printStackTrace();
        });
        try {
            start(1, YOUR_EMPTY_MAIN1);
            assertTrue(client.await(c -> c.pausedAt != null, 120_000), "paused at priority in your main phase");
            Player you = humanPlayer();
            Player bot = match.getGame().getPlayers().stream().filter(p -> p != you).findFirst().orElseThrow();
            you.getZone(ZoneType.Graveyard).add(Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Wurmquake"), you));
            bot.getZone(ZoneType.Hand).add(Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Flawless Forgery"), bot));
            for (int i = 0; i < 6; i++) {
                bot.getZone(ZoneType.Battlefield).add(Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Island"), bot));
            }
            // As in the real game: Anhelo gives the first instant/sorcery casualty, and there is a creature to sacrifice.
            for (String name : List.of("Anhelo, the Painter", "Hill Giant", "Hill Giant")) {
                Card c = Card.fromPaperCard(StaticData.instance().getCommonCards().getCard(name), bot);
                c.setSickness(false);
                bot.getZone(ZoneType.Battlefield).add(c);
            }
            int turn = client.latestTurn();
            client.pausedAt = null;
            client.autoPlay = true;
            gui.onAction("ok", null, null);
            boolean cast = client.await(c -> logMentions(c, "Flawless Forgery") || !uncaught.isEmpty(), 120_000);
            assertTrue(cast, "the bot cast Flawless Forgery");
            assertTrue(client.await(c -> c.latestTurn() >= turn + 2 || !uncaught.isEmpty(), 120_000),
                    "the game went on past the bot's turn (turn " + client.latestTurn() + ")");
            assertTrue(uncaught.isEmpty(), "uncaught: " + uncaught);
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(previous);
        }
    }

    /** Bots run Forge's AI behind the safety net; a decision that throws gives the fallback and a play-log line. */
    @Test
    void botsUseTheSafeControllerAndAFailedDecisionFallsBack() throws Exception {
        start(1, YOUR_EMPTY_MAIN1);
        assertTrue(client.await(c -> c.pausedAt != null, 120_000), "paused at priority in your main phase");
        Player you = humanPlayer();
        Player bot = match.getGame().getPlayers().stream().filter(p -> p != you).findFirst().orElseThrow();
        assertTrue(bot.getController() instanceof app.commanderduel.forge.SafePlayerControllerAi, "controller: " + bot.getController());
        app.commanderduel.forge.SafePlayerControllerAi safe = (app.commanderduel.forge.SafePlayerControllerAi) bot.getController();
        String got = safe.guard("a test", () -> {
            throw new IllegalStateException("simulated AI bug");
        }, () -> "fallback");
        assertEquals("fallback", got);
        assertEquals("fine", safe.guard("a test", () -> "fine", () -> "fallback"));
        assertTrue(client.await(c -> logMentions(c, "hit an engine error while deciding a test"), 10_000), "the play log says so");
    }

    /** A dead game thread is reported to the player instead of looking like a bot thinking forever. */
    @Test
    void anEngineFaultTellsThePlayerTheGameMayBeStuck() throws Exception {
        start(1, YOUR_EMPTY_MAIN1);
        assertTrue(client.await(c -> c.pausedAt != null, 120_000), "paused at priority in your main phase");
        gui.engineFault(new NullPointerException("boom"));
        assertTrue(client.await(c -> c.first("error", m -> str(m, "message").contains("may be stuck")) != null, 10_000),
                "errors: " + client.ofType("error"));
        String msg = str(client.first("error", m -> true), "message");
        assertTrue(msg.contains("NullPointerException: boom") && msg.contains("Concede"), msg);
    }

    private static boolean logMentions(ScriptedClient c, String text) {
        for (JsonObject m : c.ofType("log")) {
            for (JsonElement e : m.getAsJsonArray("entries")) {
                if (e.getAsJsonObject().get("text").getAsString().contains(text)) {
                    return true;
                }
            }
        }
        return false;
    }

    private Player humanPlayer() {
        List<JsonObject> states = client.ofType("state");
        String youId = str(states.get(states.size() - 1).getAsJsonObject("state"), "youId");
        return match.getGame().getPlayers().stream().filter(p -> ("p" + p.getId()).equals(youId)).findFirst().orElseThrow();
    }

    /** In a 4-player pod, clicking an opponent's panel while declaring attackers sends the attack at that player. */
    @Test
    void attackTheChosenOpponentInAThreeBotPod() throws Exception {
        start(3, (state, prompt) -> "priority".equals(str(prompt, "inputKind"))
                && str(state, "youId").equals(str(state, "activePlayerId"))
                && "MAIN1".equals(str(state, "phase"))
                && state.getAsJsonArray("stack").isEmpty());
        assertTrue(client.await(c -> c.pausedAt != null, 120_000), "paused at priority in your main phase");
        JsonObject state0 = client.ofType("state").get(client.ofType("state").size() - 1).getAsJsonObject("state");
        String youId = str(state0, "youId");
        Player you = match.getGame().getPlayers().stream().filter(p -> ("p" + p.getId()).equals(youId)).findFirst().orElseThrow();
        Card bear = Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Grizzly Bears"), you);
        bear.setSickness(false);
        you.getZone(ZoneType.Battlefield).add(bear);
        String bearId = "c" + bear.getId();
        List<String> opponents = new ArrayList<>();
        for (JsonElement p : state0.getAsJsonArray("players")) {
            if (!p.getAsJsonObject().get("you").getAsBoolean()) {
                opponents.add(str(p.getAsJsonObject(), "id"));
            }
        }
        assertEquals(3, opponents.size());

        client.pausedAt = null;
        client.pauseOn = (state, prompt) -> "attack".equals(str(prompt, "inputKind"));
        client.autoPlay = true;
        gui.onAction("ok", null, null); // pass priority in main 1 -> declare attackers
        assertTrue(client.await(c -> c.pausedAt != null, 60_000), "asked to declare attackers");

        String target = opponents.get(1); // not the default (first) defender
        gui.onAction("selectPlayer", target, null);
        gui.onAction("selectCard", bearId, null);
        Predicate<JsonObject> attacking = st -> {
            for (JsonElement a : st.getAsJsonObject("state").getAsJsonArray("combat")) {
                JsonObject atk = a.getAsJsonObject();
                if (bearId.equals(str(atk, "attackerId"))) {
                    return target.equals(str(atk, "defenderId"));
                }
            }
            return false;
        };
        assertTrue(client.await(c -> c.ofType("state").stream().anyMatch(attacking), 30_000),
                "the bear attacks " + target + "; combat: " + client.ofType("state").get(client.ofType("state").size() - 1)
                        .getAsJsonObject("state").get("combat"));
        assertTrue(client.rejections.isEmpty(), "rejections: " + client.rejections);
    }

    private void fetchlandSearch() throws Exception {
        start(1, (state, prompt) -> "priority".equals(str(prompt, "inputKind"))
                && str(state, "youId").equals(str(state, "activePlayerId"))
                && "MAIN1".equals(str(state, "phase"))
                && state.getAsJsonArray("stack").isEmpty());
        assertTrue(client.await(c -> c.pausedAt != null, 120_000), "paused at priority in your main phase");
        List<JsonObject> states = client.ofType("state"); // checked for hidden cards at the end

        Game game = match.getGame();
        String youId = str(states.get(states.size() - 1).getAsJsonObject("state"), "youId");
        Player you = game.getPlayers().stream().filter(p -> ("p" + p.getId()).equals(youId)).findFirst().orElseThrow();
        // The game thread is parked on the priority Input while the board is set up.
        Card forest = Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Forest"), you);
        Card swamp = Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Swamp"), you);
        Card fetch = Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Verdant Catacombs"), you);
        you.getZone(ZoneType.Library).add(forest);
        you.getZone(ZoneType.Library).add(swamp);
        you.getZone(ZoneType.Battlefield).add(fetch);
        String forestId = "c" + forest.getId();
        String swampId = "c" + swamp.getId();

        int mark = client.messages.size();
        client.autoPlay = true; // answers the cost prompts, passes priority, then picks the first offered card + OK
        gui.onAction("selectCard", "c" + fetch.getId(), null);
        Predicate<JsonObject> search = m -> m.get("type").getAsString().equals("selection")
                && m.getAsJsonArray("selectable").contains(new JsonPrimitive(forestId));
        assertTrue(client.await(c -> {
            synchronized (c.messages) {
                return c.messages.subList(mark, c.messages.size()).stream().anyMatch(search);
            }
        }, 60_000), "a selection offering the Forest in your library");

        List<JsonObject> all;
        synchronized (client.messages) {
            all = new ArrayList<>(client.messages);
        }
        int at = mark;
        while (!search.test(all.get(at))) {
            at++;
        }
        JsonObject selection = all.get(at);
        JsonObject before = null;
        for (int i = at - 1; i >= 0 && before == null; i--) {
            if (all.get(i).get("type").getAsString().equals("state")) {
                before = all.get(i);
            }
        }
        assertNotNull(before, "a state before the selection");
        assertEquals(before.get("seq").getAsLong(), selection.get("stateSeq").getAsLong());
        JsonObject state = before.getAsJsonObject("state");
        JsonObject cards = state.getAsJsonObject("cards");
        JsonArray visibleLibrary = yourPlayer(state).getAsJsonArray("visibleLibrary");
        assertTrue(selection.getAsJsonArray("selectable").contains(new JsonPrimitive(swampId)), "the Swamp is offered too");
        for (JsonElement e : selection.getAsJsonArray("selectable")) {
            String id = e.getAsString();
            assertTrue(cards.has(id), "offered card " + id + " is in the state");
            assertNotNull(str(cards.getAsJsonObject(id), "name"), "offered card " + id + " has a name");
            assertTrue(visibleLibrary.contains(e), "offered card " + id + " is in your visibleLibrary");
        }
        assertEquals("Forest", str(cards.getAsJsonObject(forestId), "name"));

        String picked = selection.getAsJsonArray("selectable").get(0).getAsString();
        Predicate<JsonObject> landed = st -> yourPlayer(st.getAsJsonObject("state"))
                .getAsJsonArray("battlefield").contains(new JsonPrimitive(picked));
        assertTrue(client.await(c -> c.ofType("state").stream().anyMatch(landed), 60_000),
                "the picked land " + picked + " is on your battlefield");
        JsonObject after = client.ofType("state").stream().filter(landed).findFirst().get().getAsJsonObject("state");
        assertNoHiddenCards(after);
        for (JsonObject st : states) {
            assertNoHiddenCards(st.getAsJsonObject("state"));
        }
        assertTrue(client.rejections.isEmpty(), "rejections: " + client.rejections);
    }

    @Test
    void bogusActionIdRejected() throws Exception {
        start(1);
        assertTrue(client.await(c -> !c.ofType("prompt").isEmpty(), 60_000));
        gui.onAction("selectCard", "999999", null);
        gui.onAction("selectCard", "c999999", null);
        gui.onAction("selectPlayer", "c1", null);
        gui.onAction("useMana", null, "X");
        assertEquals(4, client.ofType("rejected").size(), "rejections: " + client.rejections);
        int turn = client.latestTurn();
        assertTrue(client.await(c -> c.latestTurn() > turn, 120_000), "game continues after rejections");
    }

    /**
     * A passive player is not guaranteed a request: with board-click Inputs (isLibgdxPort=false) Forge asks
     * mulligans, discards, targets, attacks and most confirmations through the prompt. So the test makes
     * Forge ask, mid-game, through the gui's {@code one()} (AbstractGuiGame -> getChoices) as card effects do.
     */
    @Test
    void bogusAnswerRejected() throws Exception {
        start(1);
        assertTrue(client.await(c -> c.latestTurn() >= 1, 60_000));
        client.sendBogusAnswerFirst = true;
        List<PlayerView> players = List.copyOf(gui.getGameView().getPlayers());
        CompletableFuture<PlayerView> picked = CompletableFuture.supplyAsync(() -> gui.one("Choose a player", players));
        assertSame(players.get(0), picked.get(30, TimeUnit.SECONDS), "the original object Forge offered");
        String requestId = client.bogusRequestId;
        assertNotNull(requestId);
        JsonObject rejected = client.first("rejected", m -> true);
        assertNotNull(rejected, "the bogus answer was rejected");
        assertEquals(requestId, rejected.get("requestId").getAsString());
        int turn = client.latestTurn();
        assertTrue(client.await(c -> c.latestTurn() > turn, 120_000), "game continues");
    }

    @Test
    void concedeEndsGameWithGameOver() throws Exception {
        start(1);
        assertTrue(client.await(c -> c.latestTurn() >= 1, 60_000));
        gui.onAction("concede", null, null);
        assertTrue(client.await(c -> !c.ofType("gameOver").isEmpty(), 30_000), "gameOver sent");
        JsonObject over = client.ofType("gameOver").get(0);
        assertFalse(over.get("youWon").getAsBoolean());
        assertEquals(1, over.getAsJsonArray("winnerNames").size());
        assertTrue(over.getAsJsonArray("winnerNames").get(0).getAsString().endsWith(" Bot"));
    }

    @Test
    void concedeWithThreeBotsEndsGame() throws Exception {
        start(3);
        assertTrue(client.await(c -> c.latestTurn() >= 1, 60_000));
        gui.onAction("concede", null, null);
        assertTrue(client.await(c -> !c.ofType("gameOver").isEmpty(), 30_000), "gameOver sent");
        assertFalse(client.ofType("gameOver").get(0).get("youWon").getAsBoolean());
        assertTrue(client.await(c -> match.getGame() == null || match.getGame().isGameOver(), 30_000), "the game ended");
    }

    @Test
    void blockingCallsAfterGameEndReturnAtOnce() throws Exception {
        start(1);
        assertTrue(client.await(c -> c.latestTurn() >= 1, 60_000));
        gui.onAction("concede", null, null);
        assertTrue(client.await(c -> !c.ofType("gameOver").isEmpty(), 30_000), "gameOver sent");
        int requestsBefore = client.ofType("request").size();
        List<PlayerView> players = List.copyOf(gui.getGameView().getPlayers());
        List<PlayerView> picked = CompletableFuture
                .supplyAsync(() -> gui.getChoices("After the game", 1, 1, players, null, null))
                .get(5, TimeUnit.SECONDS);
        assertEquals(List.of(players.get(0)), picked, "the smallest legal answer, without asking");
        assertEquals(requestsBefore, client.ofType("request").size(), "no request sent after game end");
    }
}
