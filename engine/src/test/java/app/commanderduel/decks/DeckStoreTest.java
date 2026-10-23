package app.commanderduel.decks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import app.commanderduel.decks.DeckStore.DeckSummary;
import app.commanderduel.decks.DeckStore.Entry;
import app.commanderduel.decks.DeckStore.ImportResult;
import app.commanderduel.forge.ForgeBootstrap;
import forge.deck.Deck;
import forge.item.PaperCard;
import forge.model.FModel;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class DeckStoreTest {
    private DeckStore store;

    @BeforeAll
    static void boot() throws IOException {
        ForgeBootstrap.init(Path.of("../forge/forge-gui"), Files.createTempDirectory("cd"));
    }

    @BeforeEach
    void setUp() throws IOException {
        store = new DeckStore(Files.createTempDirectory("decks"));
    }

    /** 99 real main-deck lines taken from a bundled precon's main section. */
    private static List<Entry> realMain() {
        Deck precon = FModel.getDecks().getCommanderPrecons().iterator().next();
        List<Entry> main = new ArrayList<>();
        int total = 0;
        for (Map.Entry<PaperCard, Integer> e : precon.getMain()) {
            int n = Math.min(e.getValue(), 99 - total);
            if (n <= 0) break;
            main.add(new Entry(n, e.getKey().getName()));
            total += n;
        }
        return main;
    }

    @Test
    void importsAndListsDeck() {
        ImportResult r = store.importDeck("Atraxa Test", List.of("Atraxa, Praetors' Voice"), realMain());
        assertTrue(r.ok(), () -> r.unknownCards() + " " + r.problems());
        assertEquals(1, store.list().size());
        DeckSummary s = store.list().get(0);
        assertEquals(r.deck().id(), s.id());
        assertEquals(List.of("Atraxa, Praetors' Voice"), s.commanders());
        assertEquals(1, store.load(s.id()).getCommanders().size());
    }

    @Test
    void unknownCardsReportedByName() {
        List<Entry> main = new ArrayList<>(realMain());
        main.add(new Entry(1, "Not A Real Card"));
        ImportResult r = store.importDeck("Bad", List.of("Atraxa, Praetors' Voice"), main);
        assertFalse(r.ok());
        assertEquals(List.of("Not A Real Card"), r.unknownCards());
        assertTrue(store.list().isEmpty());
    }

    @Test
    void partnersBecomeTwoCommanders() {
        ImportResult r = store.importDeck("Partners", List.of("Thrasios, Triton Hero", "Tymna the Weaver"), realMain());
        assertTrue(r.ok());
        assertEquals(2, store.load(r.deck().id()).getCommanders().size());
    }

    @Test
    void noCommanderIsProblem() {
        ImportResult r = store.importDeck("None", List.of(), realMain());
        assertFalse(r.ok());
        assertTrue(r.problems().get(0).startsWith("No commander"));
    }

    @Test
    void splitCardFrontFaceResolves() {
        ImportResult r = store.importDeck("Split",
                List.of("Atraxa, Praetors' Voice"),
                List.of(new Entry(1, "Fire // Ice"), new Entry(1, "Fire")));
        assertTrue(r.ok(), () -> r.unknownCards().toString());
        assertTrue(r.unknownCards().isEmpty());
    }

    @Test
    void preconsListed() {
        List<DeckSummary> precons = store.precons();
        assertTrue(precons.size() >= 150);
        Deck d = store.loadPrecon(precons.get(0).id());
        assertFalse(d.getCommanders().isEmpty());
        assertNotNull(store.randomPrecon(new Random(1)));
    }

    @Test
    void illegalDeckStillSavesWithWarning() {
        ImportResult r = store.importDeck("Tiny", List.of("Atraxa, Praetors' Voice"),
                List.of(new Entry(10, "Forest")));
        assertTrue(r.ok());
        assertFalse(r.problems().isEmpty());
        assertEquals(1, store.list().size());
    }
}
