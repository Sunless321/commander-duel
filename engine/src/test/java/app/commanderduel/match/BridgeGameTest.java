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
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.player.PlayerView;
import forge.gamemodes.match.HostedMatch;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
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
        client = new ScriptedClient();
        gui = new BridgeGuiGame(client, new PendingRequests());
        client.attach(gui);
        List<BotSpec> bots = new ArrayList<>();
        for (int i = 0; i < botCount; i++) {
            bots.add(new BotSpec(precon(i + 1), Difficulty.NORMAL, null));
        }
        match = MatchStarter.start(precon(0), bots, gui);
    }

    @Test
    void humanVsBotPlaysToTurn4WithNoRejections() throws Exception {
        start(1);
        assertTrue(client.await(c -> c.latestTurn() >= 4, 120_000), "reached turn 4, at turn " + client.latestTurn());
        assertTrue(client.rejections.isEmpty(), "rejections: " + client.rejections);
        assertFalse(client.ofType("state").isEmpty());
    }

    @Test
    void threeBotPodStarts() throws Exception {
        start(3);
        assertTrue(client.await(c -> !c.ofType("state").isEmpty(), 60_000));
        JsonObject state = client.ofType("state").get(0).getAsJsonObject("state");
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
