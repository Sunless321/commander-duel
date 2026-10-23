package app.commanderduel;

import app.commanderduel.decks.DeckStore;
import app.commanderduel.forge.ForgeBootstrap;
import app.commanderduel.session.Session;
import app.commanderduel.transport.EngineServer;
import java.io.PrintStream;
import java.nio.file.Path;

/** Process entry: {@code --forge <forge-gui dir> --data <dir> --token <token>}. */
public final class Main {
    private static final long IDLE_EXIT_MS = 10_000;

    private Main() { }

    public static void main(String[] args) throws Exception {
        String forge = null;
        String data = null;
        String token = null;
        for (int i = 0; i + 1 < args.length; i += 2) {
            switch (args[i]) {
                case "--forge" -> forge = args[i + 1];
                case "--data" -> data = args[i + 1];
                case "--token" -> token = args[i + 1];
                default -> usage();
            }
        }
        if (forge == null || data == null || token == null || token.isEmpty()) {
            usage();
        }

        // stdout carries exactly one line, READY; everything Forge prints goes to stderr.
        PrintStream protocolOut = System.out;
        System.setOut(System.err);

        Path dataDir = Path.of(data);
        ForgeBootstrap.init(Path.of(forge), dataDir);
        Session session = new Session(new DeckStore(dataDir.resolve("decks")));
        EngineServer server = new EngineServer(0, token, session);
        server.startAndWait();
        protocolOut.println("READY port=" + server.getPort());
        protocolOut.flush();

        // Exit once no client has been connected and no game has been running for IDLE_EXIT_MS.
        long idleSince = System.currentTimeMillis();
        while (true) {
            Thread.sleep(250);
            if (server.hasClient() || session.gameRunning()) {
                idleSince = System.currentTimeMillis();
            } else if (System.currentTimeMillis() - idleSince > IDLE_EXIT_MS) {
                System.err.println("client gone and no game running; exiting");
                session.shutdown();
                System.exit(0);
            }
        }
    }

    private static void usage() {
        System.err.println("usage: --forge <forge-gui dir> --data <dir> --token <token>");
        System.exit(2);
    }
}
