package app.commanderduel.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import app.commanderduel.decks.DeckStore;
import app.commanderduel.forge.ForgeBootstrap;
import app.commanderduel.protocol.Json;
import app.commanderduel.transport.EngineServer;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

@Timeout(value = 3, unit = TimeUnit.MINUTES)
class EngineServerTest {
    private static final String TOKEN = "s3cret";
    private static Path decksDir;
    private static DeckStore store;

    private EngineServer server;
    private Session session;
    private final List<Client> clients = new java.util.ArrayList<>();

    static final class Client extends WebSocketClient {
        final BlockingQueue<JsonObject> messages = new LinkedBlockingQueue<>();
        final List<String> seen = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        final CompletableFuture<Integer> closed = new CompletableFuture<>();

        Client(URI uri) {
            super(uri);
        }

        @Override public void onOpen(ServerHandshake h) { }
        @Override public void onMessage(String m) { seen.add(m.length() > 300 ? m.substring(0, 300) : m); JsonObject o = Json.GSON.fromJson(m, JsonObject.class); messages.add(o); if (autoAnswer && o.get("type").getAsString().equals("request")) answerMin(o);
            // the coin toss ("play or draw") is a prompt shown before the first state
            if (autoAnswer && o.get("type").getAsString().equals("prompt") && o.get("message").getAsString().contains("coin toss")) send("{\"type\":\"action\",\"action\":\"ok\"}"); }

        volatile boolean autoAnswer;

        /** Answers a request with its first min options (Forge asks e.g. "AI cannot play these cards well" before the game). */
        void answerMin(JsonObject req) {
            JsonArray ids = new JsonArray();
            for (int i = 0; i < req.get("min").getAsInt(); i++) ids.add(req.getAsJsonArray("options").get(i).getAsJsonObject().get("id").getAsString());
            JsonObject a = new JsonObject();
            a.addProperty("type", "answer");
            a.addProperty("requestId", req.get("requestId").getAsString());
            a.add("optionIds", ids);
            send(a.toString());
        }
        @Override public void onClose(int code, String reason, boolean remote) { closed.complete(code); }
        @Override public void onError(Exception e) { }

        JsonObject next(Predicate<JsonObject> p, long timeoutMs) throws InterruptedException {
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (System.currentTimeMillis() < deadline) {
                JsonObject m = messages.poll(200, TimeUnit.MILLISECONDS);
                if (m != null && p.test(m)) {
                    return m;
                }
            }
            return null;
        }

        JsonObject ofType(String type, long timeoutMs) throws InterruptedException {
            return next(m -> m.get("type").getAsString().equals(type), timeoutMs);
        }
    }

    @BeforeAll
    static void boot() throws Exception {
        ForgeBootstrap.init(Path.of("../forge/forge-gui"), Files.createTempDirectory("cd"));
        decksDir = Files.createTempDirectory("decks");
        store = new DeckStore(decksDir);
    }

    @BeforeEach
    void start() throws Exception {
        session = new Session(store);
        server = new EngineServer(0, TOKEN, session);
        server.startAndWait();
    }

    @AfterEach
    void stop() throws Exception {
        for (Client c : clients) {
            c.close();
        }
        session.shutdown();
        server.stop(1000);
    }

    private Client connect(String query) throws Exception {
        Client c = new Client(new URI("ws://127.0.0.1:" + server.getPort() + "/" + query));
        clients.add(c);
        c.connectBlocking(10, TimeUnit.SECONDS);
        return c;
    }

    @Test
    void rejectsMissingToken() throws Exception {
        Client c = connect("");
        assertEquals(4001, c.closed.get(10, TimeUnit.SECONDS));
        Client wrong = connect("?token=nope");
        assertEquals(4001, wrong.closed.get(10, TimeUnit.SECONDS));
    }

    @Test
    void secondClientRejected() throws Exception {
        Client first = connect("?token=" + TOKEN);
        assertNotNull(first.ofType("ready", 10_000));
        Client second = connect("?token=" + TOKEN);
        assertEquals(4002, second.closed.get(10, TimeUnit.SECONDS));
        assertTrue(first.isOpen());
    }

    @Test
    void readyThenLobby() throws Exception {
        Client c = connect("?token=" + TOKEN);
        assertNotNull(c.ofType("ready", 10_000));
        c.send("{\"type\":\"listLobby\"}");
        JsonObject lobby = c.ofType("lobby", 30_000);
        assertNotNull(lobby);
        assertTrue(lobby.getAsJsonArray("precons").size() >= 150);
        JsonObject first = lobby.getAsJsonArray("precons").get(0).getAsJsonObject();
        assertTrue(first.has("commander") && first.has("colors") && first.has("name"));
    }

    @Test
    void importThenStartGame() throws Exception {
        Client c = connect("?token=" + TOKEN);
        assertNotNull(c.ofType("ready", 10_000));
        var precon = store.loadPrecon(store.precons().get(0).id());
        JsonObject imp = new JsonObject();
        imp.addProperty("type", "importDeck");
        imp.addProperty("name", "Test Deck");
        JsonArray commanders = new JsonArray();
        precon.getCommanders().forEach(cc -> commanders.add(cc.getName()));
        imp.add("commanders", commanders);
        JsonArray main = new JsonArray();
        precon.getMain().toFlatList().forEach(card -> {
            JsonObject e = new JsonObject();
            e.addProperty("count", 1);
            e.addProperty("name", card.getName());
            main.add(e);
        });
        imp.add("main", main);
        c.send(imp.toString());
        JsonObject result = c.ofType("importResult", 60_000);
        assertNotNull(result);
        assertTrue(result.get("ok").getAsBoolean(), result.toString());
        String deckId = result.getAsJsonObject("deck").get("id").getAsString();

        c.autoAnswer = true;
        c.send("{\"type\":\"startGame\",\"deckId\":\"" + deckId
                + "\",\"bots\":[{\"deck\":{\"kind\":\"randomPrecon\"},\"difficulty\":\"EASY\"}]}");
        assertNotNull(c.ofType("state", 60_000), "state arrives; saw " + c.seen);
        c.send("{\"type\":\"action\",\"action\":\"concede\"}");
        assertNotNull(c.ofType("gameOver", 60_000), "concede ends the game");
    }

    @Test
    void startGameErrorsDoNotStartAGame() throws Exception {
        Client c = connect("?token=" + TOKEN);
        assertNotNull(c.ofType("ready", 10_000));
        c.send("{\"type\":\"startGame\",\"deckId\":\"nope\",\"bots\":[{\"deck\":{\"kind\":\"randomPrecon\"},\"difficulty\":\"EASY\"}]}");
        assertNotNull(c.ofType("error", 10_000));
        c.send("{\"type\":\"startGame\",\"deckId\":\"nope\",\"bots\":[]}");
        assertNotNull(c.ofType("error", 10_000));
        assertTrue(!session.gameRunning());
    }


    private static final String BOT = "{\"deck\":{\"kind\":\"randomPrecon\"},\"difficulty\":\"EASY\"}";

    private static String startGameJson(String deckId, int bots) {
        return "{\"type\":\"startGame\",\"deckId\":\"" + deckId + "\",\"bots\":["
                + String.join(",", java.util.Collections.nCopies(bots, BOT)) + "]}";
    }

    @Test
    void disconnectDuringStartWindowEndsTheGame() throws Exception {
        Client c = connect("?token=" + TOKEN);
        assertNotNull(c.ofType("ready", 10_000));
        c.send(startGameJson(store.precons().get(0).id(), 1));
        c.close();
        long deadline = System.currentTimeMillis() + 60_000;
        while (session.gameRunning() && System.currentTimeMillis() < deadline) {
            Thread.sleep(200);
        }
        assertTrue(!session.gameRunning(), "game must end after the client left");
    }

    @Test
    void fastReconnectStillGetsReady() throws Exception {
        Client first = connect("?token=" + TOKEN);
        assertNotNull(first.ofType("ready", 10_000));
        first.closeBlocking();
        Client second = connect("?token=" + TOKEN);
        assertNotNull(second.ofType("ready", 10_000));
        second.send("{\"type\":\"listLobby\"}");
        assertNotNull(second.ofType("lobby", 30_000), "reconnected client still receives engine messages");
    }

    @Test
    void secondGameSilencesTheFirst() throws Exception {
        Client c = connect("?token=" + TOKEN);
        assertNotNull(c.ofType("ready", 10_000));
        c.autoAnswer = true;
        String deck = store.precons().get(0).id();
        c.send(startGameJson(deck, 1));
        assertNotNull(c.ofType("state", 60_000), "first game state");
        c.send(startGameJson(deck, 2));
        // the second game has 3 players; the first only 2
        assertNotNull(c.next(m -> m.get("type").getAsString().equals("state")
                && m.getAsJsonObject("state").getAsJsonArray("players").size() == 3, 90_000), "second game state");
        long until = System.currentTimeMillis() + 4_000;
        while (System.currentTimeMillis() < until) {
            JsonObject m = c.messages.poll(200, TimeUnit.MILLISECONDS);
            if (m == null) {
                continue;
            }
            String type = m.get("type").getAsString();
            assertTrue(!type.equals("gameOver"), "stale gameOver leaked: " + m);
            if (type.equals("state")) {
                assertEquals(3, m.getAsJsonObject("state").getAsJsonArray("players").size(), "stale state leaked");
            }
        }
        c.send("{\"type\":\"action\",\"action\":\"concede\"}");
        assertNotNull(c.ofType("gameOver", 60_000));
    }
    @Test
    void malformedJsonGivesError() throws Exception {
        Client c = connect("?token=" + TOKEN);
        assertNotNull(c.ofType("ready", 10_000));
        c.send("{");
        assertNotNull(c.ofType("error", 10_000));
        c.send("[1]");
        assertNotNull(c.ofType("error", 10_000));
    }
}
