package app.commanderduel.forge;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The manipulateCardList arrangements the bridge accepts (mirrors Forge's desktop ListCardArea). */
class ManipulateRulesTest {
    private static final List<String> CARDS = List.of("a", "b", "c", "d");
    private static final Set<String> MOVABLE = Set.of("c", "d");

    private static boolean legal(List<String> result, boolean top, boolean bottom, boolean anywhere) {
        return BridgeGuiGame.isLegalArrangement(CARDS, result, MOVABLE, top, bottom, anywhere);
    }

    @Test void unchangedOrderAlwaysLegal() {
        assertTrue(legal(CARDS, false, false, false));
    }

    @Test void movableCardsMayGoOnTopOnlyWhenAllowed() {
        assertTrue(legal(List.of("d", "c", "a", "b"), true, false, false));
        assertFalse(legal(List.of("d", "c", "a", "b"), false, true, false));
    }

    @Test void movableCardsMayGoToBottomOnlyWhenAllowed() {
        assertTrue(legal(List.of("a", "b", "d", "c"), false, true, false));
        assertFalse(legal(List.of("a", "b", "d", "c"), true, false, false));
        assertTrue(legal(List.of("c", "a", "b", "d"), true, true, false));
    }

    @Test void fixedCardsKeepTheirOrderAndCannotMove() {
        assertFalse(legal(List.of("b", "a", "c", "d"), true, true, false));
        assertFalse(legal(List.of("a", "c", "b", "d"), true, true, false));
    }

    @Test void anywhereAllowsAnyOrder() {
        assertTrue(legal(List.of("b", "d", "a", "c"), false, false, true));
    }
}
