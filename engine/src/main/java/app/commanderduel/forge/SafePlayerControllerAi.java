package app.commanderduel.forge;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameLogEntryType;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.combat.Combat;
import forge.game.player.DelayedReveal;
import forge.game.player.Player;
import forge.game.player.PlayerActionConfirmMode;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.ZoneType;
import forge.util.ITriggerEvent;
import forge.util.collect.FCollectionView;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Forge's AI, with a safety net around its decisions. Forge's AI can throw on rare card interactions; on the game
 * thread that ends the game loop and the match freezes. Here an error in a decision is logged (engine.log and the
 * play log) and the bot makes the most conservative legal choice instead: pass, decline, or take the minimum.
 */
public class SafePlayerControllerAi extends PlayerControllerAi {
    public SafePlayerControllerAi(Game game, Player p, LobbyPlayer lp) {
        super(game, p, lp);
    }

    /** Runs one AI decision; on an error, logs it and returns {@code fallback} instead. Public for tests. */
    public <T> T guard(String decision, Supplier<T> ai, Supplier<T> fallback) {
        try {
            return ai.get();
        } catch (RuntimeException | StackOverflowError e) {
            System.err.println("bot " + player.getName() + " failed deciding " + decision + "; using a safe choice:");
            e.printStackTrace();
            try {
                player.getGame().getGameLog().add(GameLogEntryType.INFORMATION, player.getName()
                        + " hit an engine error while deciding " + decision + " and made a safe choice instead.");
            } catch (RuntimeException ignored) {
                // the log line is a courtesy
            }
            return fallback.get();
        }
    }

    private void guard(String decision, Runnable ai) {
        guard(decision, () -> {
            ai.run();
            return null;
        }, () -> null);
    }

    static <T> List<T> first(Collection<T> all, int n) {
        List<T> out = new ArrayList<>();
        for (T t : all) {
            if (out.size() >= n) {
                break;
            }
            out.add(t);
        }
        return out;
    }

    // ---------------------------------------------------------------- the main loop: what to play, combat

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        return guard("what to play", super::chooseSpellAbilityToPlay, () -> null); // null passes priority
    }

    @Override
    public boolean playChosenSpellAbility(SpellAbility sa) {
        return guard("how to play " + sa.getHostCard(), () -> super.playChosenSpellAbility(sa), () -> false);
    }

    @Override
    public void declareAttackers(Player attacker, Combat combat) {
        guard("attacks", () -> super.declareAttackers(attacker, combat));
    }

    @Override
    public void declareBlockers(Player defender, Combat combat) {
        guard("blocks", () -> super.declareBlockers(defender, combat));
    }

    // ---------------------------------------------------------------- choices made while spells and abilities resolve

    @Override
    public SpellAbility getAbilityToPlay(Card hostCard, List<SpellAbility> abilities, ITriggerEvent triggerEvent) {
        return guard("which ability of " + hostCard + " to use", () -> super.getAbilityToPlay(hostCard, abilities, triggerEvent), () -> null);
    }

    @Override
    public boolean playSaFromPlayEffect(SpellAbility tgtSA) {
        return guard("casting " + tgtSA.getHostCard() + " for free", () -> super.playSaFromPlayEffect(tgtSA), () -> false);
    }

    @Override
    public boolean chooseTargetsFor(SpellAbility currentAbility) {
        return guard("targets for " + currentAbility.getHostCard(), () -> super.chooseTargetsFor(currentAbility), () -> false);
    }

    @Override
    public Integer announceRequirements(SpellAbility ability, int min, int max, String announce) {
        return guard("a number for " + ability.getHostCard(), () -> super.announceRequirements(ability, min, max, announce), () -> min);
    }

    @Override
    public boolean confirmAction(SpellAbility sa, PlayerActionConfirmMode mode, String message, List<String> options,
                                 Card cardToShow, Map<String, Object> params) {
        return guard("whether to use an optional effect", () -> super.confirmAction(sa, mode, message, options, cardToShow, params), () -> false);
    }

    @Override
    public boolean confirmTrigger(WrappedAbility wrapper) {
        return guard("whether to use a trigger", () -> super.confirmTrigger(wrapper), () -> false);
    }

    @Override
    public CardCollectionView choosePermanentsToSacrifice(SpellAbility sa, int min, int max, CardCollectionView validTargets, String message) {
        return guard("what to sacrifice", () -> super.choosePermanentsToSacrifice(sa, min, max, validTargets, message),
                () -> new CardCollection(first(validTargets, min)));
    }

    @Override
    public CardCollectionView chooseCardsForEffect(CardCollectionView sourceList, SpellAbility sa, String title, int min, int max,
                                                   boolean isOptional, Map<String, Object> params) {
        return guard("which cards to choose", () -> super.chooseCardsForEffect(sourceList, sa, title, min, max, isOptional, params),
                () -> new CardCollection(first(sourceList, isOptional ? 0 : min)));
    }

    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(FCollectionView<T> optionList, DelayedReveal delayedReveal, SpellAbility sa,
                                                                String title, boolean isOptional, Player targetedPlayer, Map<String, Object> params) {
        return guard("a choice for " + (sa == null ? "an effect" : sa.getHostCard()),
                () -> super.chooseSingleEntityForEffect(optionList, delayedReveal, sa, title, isOptional, targetedPlayer, params),
                () -> isOptional || optionList.isEmpty() ? null : optionList.get(0));
    }

    @Override
    public <T extends GameEntity> List<T> chooseEntitiesForEffect(FCollectionView<T> optionList, int min, int max, DelayedReveal delayedReveal,
                                                                  SpellAbility sa, String title, Player targetedPlayer, Map<String, Object> params) {
        return guard("choices for " + (sa == null ? "an effect" : sa.getHostCard()),
                () -> super.chooseEntitiesForEffect(optionList, min, max, delayedReveal, sa, title, targetedPlayer, params),
                () -> first(optionList, min));
    }

    @Override
    public List<SpellAbility> chooseSpellAbilitiesForEffect(List<SpellAbility> spells, SpellAbility sa, String title, int num,
                                                            Map<String, Object> params) {
        return guard("which spells to pick", () -> super.chooseSpellAbilitiesForEffect(spells, sa, title, num, params),
                () -> first(spells, num));
    }

    @Override
    public SpellAbility chooseSingleSpellForEffect(List<SpellAbility> spells, SpellAbility sa, String title, Map<String, Object> params) {
        return guard("which spell to pick", () -> super.chooseSingleSpellForEffect(spells, sa, title, params),
                () -> spells.isEmpty() ? null : spells.get(0));
    }

    @Override
    public List<AbilitySub> chooseModeForAbility(SpellAbility sa, List<AbilitySub> possible, int min, int num, boolean allowRepeat) {
        return guard("modes for " + sa.getHostCard(), () -> super.chooseModeForAbility(sa, possible, min, num, allowRepeat),
                () -> first(possible, min));
    }

    @Override
    public CardCollectionView orderMoveToZoneList(CardCollectionView cards, ZoneType destinationZone, SpellAbility source) {
        return guard("card order", () -> super.orderMoveToZoneList(cards, destinationZone, source), () -> cards);
    }

    @Override
    public CardCollection chooseCardsToDiscardFrom(Player p, SpellAbility sa, CardCollection validCards, int min, int max,
                                                   CardCollectionView visibleToChooser) {
        return guard("what to discard", () -> super.chooseCardsToDiscardFrom(p, sa, validCards, min, max, visibleToChooser),
                () -> new CardCollection(first(validCards, min)));
    }

    @Override
    public String chooseSomeType(String kindOfType, SpellAbility sa, Collection<String> validTypes, boolean isOptional) {
        return guard("a " + kindOfType + " type", () -> super.chooseSomeType(kindOfType, sa, validTypes, isOptional),
                () -> isOptional || validTypes.isEmpty() ? null : validTypes.iterator().next());
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, int min, int max) {
        return guard("a number", () -> super.chooseNumber(sa, title, min, max), () -> min);
    }

    @Override
    public int chooseNumber(SpellAbility sa, String string, int min, int max, Map<String, Object> params) {
        return guard("a number", () -> super.chooseNumber(sa, string, min, max, params), () -> min);
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, List<Integer> options, Player relatedPlayer) {
        return guard("a number", () -> super.chooseNumber(sa, title, options, relatedPlayer), () -> options.isEmpty() ? 0 : options.get(0));
    }
}
