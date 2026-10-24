package app.commanderduel.match;

import app.commanderduel.decks.DeckStore;
import app.commanderduel.forge.BridgeGuiGame;
import app.commanderduel.forge.ForgeBootstrap;
import app.commanderduel.match.MatchStarter.BotSpec;
import app.commanderduel.protocol.PendingRequests;
import forge.gamemodes.match.HostedMatch;
import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Manual probe (not a test): plays consecutive 4-player games and prints retained heap after each. */
public final class MemoryProbe {
    public static void main(String[] args) throws Exception {
        int games = args.length > 0 ? Integer.parseInt(args[0]) : 4;
        int turns = args.length > 1 ? Integer.parseInt(args[1]) : 6;
        Difficulty difficulty = args.length > 2 ? Difficulty.valueOf(args[2]) : Difficulty.NORMAL;
        ForgeBootstrap.init(Path.of("../forge/forge-gui"), Files.createTempDirectory("cd"));
        DeckStore decks = new DeckStore(Files.createTempDirectory("decks"));
        report("after boot");
        for (int g = 0; g < games; g++) {
            ScriptedClient client = new ScriptedClient();
            BridgeGuiGame gui = new BridgeGuiGame(client, new PendingRequests());
            client.attach(gui);
            List<BotSpec> bots = new ArrayList<>();
            for (int i = 0; i < 3; i++) {
                bots.add(new BotSpec(decks.loadPrecon(decks.precons().get(g * 4 + i + 1).id()), difficulty, null));
            }
            HostedMatch match = MatchStarter.start(decks.loadPrecon(decks.precons().get(g * 4).id()), bots, gui);
            long t0 = System.currentTimeMillis();
            client.await(c -> c.latestTurn() >= turns || (match.getGame() != null && match.getGame().isGameOver()), 600_000);
            long secs = (System.currentTimeMillis() - t0) / 1000;
            report("game " + (g + 1) + " at turn " + client.latestTurn() + " (" + secs + " s, " + client.messages.size() + " msgs) live");
            gui.onAction("concede", null, null);
            client.await(c -> !c.ofType("gameOver").isEmpty(), 60_000);
            client.await(c -> match.getGame() == null || match.getGame().isGameOver(), 60_000);
            client.shutdown();
            client.messages.clear();
            report("game " + (g + 1) + " ended");
        }
        System.exit(0);
    }

    private static void report(String label) throws InterruptedException {
        for (int i = 0; i < 3; i++) {
            System.gc();
            Thread.sleep(300);
        }
        Runtime rt = Runtime.getRuntime();
        long used = (rt.totalMemory() - rt.freeMemory()) >> 20;
        long committed = rt.totalMemory() >> 20;
        long threads = ManagementFactory.getThreadMXBean().getThreadCount();
        System.out.printf("PROBE %-45s heapUsed=%4d MB committed=%4d MB threads=%d%n", label, used, committed, threads);
    }
}
