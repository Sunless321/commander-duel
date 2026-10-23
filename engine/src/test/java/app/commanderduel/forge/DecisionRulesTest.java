package app.commanderduel.forge;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import app.commanderduel.forge.BridgeGuiGame.DamageSlot;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The legality rules the bridge enforces on damage, amount, order and number answers (mirroring Forge's desktop dialogs). */
class DecisionRulesTest {
    private static final DamageSlot BLOCKER_2 = new DamageSlot(2, false);
    private static final DamageSlot BLOCKER_3 = new DamageSlot(3, false);
    private static final DamageSlot PLAYER = new DamageSlot(40, true);

    private static boolean damage(List<DamageSlot> slots, List<Integer> assigned, int total, boolean override, boolean divide) {
        return BridgeGuiGame.isLegalCombatDamage(slots, assigned, total, override, divide);
    }

    @Test void damageTotalMustBeExactAndNonNegative() {
        assertTrue(damage(List.of(BLOCKER_2), List.of(4), 4, false, false));
        assertFalse(damage(List.of(BLOCKER_2), List.of(3), 4, false, false));
        assertFalse(damage(List.of(BLOCKER_2, BLOCKER_3), List.of(5, -1), 4, false, false));
    }

    @Test void orderedBlockersNeedLethalBeforeTheNext() {
        List<DamageSlot> slots = List.of(BLOCKER_2, BLOCKER_3);
        assertTrue(damage(slots, List.of(2, 3), 5, false, false));
        assertTrue(damage(slots, List.of(5, 0), 5, false, false));
        assertFalse(damage(slots, List.of(1, 4), 5, false, false));
        assertTrue(damage(slots, List.of(1, 0), 1, false, false)); // all of too little damage on the first
    }

    @Test void overrideOrderFreesBlockersButNotTheDefender() {
        List<DamageSlot> slots = List.of(BLOCKER_2, BLOCKER_3, PLAYER);
        assertTrue(damage(slots, List.of(0, 5, 0), 5, true, false));
        assertFalse(damage(slots, List.of(0, 3, 2), 5, true, false));
        assertTrue(damage(slots, List.of(2, 3, 1), 6, true, false));
    }

    @Test void divideWithOverrideOrderAllowsAnySplit() {
        assertTrue(damage(List.of(BLOCKER_2, BLOCKER_3, PLAYER), List.of(0, 0, 5), 5, true, true));
        assertFalse(damage(List.of(BLOCKER_2, BLOCKER_3, PLAYER), List.of(0, 0, 5), 5, false, true));
    }

    @Test void trampleReachesTheDefenderOnlyAfterLethalToAllBlockers() {
        List<DamageSlot> slots = List.of(BLOCKER_2, BLOCKER_3, PLAYER);
        assertTrue(damage(slots, List.of(2, 3, 2), 7, false, false));
        assertFalse(damage(slots, List.of(2, 2, 3), 7, false, false));
        assertFalse(damage(slots, List.of(0, 0, 7), 7, false, false));
    }

    @Test void deathtouchMakesOneLethal() {
        int lethal = BridgeGuiGame.lethalDamage(4, false, 0, true);
        assertEquals(1, lethal);
        List<DamageSlot> slots = List.of(new DamageSlot(lethal, false), PLAYER);
        assertTrue(damage(slots, List.of(1, 4), 5, false, false));
        assertEquals(4, BridgeGuiGame.lethalDamage(4, false, 0, false));
        assertEquals(0, BridgeGuiGame.lethalDamage(-2, false, 0, false));
        assertEquals(3, BridgeGuiGame.lethalDamage(4, true, 3, true)); // planeswalker: its loyalty
    }

    @Test void defenderOfferedAsOnTheDesktop() {
        assertTrue(BridgeGuiGame.offersDefender(true, true, false, false)); // trample (incl. over planeswalkers)
        assertFalse(BridgeGuiGame.offersDefender(false, true, false, false));
        assertFalse(BridgeGuiGame.offersDefender(true, false, false, false));
        assertTrue(BridgeGuiGame.offersDefender(true, false, true, true)); // may divide as it chooses
        assertFalse(BridgeGuiGame.offersDefender(true, false, true, false));
    }

    @Test void amountsRespectCapsAtLeastOneAndTotal() {
        List<Integer> caps = List.of(2, 3);
        assertTrue(BridgeGuiGame.isLegalAmounts(caps, List.of(2, 2), 4, false));
        assertFalse(BridgeGuiGame.isLegalAmounts(caps, List.of(3, 1), 4, false));
        assertFalse(BridgeGuiGame.isLegalAmounts(caps, List.of(2, 1), 4, false));
        assertTrue(BridgeGuiGame.isLegalAmounts(caps, List.of(0, 3), 3, false));
        assertFalse(BridgeGuiGame.isLegalAmounts(caps, List.of(0, 3), 3, true));
        assertTrue(BridgeGuiGame.isLegalAmounts(caps, List.of(1, 2), 3, true));
    }

    @Test void orderBoundsApplyIndependently() {
        assertArrayEquals(new int[] {5, 5}, BridgeGuiGame.orderBounds(5, 0, 0));    // order everything
        assertArrayEquals(new int[] {0, 5}, BridgeGuiGame.orderBounds(5, -1, -1));  // any number
        assertArrayEquals(new int[] {0, 2}, BridgeGuiGame.orderBounds(5, 3, -1));   // many(min<0, max=2)
        assertArrayEquals(new int[] {1, 5}, BridgeGuiGame.orderBounds(5, -1, 4));   // many(min=1, max<0)
        assertArrayEquals(new int[] {1, 3}, BridgeGuiGame.orderBounds(5, 2, 4));
    }

    @Test void otherIntegerAcceptsOnlyDigitsInRange() {
        assertTrue(BridgeGuiGame.isIntegerInRange("7", 0, 10));
        assertFalse(BridgeGuiGame.isIntegerInRange("11", 0, 10));
        assertFalse(BridgeGuiGame.isIntegerInRange("5 ", 0, 10));
        assertFalse(BridgeGuiGame.isIntegerInRange("-1", -5, 10));
        assertFalse(BridgeGuiGame.isIntegerInRange("", 0, 10));
        assertFalse(BridgeGuiGame.isIntegerInRange("99999999999", 0, Integer.MAX_VALUE));
    }
}
