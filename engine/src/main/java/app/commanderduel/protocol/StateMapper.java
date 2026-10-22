package app.commanderduel.protocol;

import app.commanderduel.protocol.Dto.AttackDto;
import app.commanderduel.protocol.Dto.CardDto;
import app.commanderduel.protocol.Dto.GameState;
import app.commanderduel.protocol.Dto.PlayerDto;
import app.commanderduel.protocol.Dto.StackItemDto;
import com.google.common.collect.Multiset;
import forge.StaticData;
import forge.card.CardEdition;
import forge.card.mana.ManaAtom;
import forge.game.GameEntityView;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.card.CardView.CardStateView;
import forge.game.card.CounterEnumType;
import forge.game.card.CounterType;
import forge.game.combat.CombatView;
import forge.game.player.PlayerView;
import forge.game.spellability.StackItemView;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.util.ImageUtil;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds the per-viewer JSON snapshot from Forge's GameView. Hidden information (other players'
 * hands, all libraries, cards the viewer may not see) is reduced to counts or {@code hidden} stubs.
 * Ids: players "p&lt;n&gt;", cards "c&lt;n&gt;", stack items "s&lt;n&gt;" (Forge's raw ids overlap between kinds).
 */
public final class StateMapper {
    private static final String SCRYFALL = "https://api.scryfall.com/cards/";

    private StateMapper() {}

    public static GameState map(GameView game, PlayerView viewer) {
        Map<String, CardDto> cards = new LinkedHashMap<>();
        List<PlayerDto> players = new ArrayList<>();
        String priority = null;
        for (PlayerView p : game.getPlayers()) {
            boolean you = p.equals(viewer);
            if (p.getHasPriority()) {
                priority = pid(p);
            }
            // Hand: only the viewer's own cards are ever listed. Library: never.
            List<String> hand = you ? zone(p.getHand(), viewer, cards) : List.of();
            players.add(new PlayerDto(
                    pid(p),
                    p.getName(),
                    you,
                    p.getLife(),
                    poison(p),
                    commanderDamage(game, p),
                    manaPool(p),
                    hand,
                    p.getZoneSize(ZoneType.Hand),
                    p.getZoneSize(ZoneType.Library),
                    zone(p.getGraveyard(), viewer, cards),
                    zone(p.getExile(), viewer, cards),
                    zone(p.getCommand(), viewer, cards),
                    zone(p.getBattlefield(), viewer, cards)));
        }

        List<StackItemDto> stack = new ArrayList<>();
        if (game.getStack() != null) {
            for (StackItemView item : game.getStack()) {
                stack.add(stackItem(item, viewer, cards));
            }
        }

        PlayerView active = game.getPlayerTurn();
        return new GameState(
                game.getTurn(),
                game.getPhase() == null ? null : game.getPhase().name(),
                active == null ? null : pid(active),
                priority,
                pid(viewer),
                players,
                cards,
                stack,
                combat(game.getCombat()));
    }

    static String pid(PlayerView p) {
        return "p" + p.getId();
    }

    static String cid(CardView c) {
        return "c" + c.getId();
    }

    private static int poison(PlayerView p) {
        Multiset<CounterType> counters = p.getCounters();
        return counters == null ? 0 : counters.count(CounterEnumType.POISON);
    }

    private static Map<String, Integer> commanderDamage(GameView game, PlayerView p) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (PlayerView other : game.getPlayers()) {
            List<CardView> commanders = other.getCommanders();
            if (commanders == null) {
                continue;
            }
            for (CardView commander : commanders) {
                int dmg = p.getCommanderDamage(commander);
                if (dmg > 0) {
                    out.put(cid(commander), dmg);
                }
            }
        }
        return out;
    }

    private static Map<String, Integer> manaPool(PlayerView p) {
        Map<String, Integer> out = new LinkedHashMap<>();
        String[] names = {"W", "U", "B", "R", "G", "C"};
        for (int i = 0; i < ManaAtom.MANATYPES.length; i++) {
            int amount;
            try {
                amount = p.getMana(ManaAtom.MANATYPES[i]);
            } catch (NullPointerException e) {
                amount = 0; // mana property not yet populated
            }
            out.put(names[i], amount);
        }
        return out;
    }

    private static List<String> zone(Iterable<CardView> views, PlayerView viewer, Map<String, CardDto> cards) {
        List<String> ids = new ArrayList<>();
        for (CardView cv : views) {
            ids.add(register(cv, viewer, cards));
        }
        return ids;
    }

    private static String register(CardView cv, PlayerView viewer, Map<String, CardDto> cards) {
        String id = cid(cv);
        if (!cards.containsKey(id)) {
            cards.put(id, card(cv, viewer));
        }
        return id;
    }

    private static boolean visible(CardView cv, PlayerView viewer) {
        return cv.canBeShownTo(viewer) && cv.canFaceDownBeShownTo(viewer);
    }

    private static CardDto card(CardView cv, PlayerView viewer) {
        String owner = cv.getOwner() == null ? null : pid(cv.getOwner());
        String controller = cv.getController() == null ? null : pid(cv.getController());
        String zone = cv.getZone() == null ? null : cv.getZone().name();
        if (!visible(cv, viewer)) {
            return new CardDto(cid(cv), null, owner, controller, zone, cv.isTapped(), cv.isSick(), true,
                    null, null, null, null, null, null, 0, Map.of(), null, false);
        }
        CardStateView st = cv.getCurrentState();
        Map<String, Integer> counters = new LinkedHashMap<>();
        Multiset<CounterType> raw = cv.getCounters();
        if (raw != null) {
            for (Multiset.Entry<CounterType> e : raw.entrySet()) {
                if (e.getCount() > 0) {
                    counters.put(e.getElement().getName(), e.getCount());
                }
            }
        }
        CardView attached = cv.getAttachedTo();
        boolean pt = st.isCreature() || st.isVehicle();
        return new CardDto(
                cid(cv),
                st.getName(),
                owner,
                controller,
                zone,
                cv.isTapped(),
                cv.isSick(),
                false,
                imageUrl(st),
                st.getManaCost() == null ? null : st.getManaCost().toString(),
                st.getType() == null ? null : st.getType().toString(),
                st.getOracleText(),
                pt ? String.valueOf(st.getPower()) : null,
                pt ? String.valueOf(st.getToughness()) : null,
                cv.getDamage(),
                counters,
                attached == null ? null : cid(attached),
                cv.isCommander());
    }

    /** Scryfall URL for a visible card, or null if it cannot be resolved (never throws). */
    private static String imageUrl(CardStateView st) {
        try {
            PaperCard pc = ImageUtil.getPaperCardFromImageKey(st.getImageKey());
            if (pc == null) {
                return null;
            }
            CardEdition ed = StaticData.instance().getEditions().get(pc.getEdition());
            String setCode = ed == null ? null : ed.getScryfallCode();
            return SCRYFALL + ImageUtil.getScryfallDownloadUrl(pc, "", setCode, "en", false);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static StackItemDto stackItem(StackItemView item, PlayerView viewer, Map<String, CardDto> cards) {
        CardView source = item.getSourceCard();
        String sourceId = source == null ? null : register(source, viewer, cards);
        List<String> targets = new ArrayList<>();
        if (item.getTargetCards() != null) {
            for (CardView c : item.getTargetCards()) {
                targets.add(register(c, viewer, cards));
            }
        }
        if (item.getTargetPlayers() != null) {
            for (PlayerView p : item.getTargetPlayers()) {
                targets.add(pid(p));
            }
        }
        if (item.getTargetStackItems() != null) {
            for (StackItemView s : item.getTargetStackItems()) {
                targets.add("s" + s.getId());
            }
        }
        PlayerView activator = item.getActivatingPlayer();
        return new StackItemDto("s" + item.getId(), item.getText(), sourceId,
                activator == null ? null : pid(activator), targets);
    }

    private static List<AttackDto> combat(CombatView combat) {
        List<AttackDto> out = new ArrayList<>();
        if (combat == null) {
            return out;
        }
        for (CardView attacker : combat.getAttackers()) {
            GameEntityView defender = combat.getDefender(attacker);
            String defenderId = null;
            if (defender instanceof PlayerView pv) {
                defenderId = pid(pv);
            } else if (defender instanceof CardView cv) {
                defenderId = cid(cv);
            }
            List<String> blockers = new ArrayList<>();
            if (combat.getBlockers(attacker) != null) {
                for (CardView b : combat.getBlockers(attacker)) {
                    blockers.add(cid(b));
                }
            }
            out.add(new AttackDto(cid(attacker), defenderId, blockers));
        }
        return out;
    }
}
