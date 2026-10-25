package app.commanderduel.decks;

import forge.StaticData;
import forge.deck.Deck;
import forge.deck.DeckFormat;
import forge.deck.DeckSection;
import forge.deck.io.DeckSerializer;
import forge.item.PaperCard;
import forge.model.FModel;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Random;
import java.util.stream.Stream;

/** Imports, validates, saves and lists decks as Forge .dck files; also exposes Forge's Commander precons. */
public class DeckStore {
    public record Entry(int count, String name) {}

    public record DeckSummary(String id, String name, List<String> commanders) {}

    public record ImportResult(boolean ok, DeckSummary deck, List<String> unknownCards, List<String> problems) {}

    static final String NO_COMMANDER =
            "No commander found — mark your commander in Archidekt's Commander category";

    private final Path decksDir;

    public DeckStore(Path decksDir) {
        this.decksDir = decksDir;
    }

    public ImportResult importDeck(String name, List<String> commanders, List<Entry> main) {
        List<String> unknown = new ArrayList<>();
        List<PaperCard> commanderCards = new ArrayList<>();
        for (String c : commanders) {
            PaperCard card = resolve(c);
            if (card == null) addUnique(unknown, c); else commanderCards.add(card);
        }
        List<PaperCard> mainCards = new ArrayList<>();
        for (Entry e : main) {
            PaperCard card = resolve(e.name());
            if (card == null) addUnique(unknown, e.name()); else mainCards.add(card);
        }
        if (!unknown.isEmpty()) {
            return new ImportResult(false, null, unknown, List.of());
        }
        if (commanderCards.isEmpty()) {
            return new ImportResult(false, null, List.of(), List.of(NO_COMMANDER));
        }

        String id = chooseStem(name);
        Deck deck = new Deck(name);
        for (PaperCard c : commanderCards) {
            deck.getOrCreate(DeckSection.Commander).add(c, 1);
        }
        for (int i = 0; i < main.size(); i++) {
            deck.getMain().add(mainCards.get(i), main.get(i).count());
        }
        try {
            Files.createDirectories(decksDir);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        DeckSerializer.writeDeck(deck, decksDir.resolve(id + ".dck").toFile());

        List<String> problems = new ArrayList<>();
        String problem = DeckFormat.Commander.getDeckConformanceProblem(deck);
        if (problem != null) problems.add(problem);
        return new ImportResult(true, summarize(id, deck), List.of(), problems);
    }

    public List<DeckSummary> list() {
        if (!Files.isDirectory(decksDir)) return List.of();
        try (Stream<Path> files = Files.list(decksDir)) {
            return files.filter(p -> p.getFileName().toString().endsWith(".dck"))
                    .sorted(Comparator.comparing(p -> p.getFileName().toString().toLowerCase()))
                    .map(p -> {
                        Deck d = DeckSerializer.fromFile(p.toFile());
                        return d == null ? null : summarize(stem(p), d);
                    })
                    .filter(Objects::nonNull)
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public Deck load(String id) {
        Deck d = DeckSerializer.fromFile(decksDir.resolve(sanitize(id) + ".dck").toFile());
        if (d == null) throw new IllegalArgumentException("Unknown deck: " + id);
        return d;
    }

    /** Gives a saved deck a new name; its id (file) stays the same, so nothing that refers to it breaks. */
    public DeckSummary rename(String id, String newName) {
        String name = newName == null ? "" : newName.trim();
        if (name.isEmpty()) throw new IllegalArgumentException("A deck name can't be empty");
        if (name.length() > 100) throw new IllegalArgumentException("A deck name can be at most 100 characters");
        Deck d = load(id);
        d.setName(name);
        DeckSerializer.writeDeck(d, decksDir.resolve(sanitize(id) + ".dck").toFile());
        return summarize(sanitize(id), d);
    }

    /**
     * Removes a saved deck from the list. The file is moved to {@code deleted-decks} next to the decks folder
     * rather than erased, so a deck deleted by mistake can still be recovered by hand.
     */
    public void delete(String id) {
        Path file = decksDir.resolve(sanitize(id) + ".dck");
        if (!Files.exists(file)) throw new IllegalArgumentException("Unknown deck: " + id);
        Path bin = decksDir.resolveSibling("deleted-decks");
        try {
            Files.createDirectories(bin);
            Path target = bin.resolve(file.getFileName());
            for (int n = 2; Files.exists(target); n++) {
                target = bin.resolve(sanitize(id) + "_" + n + ".dck");
            }
            Files.move(file, target);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public List<DeckSummary> precons() {
        List<DeckSummary> out = new ArrayList<>();
        for (Deck d : FModel.getDecks().getCommanderPrecons()) {
            out.add(summarize(d.getName(), d));
        }
        return out;
    }

    public Deck loadPrecon(String id) {
        Deck d = FModel.getDecks().getCommanderPrecons().get(id);
        if (d == null) throw new IllegalArgumentException("Unknown precon: " + id);
        return d;
    }

    public Deck randomPrecon(Random rnd) {
        List<DeckSummary> all = precons();
        return loadPrecon(all.get(rnd.nextInt(all.size())).id());
    }

    private static PaperCard resolve(String name) {
        var db = StaticData.instance().getCommonCards();
        String normalized = name.replace('’', '\'').replace('‘', '\'').replace('ʼ', '\'');
        PaperCard card = db.getCard(normalized);
        if (card == null) {
            int i = normalized.indexOf(" // ");
            if (i > 0) card = db.getCard(normalized.substring(0, i));
        }
        return card;
    }

    /** Reuses the stem when its file holds a deck with exactly this name; otherwise the first free stem. */
    private String chooseStem(String name) {
        String base = sanitize(name);
        String stem = base;
        for (int n = 2; Files.exists(decksDir.resolve(stem + ".dck")); n++) {
            Deck existing = DeckSerializer.fromFile(decksDir.resolve(stem + ".dck").toFile());
            // Forge's Deck constructor itself rewrites '/' to '_' in names
            if (existing != null && name.replace('/', '_').equals(existing.getName())) break;
            stem = base + "_" + n;
        }
        return stem;
    }

    private static void addUnique(List<String> list, String s) {
        if (!list.contains(s)) list.add(s);
    }

    private static DeckSummary summarize(String id, Deck d) {
        return new DeckSummary(id, d.getName(), d.getCommanders().stream().map(PaperCard::getName).toList());
    }

    private static String stem(Path p) {
        String n = p.getFileName().toString();
        return n.substring(0, n.length() - ".dck".length());
    }

    static String sanitize(String name) {
        String s = name.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", "_").replaceAll("[. ]+$", "");
        return s.isEmpty() ? "deck" : s;
    }
}
