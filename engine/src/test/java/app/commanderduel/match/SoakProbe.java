package app.commanderduel.match;

import app.commanderduel.decks.DeckStore;
import app.commanderduel.forge.BridgeGuiGame;
import app.commanderduel.forge.ForgeBootstrap;
import app.commanderduel.match.MatchStarter.BotSpec;
import app.commanderduel.protocol.PendingRequests;
import forge.deck.Deck;
import forge.gamemodes.match.HostedMatch;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Manual probe (not a test): plays many 4-player games and records every error that escapes a game thread and
 * every stall (no engine message for a while with the game not over), with a dump of the game threads.
 * Args: games, maxTurns, out file, [precon name fragments for the fixed bots...].
 */
public final class SoakProbe {
    public static void main(String[] args) throws Exception {
        int games = Integer.parseInt(args[0]);
        int maxTurns = Integer.parseInt(args[1]);
        Path out = Path.of(args[2]);
        List<String> fixed = List.of(args).subList(3, args.length);
        List<String> uncaught = Collections.synchronizedList(new ArrayList<>());
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            StringWriter sw = new StringWriter();
            e.printStackTrace(new PrintWriter(sw));
            uncaught.add("thread " + t.getName() + ": " + sw);
        });
        ForgeBootstrap.init(Path.of("../forge/forge-gui"), Files.createTempDirectory("cd"));
        DeckStore decks = new DeckStore(Files.createTempDirectory("decks"));
        List<DeckStore.DeckSummary> precons = decks.precons();
        Path userDecks = Path.of(System.getenv().getOrDefault("PROBE_DECKS", ""));
        Deck you = null;
        if (Files.isDirectory(userDecks)) {
            DeckStore mine = new DeckStore(userDecks);
            if (!mine.list().isEmpty()) {
                you = mine.load(mine.list().get(mine.list().size() - 1).id());
            }
        }
        java.util.Random rnd = new java.util.Random(Long.getLong("seed", 7));
        for (int g = 0; g < games; g++) {
            List<BotSpec> bots = new ArrayList<>();
            for (String f : fixed) {
                DeckStore.DeckSummary p = precons.stream().filter(s -> s.name().contains(f)).findFirst().orElseThrow();
                bots.add(new BotSpec(decks.loadPrecon(p.id()), Difficulty.HARD, null));
            }
            while (bots.size() < 3) {
                bots.add(new BotSpec(decks.loadPrecon(precons.get(rnd.nextInt(precons.size())).id()), Difficulty.HARD, null));
            }
            Deck human = you != null ? you : decks.loadPrecon(precons.get(rnd.nextInt(precons.size())).id());
            ScriptedClient client = new ScriptedClient();
            BridgeGuiGame gui = new BridgeGuiGame(client, new PendingRequests());
            client.attach(gui);
            int before = uncaught.size();
            HostedMatch match = MatchStarter.start(human, bots, gui);
            long lastCount = -1;
            long lastChange = System.currentTimeMillis();
            String result = "?";
            while (true) {
                Thread.sleep(1000);
                // Forge drops the finished game from the match, so the gameOver message is the reliable sign.
                if (!client.ofType("gameOver").isEmpty() || (match.getGame() != null && match.getGame().isGameOver())) {
                    result = "over at turn " + client.latestTurn();
                    break;
                }
                if (client.latestTurn() >= maxTurns) {
                    result = "turn limit";
                    break;
                }
                if (uncaught.size() > before) {
                    Thread.sleep(3000);
                    result = "UNCAUGHT";
                    break;
                }
                long n = client.messages.size();
                if (n != lastCount) {
                    lastCount = n;
                    lastChange = System.currentTimeMillis();
                } else if (System.currentTimeMillis() - lastChange > 120_000) {
                    result = "STALL";
                    StringBuilder dump = new StringBuilder();
                    for (Map.Entry<Thread, StackTraceElement[]> e : Thread.getAllStackTraces().entrySet()) {
                        if (e.getKey().getName().startsWith("Game") || e.getKey().getName().startsWith("bridge")) {
                            dump.append(e.getKey().getName()).append('\n');
                            for (StackTraceElement s : e.getValue()) {
                                dump.append("    at ").append(s).append('\n');
                            }
                        }
                    }
                    uncaught.add("stall dump:\n" + dump);
                    break;
                }
            }
            StringBuilder line = new StringBuilder("game " + (g + 1) + " [" + human.getName() + " vs "
                    + bots.stream().map(b -> b.deck().getName()).toList() + "]: " + result + "\n");
            for (String u : uncaught.subList(before, uncaught.size())) {
                line.append(u).append('\n');
            }
            Files.writeString(out, line, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            System.out.print("PROBE " + line);
            client.shutdown();
            try {
                gui.onAction("concede", null, null);
            } catch (RuntimeException ignored) {
                // the game may be dead already
            }
            Thread.sleep(2000);
        }
        System.exit(0);
    }
}
