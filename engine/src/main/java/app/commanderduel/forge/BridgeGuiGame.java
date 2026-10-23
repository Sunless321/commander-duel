package app.commanderduel.forge;

import app.commanderduel.protocol.Json;
import app.commanderduel.protocol.PendingRequests;
import app.commanderduel.protocol.PendingRequests.Pending;
import app.commanderduel.protocol.PendingRequests.PendingValue;
import app.commanderduel.protocol.PendingRequests.Result;
import app.commanderduel.protocol.StateMapper;
import app.commanderduel.transport.Transport;
import forge.LobbyPlayer;
import forge.card.MagicColor;
import forge.deck.CardPool;
import forge.game.Game;
import forge.game.GameEntityView;
import forge.game.GameOutcome;
import forge.game.GameStage;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.card.CounterEnumType;
import forge.game.phase.PhaseType;
import forge.game.player.DelayedReveal;
import forge.game.player.IHasIcon;
import forge.game.player.PlayerView;
import forge.game.player.RegisteredPlayer;
import forge.game.player.PlayerStatistics;
import forge.game.spellability.SpellAbilityView;
import forge.game.spellability.StackItemView;
import forge.gamemodes.match.Selection;
import forge.gamemodes.match.input.Input;
import forge.gamemodes.match.input.InputAttack;
import forge.gamemodes.match.input.InputBlock;
import forge.gamemodes.match.input.InputConfirm;
import forge.gamemodes.match.input.InputConfirmMulligan;
import forge.gamemodes.match.input.InputLockUI;
import forge.gamemodes.match.input.InputLondonMulligan;
import forge.gamemodes.match.input.InputPassPriority;
import forge.gamemodes.match.input.InputPayMana;
import forge.gamemodes.match.input.InputSelectManyBase;
import forge.gamemodes.match.input.InputSelectStackItems;
import forge.gamemodes.match.input.InputSelectTargets;
import forge.gamemodes.net.NetworkGuiGame;
import forge.gui.GuiBase;
import forge.interfaces.IGameController;
import forge.item.PaperCard;
import forge.localinstance.skin.FSkinProp;
import forge.player.PlayerControllerHuman;
import forge.player.PlayerZoneUpdate;
import forge.trackable.TrackableCollection;
import forge.trackable.TrackableObject;
import forge.trackable.TrackableTypes;
import forge.util.FSerializableFunction;
import forge.util.ITriggerEvent;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

/**
 * The engine side of the UI. Every Forge notification becomes a JSON message on the {@link Transport};
 * every blocking Forge decision becomes a {@code request} whose answer can only be one of the options
 * Forge offered (validated by {@link PendingRequests}), mapped back to the very objects Forge passed.
 *
 * <p>Threads: blocking decisions park the calling Forge thread on a future. UI actions are relayed to
 * Forge's {@link IGameController} on a dedicated action thread (as Forge's own netplay host does on a
 * background thread), never on the EDT, so a decision Forge raises while handling a click (e.g. which
 * ability to play) blocks that thread rather than the EDT. State snapshots are built on a scheduler thread.
 */
public class BridgeGuiGame extends NetworkGuiGame {
    private static final long STATE_DEBOUNCE_MS = 50;
    private static final int MAX_STATE_RETRIES = 10;

    private final Transport out;
    private final PendingRequests pending;
    private final ScheduledThreadPoolExecutor scheduler = new ScheduledThreadPoolExecutor(1, daemon("bridge-state"));
    private final ThreadPoolExecutor actions =
            new ThreadPoolExecutor(1, 1, 5, TimeUnit.SECONDS, new LinkedBlockingQueue<>(), daemon("bridge-actions"));

    private volatile PlayerView you;
    private final AtomicBoolean stateScheduled = new AtomicBoolean();
    private final AtomicInteger stateFailures = new AtomicInteger();
    private final AtomicBoolean gameOverSent = new AtomicBoolean();

    private final Object promptLock = new Object();
    private String promptMessage = "";
    private String okLabel = "";
    private String cancelLabel = "";
    private boolean okEnabled;
    private boolean cancelEnabled;
    private boolean promptScheduled;

    public BridgeGuiGame(Transport out, PendingRequests pending) {
        this.out = out;
        this.pending = pending;
        scheduler.setKeepAliveTime(5, TimeUnit.SECONDS);
        scheduler.allowCoreThreadTimeOut(true);
        actions.allowCoreThreadTimeOut(true);
    }

    private static java.util.concurrent.ThreadFactory daemon(String name) {
        return r -> {
            Thread t = new Thread(r, name);
            t.setDaemon(true);
            return t;
        };
    }

    // ---------------------------------------------------------------- UI -> engine

    /** Relays a UI action to the human's game controller. Unknown actions, ids or colors are rejected. */
    public void onAction(String action, String id, String color) {
        IGameController controller = you == null ? null : getGameController(you);
        GameView game = getGameView();
        if (controller == null || game == null) {
            reject(null, "no game in progress");
            return;
        }
        switch (String.valueOf(action)) {
            case "selectCard" -> {
                CardView card = findCard(game, id);
                if (card == null) {
                    reject(null, "unknown card: " + id);
                    return;
                }
                actions.execute(() -> controller.selectCard(card, null, null));
            }
            case "selectPlayer" -> {
                PlayerView player = findPlayer(game, id);
                if (player == null) {
                    reject(null, "unknown player: " + id);
                    return;
                }
                actions.execute(() -> controller.selectPlayer(player, null));
            }
            case "selectStackItem" -> {
                StackItemView item = findStackItem(game, id);
                if (item == null) {
                    reject(null, "unknown stack item: " + id);
                    return;
                }
                actions.execute(() -> controller.selectStackItem(item));
            }
            case "ok" -> actions.execute(controller::selectButtonOk);
            case "cancel" -> actions.execute(controller::selectButtonCancel);
            case "useMana" -> {
                Byte mana = manaColor(color);
                if (mana == null) {
                    reject(null, "unknown mana color: " + color);
                    return;
                }
                actions.execute(() -> controller.useMana(mana));
            }
            // Not queued behind the action thread, which may be parked on an open request.
            case "concede" -> CompletableFuture.runAsync(() -> {
                controller.concede();
                Game host = game.getGame();
                if (host == null || host.isGameOver()) {
                    pending.cancelAll(); // release a game thread parked on a request so the game can finish
                }
            }, scheduler);
            default -> reject(null, "unknown action: " + action);
        }
    }

    /** Answers an option request; anything Forge did not offer is rejected and the request stays open. */
    public void onAnswer(String requestId, List<String> optionIds) {
        Result r = pending.answer(requestId, optionIds);
        if (!r.ok()) {
            reject(requestId, r.reason());
        }
    }

    /** Answers a value request (integer, text, damage/amount map). */
    public void onAnswerValue(String requestId, Object value) {
        Result r = pending.answerValue(requestId, value);
        if (!r.ok()) {
            reject(requestId, r.reason());
        }
    }

    private static CardView findCard(GameView game, String id) {
        Integer n = parseId(id, 'c');
        return n == null || game.getTracker() == null ? null : game.getTracker().getObj(TrackableTypes.CardViewType, n);
    }

    private static PlayerView findPlayer(GameView game, String id) {
        Integer n = parseId(id, 'p');
        if (n == null || game.getPlayers() == null) {
            return null;
        }
        for (PlayerView p : game.getPlayers()) {
            if (p.getId() == n) {
                return p;
            }
        }
        return null;
    }

    private static StackItemView findStackItem(GameView game, String id) {
        Integer n = parseId(id, 's');
        if (n == null || game.getStack() == null) {
            return null;
        }
        for (StackItemView s : game.getStack()) {
            if (s.getId() == n) {
                return s;
            }
        }
        return null;
    }

    private static Integer parseId(String id, char prefix) {
        if (id == null || id.length() < 2 || id.charAt(0) != prefix) {
            return null;
        }
        try {
            return Integer.parseInt(id.substring(1));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Byte manaColor(String color) {
        if (color == null) {
            return null;
        }
        return switch (color) {
            case "W" -> MagicColor.WHITE;
            case "U" -> MagicColor.BLUE;
            case "B" -> MagicColor.BLACK;
            case "R" -> MagicColor.RED;
            case "G" -> MagicColor.GREEN;
            case "C" -> MagicColor.COLORLESS;
            default -> null;
        };
    }

    // ---------------------------------------------------------------- ids and sending

    private static String idOf(Object o) {
        if (o instanceof CardView c) {
            return "c" + c.getId();
        }
        if (o instanceof PlayerView p) {
            return "p" + p.getId();
        }
        if (o instanceof StackItemView s) {
            return "s" + s.getId();
        }
        if (o instanceof SpellAbilityView sa && sa.getHostCard() != null) {
            return "c" + sa.getHostCard().getId();
        }
        return null;
    }

    private void send(Map<String, Object> msg) {
        String json = Json.GSON.toJson(msg);
        synchronized (out) {
            out.send(json);
        }
    }

    private static Map<String, Object> msg(String type) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", type);
        return m;
    }

    private void reject(String requestId, String reason) {
        Map<String, Object> m = msg("rejected");
        m.put("requestId", requestId);
        m.put("reason", reason);
        send(m);
    }

    // ---------------------------------------------------------------- state snapshots

    private void scheduleState() {
        if (stateScheduled.compareAndSet(false, true)) {
            scheduler.schedule(this::sendState, STATE_DEBOUNCE_MS, TimeUnit.MILLISECONDS);
        }
    }

    private void sendState() {
        stateScheduled.set(false); // notifications from here on schedule a fresh snapshot
        GameView game = getGameView();
        PlayerView viewer = you;
        if (game == null || viewer == null) {
            return;
        }
        Game host = game.getGame();
        if (host != null && host.getAge() == GameStage.BeforeMulligan) {
            scheduleState(); // zones and commanders are not dealt yet
            return;
        }
        Map<String, Object> m = msg("state");
        try {
            m.put("state", StateMapper.map(game, viewer));
        } catch (RuntimeException e) {
            // The game thread mutates the views while we read them; take another snapshot shortly.
            if (stateFailures.incrementAndGet() <= MAX_STATE_RETRIES) {
                scheduleState();
            } else {
                stateFailures.set(0);
                sendError("state snapshot failed: " + e);
            }
            return;
        }
        stateFailures.set(0);
        send(m);
    }

    private void sendError(String message) {
        Map<String, Object> m = msg("error");
        m.put("message", message);
        send(m);
    }

    @Override
    public void setGameView(GameView gameView) {
        super.setGameView(gameView);
        scheduleState();
    }

    @Override
    public void openView(TrackableCollection<PlayerView> myPlayers) {
        if (myPlayers != null && !myPlayers.isEmpty()) {
            you = myPlayers.iterator().next();
        }
        scheduleState();
    }

    @Override protected void updateCurrentPlayer(PlayerView player) { }
    @Override public void showCombat() { scheduleState(); }
    @Override public void updatePhase(boolean saveState) { scheduleState(); }
    @Override public void updateTurn(PlayerView player) { scheduleState(); }
    @Override public void updatePlayerControl() { scheduleState(); }
    @Override public void updateStack() { scheduleState(); }
    @Override public void updateZones(Iterable<PlayerZoneUpdate> zonesToUpdate) { scheduleState(); }
    @Override public void updateCards(Iterable<CardView> cards) { scheduleState(); }
    @Override public void refreshCardDetails(Iterable<CardView> cards) { scheduleState(); }
    @Override public void refreshField() { scheduleState(); }
    @Override public void updateManaPool(Iterable<PlayerView> manaPoolUpdate) { scheduleState(); }
    @Override public void updateLives(Iterable<PlayerView> livesUpdate) { scheduleState(); }
    @Override public void handleLandPlayed(CardView land) { scheduleState(); }
    @Override public void showManaPool(PlayerView player) { scheduleState(); }
    @Override public void hideManaPool(PlayerView player) { scheduleState(); }

    @Override
    public void updateRevealedCards(TrackableCollection<CardView> collection) {
        super.updateRevealedCards(collection);
        scheduleState();
    }

    @Override
    public boolean isUiSetToSkipPhase(PlayerView playerTurn, PhaseType phase) {
        return false;
    }

    // ---------------------------------------------------------------- prompt, selection, playable

    @Override
    public void showPromptMessage(PlayerView playerView, String message, CardView card) {
        synchronized (promptLock) {
            promptMessage = message == null ? "" : message;
            schedulePromptLocked();
        }
    }

    @Override
    public void updateButtons(PlayerView owner, String label1, String label2, boolean enable1, boolean enable2, boolean focus1) {
        synchronized (promptLock) {
            okLabel = label1;
            cancelLabel = label2;
            okEnabled = enable1;
            cancelEnabled = enable2;
            schedulePromptLocked();
        }
    }

    /** Forge sets message and buttons in two calls (in either order) from one EDT task: send one prompt after it. */
    private void schedulePromptLocked() {
        if (!promptScheduled) {
            promptScheduled = true;
            GuiBase.getInterface().invokeInEdtLater(this::sendPrompt);
        }
    }

    private void sendPrompt() {
        Map<String, Object> m = msg("prompt");
        synchronized (promptLock) {
            promptScheduled = false;
            m.put("message", promptMessage);
            m.put("inputKind", inputKind());
            m.put("ok", button(okLabel, okEnabled));
            m.put("cancel", button(cancelLabel, cancelEnabled));
        }
        send(m);
    }

    private static Map<String, Object> button(String label, boolean enabled) {
        if (label == null || label.isEmpty()) {
            return null;
        }
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("label", label);
        b.put("enabled", enabled);
        return b;
    }

    private String inputKind() {
        IGameController controller = you == null ? null : getGameController(you);
        Input input = controller instanceof PlayerControllerHuman pch ? pch.getInputProxy().getInput() : null;
        if (input == null || input instanceof InputLockUI) {
            return "wait";
        }
        if (input instanceof InputPassPriority) {
            return "priority";
        }
        if (input instanceof InputConfirmMulligan || input instanceof InputLondonMulligan) {
            return "mulligan";
        }
        if (input instanceof InputAttack) {
            return "attack";
        }
        if (input instanceof InputBlock) {
            return "block";
        }
        if (input instanceof InputPayMana) {
            return "payMana";
        }
        if (input instanceof InputSelectTargets) {
            return "target";
        }
        if (input instanceof InputSelectManyBase || input instanceof InputSelectStackItems) {
            return "select";
        }
        return "other";
    }

    @Override
    public void setSelection(Selection next) {
        super.setSelection(next);
        Set<String> selectable = new LinkedHashSet<>();
        for (CardView c : next.cards()) {
            selectable.add(idOf(c));
        }
        for (TrackableObject t : next.targets()) {
            String id = idOf(t);
            if (id != null) {
                selectable.add(id);
            }
        }
        Set<String> chosen = new LinkedHashSet<>();
        for (TrackableObject t : next.chosen()) {
            String id = idOf(t);
            if (id != null) {
                chosen.add(id);
            }
        }
        Map<String, Object> m = msg("selection");
        m.put("selectable", new ArrayList<>(selectable));
        m.put("chosen", new ArrayList<>(chosen));
        m.put("min", next.min());
        m.put("max", next.max());
        send(m);
    }

    @Override
    public void setWeaklySelectable(Iterable<CardView> cards) {
        super.setWeaklySelectable(cards);
        Set<String> ids = new LinkedHashSet<>();
        for (CardView c : cards) {
            ids.add(idOf(c));
        }
        sendPlayable(new ArrayList<>(ids));
    }

    @Override
    public void clearWeaklySelectable() {
        super.clearWeaklySelectable();
        sendPlayable(List.of());
    }

    private void sendPlayable(List<String> cardIds) {
        Map<String, Object> m = msg("playable");
        m.put("cardIds", cardIds);
        send(m);
    }

    // ---------------------------------------------------------------- non-blocking dialogs

    @Override
    public void message(String message, String title) {
        Map<String, Object> m = msg("info");
        m.put("title", title);
        m.put("message", message);
        send(m);
    }

    @Override
    public void showErrorDialog(String message, String title) {
        sendError(message);
    }

    @Override public void flashIncorrectAction() { }
    @Override public void alertUser() { }
    @Override public void setPanelSelection(CardView hostCard) { }
    @Override public void setCard(CardView card) { }
    @Override public void setPlayerAvatar(LobbyPlayer player, IHasIcon ihi) { }

    // ---------------------------------------------------------------- game over

    @Override
    public void finishGame() {
        sendGameOver();
        pending.cancelAll();
        scheduleState();
    }

    @Override
    public void afterGameEnd() {
        super.afterGameEnd();
        sendGameOver();
        pending.cancelAll();
    }

    private void sendGameOver() {
        GameView game = getGameView();
        if (game == null || !game.isGameOver() || !gameOverSent.compareAndSet(false, true)) {
            return;
        }
        List<String> winners = new ArrayList<>();
        boolean youWon = false;
        GameOutcome outcome = game.getOutcome();
        if (outcome != null) {
            for (Entry<RegisteredPlayer, PlayerStatistics> e : outcome) {
                RegisteredPlayer rp = e.getKey();
                if (outcome.isWinner(rp)) {
                    winners.add(rp.getPlayer().getName());
                    if (you != null && you.isLobbyPlayer(rp.getPlayer())) {
                        youWon = true;
                    }
                }
            }
        }
        Map<String, Object> m = msg("gameOver");
        m.put("winnerNames", winners);
        m.put("youWon", youWon);
        send(m);
    }

    // ---------------------------------------------------------------- blocking decisions

    private record Option(String id, String label, String cardId) {}

    /** Opens an option request, sends it, and parks the calling Forge thread until it is answered. */
    private <T> List<T> ask(String kind, String title, String message, List<T> options, Function<T, String> label,
                            int min, int max, Map<String, Object> extras, Predicate<List<T>> validator) {
        Pending<T> p = pending.open(kind, options, min, max, validator);
        List<Option> wire = new ArrayList<>(options.size());
        for (int i = 0; i < options.size(); i++) {
            T o = options.get(i);
            wire.add(new Option(p.optionIds().get(i), label.apply(o), idOf(o)));
        }
        Map<String, Object> m = request(p.requestId(), kind, title, message, wire, min, max, extras);
        send(m);
        // If the game ends while we wait, give Forge the smallest legal answer it offered.
        return await(p.future(), () -> new ArrayList<>(options.subList(0, min)));
    }

    /** Opens a value request (integer, text, amounts) and parks the calling Forge thread until it is answered. */
    private <R> R askValue(String kind, Class<R> type, Predicate<R> validator, String title, String message,
                           List<Option> options, int min, int max, Map<String, Object> extras, Supplier<R> onCancel) {
        PendingValue<R> p = pending.openValue(kind, type, validator);
        send(request(p.requestId(), kind, title, message, options, min, max, extras));
        return await(p.future(), onCancel);
    }

    private static Map<String, Object> request(String requestId, String kind, String title, String message,
                                               List<Option> options, int min, int max, Map<String, Object> extras) {
        Map<String, Object> m = msg("request");
        m.put("requestId", requestId);
        m.put("kind", kind);
        m.put("title", title == null ? "" : title);
        m.put("message", message == null ? "" : message);
        m.put("options", options);
        m.put("min", min);
        m.put("max", max);
        m.put("extras", extras == null ? Map.of() : extras);
        return m;
    }

    private static <V> V await(CompletableFuture<V> future, Supplier<V> onCancel) {
        try {
            return future.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return onCancel.get();
        } catch (ExecutionException | java.util.concurrent.CancellationException e) {
            return onCancel.get();
        }
    }

    private static <T> String labelOf(T o, FSerializableFunction<T, String> display) {
        return display != null ? display.apply(o) : String.valueOf(o);
    }

    private static List<String> optionIdsOf(List<?> all, List<?> subset) {
        List<String> ids = new ArrayList<>();
        if (subset != null) {
            for (Object o : subset) {
                int i = indexOfIdentity(all, o);
                if (i >= 0) {
                    ids.add("o" + i);
                }
            }
        }
        return ids;
    }

    private static int indexOfIdentity(List<?> list, Object o) {
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i) == o) {
                return i;
            }
        }
        return list.indexOf(o);
    }

    @Override
    public <T> List<T> getChoices(String message, int min, int max, List<T> choices, List<T> selected,
                                  FSerializableFunction<T, String> display) {
        if (choices == null || choices.isEmpty()) {
            return new ArrayList<>();
        }
        int lo;
        int hi;
        if (min == -1 && max == -1) { // reveal only: acknowledged with no options picked
            lo = 0;
            hi = 0;
        } else {
            hi = max < 0 ? choices.size() : Math.min(max, choices.size());
            lo = Math.max(0, Math.min(min, hi));
        }
        Map<String, Object> extras = new LinkedHashMap<>();
        extras.put("selected", optionIdsOf(choices, selected));
        extras.put("reveal", min == -1 && max == -1);
        return ask("choose", message, message, choices, o -> labelOf(o, display), lo, hi, extras, chosen -> true);
    }

    @Override
    public <T> OrderResult<T> order(String title, String top, int remainingObjectsMin, int remainingObjectsMax,
                                    List<T> sourceChoices, List<T> destChoices, CardView referenceCard,
                                    boolean sideboardingMode, boolean showRememberCheckbox) {
        List<T> all = new ArrayList<>();
        if (sourceChoices != null) {
            all.addAll(sourceChoices);
        }
        if (destChoices != null) {
            all.addAll(destChoices);
        }
        int n = all.size();
        // Forge bounds how many objects may stay unchosen; the answer is the chosen list, in order.
        int lo = 0;
        int hi = n;
        if (remainingObjectsMax >= 0) {
            lo = Math.max(0, n - remainingObjectsMax);
            hi = Math.min(n, n - Math.max(0, remainingObjectsMin));
        }
        Map<String, Object> extras = new LinkedHashMap<>();
        extras.put("ordered", true);
        extras.put("top", top);
        extras.put("selected", optionIdsOf(all, destChoices));
        extras.put("cardId", idOf(referenceCard));
        List<T> ordered = ask("order", title, top, all, String::valueOf, lo, hi, extras, chosen -> true);
        return new OrderResult<>(ordered, false);
    }

    @Override
    public boolean confirm(CardView c, String question, boolean defaultIsYes, List<String> options) {
        List<String> labels = options == null || options.isEmpty() ? InputConfirm.defaultOptions : options;
        Map<String, Object> extras = new LinkedHashMap<>();
        extras.put("default", defaultIsYes ? 0 : 1);
        extras.put("cardId", idOf(c));
        String title = c == null ? "Question" : c + " - Ability";
        return chooseIndex(title, question, labels, extras) == 0;
    }

    @Override
    public boolean showConfirmDialog(String message, String title, String yesButtonText, String noButtonText, boolean defaultYes) {
        Map<String, Object> extras = new LinkedHashMap<>();
        extras.put("default", defaultYes ? 0 : 1);
        return chooseIndex(title, message, List.of(yesButtonText, noButtonText), extras) == 0;
    }

    @Override
    public int showOptionDialog(String message, String title, FSkinProp icon, List<String> options, int defaultOption) {
        Map<String, Object> extras = new LinkedHashMap<>();
        extras.put("default", defaultOption);
        return chooseIndex(title, message, options, extras);
    }

    /** A "confirm" request over button labels; returns the index of the chosen button. */
    private int chooseIndex(String title, String message, List<String> labels, Map<String, Object> extras) {
        if (labels.isEmpty()) {
            return extras.get("default") instanceof Integer d ? d : 0;
        }
        List<Integer> indexes = new ArrayList<>();
        for (int i = 0; i < labels.size(); i++) {
            indexes.add(i);
        }
        int fallback = extras.get("default") instanceof Integer d && d >= 0 && d < labels.size() ? d : 0;
        Pending<Integer> p = pending.open("confirm", indexes, 1, 1);
        List<Option> wire = new ArrayList<>();
        for (int i = 0; i < labels.size(); i++) {
            wire.add(new Option(p.optionIds().get(i), labels.get(i), null));
        }
        send(request(p.requestId(), "confirm", title, message, wire, 1, 1, extras));
        return await(p.future(), () -> List.of(fallback)).get(0);
    }

    @Override
    public String showInputDialog(String message, String title, FSkinProp icon, String initialInput,
                                  List<String> inputOptions, boolean isNumeric) {
        List<String> allowed = inputOptions == null ? List.of() : List.copyOf(inputOptions);
        List<Option> wire = new ArrayList<>();
        for (int i = 0; i < allowed.size(); i++) {
            wire.add(new Option("o" + i, allowed.get(i), null));
        }
        Map<String, Object> extras = new LinkedHashMap<>();
        extras.put("initial", initialInput);
        extras.put("numeric", isNumeric);
        Predicate<String> valid = text -> {
            if (!allowed.isEmpty() && !allowed.contains(text)) {
                return false;
            }
            if (isNumeric) {
                try {
                    Integer.parseInt(text.trim());
                } catch (NumberFormatException e) {
                    return false;
                }
            }
            return true;
        };
        return askValue("text", String.class, valid, title, message, wire, 0, 0, extras, () -> null);
    }

    @Override
    public SpellAbilityView getAbilityToPlay(CardView hostCard, List<SpellAbilityView> abilities, ITriggerEvent triggerEvent) {
        // As the desktop does without a mouse event: nothing to ask with zero or one playable ability.
        if (abilities == null || abilities.isEmpty()) {
            return null;
        }
        if (abilities.size() == 1) {
            return abilities.get(0);
        }
        Map<String, Object> extras = new LinkedHashMap<>();
        extras.put("cardId", idOf(hostCard));
        List<SpellAbilityView> chosen = ask("ability", String.valueOf(hostCard), "Choose ability to play",
                abilities, String::valueOf, 0, 1, extras, c -> true);
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public GameEntityView chooseSingleEntityForEffect(String title, List<? extends GameEntityView> optionList,
                                                      DelayedReveal delayedReveal, boolean isOptional) {
        revealFirst(delayedReveal);
        if (optionList == null || optionList.isEmpty()) {
            return null;
        }
        if (!isOptional && optionList.size() == 1) {
            return optionList.get(0); // as one() does: no choice to make
        }
        List<GameEntityView> chosen = ask("entity", title, title, new ArrayList<>(optionList), String::valueOf,
                isOptional ? 0 : 1, 1, new LinkedHashMap<>(), c -> true);
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public List<GameEntityView> chooseEntitiesForEffect(String title, List<? extends GameEntityView> optionList,
                                                        int min, int max, DelayedReveal delayedReveal) {
        revealFirst(delayedReveal);
        if (optionList == null || optionList.isEmpty()) {
            return new ArrayList<>();
        }
        int hi = max < 0 ? optionList.size() : Math.min(max, optionList.size());
        int lo = Math.max(0, Math.min(min, hi));
        return ask("entity", title, title, new ArrayList<>(optionList), String::valueOf, lo, hi,
                new LinkedHashMap<>(), c -> true);
    }

    private void revealFirst(DelayedReveal delayedReveal) {
        if (delayedReveal != null) {
            reveal(delayedReveal.getMessagePrefix(), new ArrayList<>(delayedReveal.getCards()));
        }
    }

    @Override
    public List<CardView> manipulateCardList(String title, Iterable<CardView> cards, Iterable<CardView> manipulable,
                                             boolean toTop, boolean toBottom, boolean toAnywhere) {
        List<CardView> all = new ArrayList<>();
        cards.forEach(all::add);
        if (all.isEmpty()) {
            return all;
        }
        Set<CardView> movable = new java.util.HashSet<>();
        manipulable.forEach(movable::add);
        List<String> movableIds = new ArrayList<>();
        for (int i = 0; i < all.size(); i++) {
            if (movable.contains(all.get(i))) {
                movableIds.add("o" + i);
            }
        }
        Map<String, Object> extras = new LinkedHashMap<>();
        extras.put("manipulable", movableIds);
        extras.put("toTop", toTop);
        extras.put("toBottom", toBottom);
        extras.put("toAnywhere", toAnywhere);
        return ask("manipulate", title, title, all, String::valueOf, all.size(), all.size(), extras,
                result -> isLegalArrangement(all, result, movable, toTop, toBottom, toAnywhere));
    }

    /**
     * The arrangements Forge's desktop list allows: with toAnywhere any order; otherwise movable cards may
     * be gathered on top (toTop) and/or at the bottom (toBottom) while every other card keeps its order.
     */
    static <T> boolean isLegalArrangement(List<T> original, List<T> result, Set<T> movable,
                                          boolean toTop, boolean toBottom, boolean toAnywhere) {
        if (toAnywhere) {
            return true;
        }
        int top = 0;
        if (toTop) {
            while (top < result.size() && movable.contains(result.get(top))) {
                top++;
            }
        }
        for (int t = top; t >= 0; t--) { // try every split of a movable top block
            int bottom = result.size();
            if (toBottom) {
                while (bottom > t && movable.contains(result.get(bottom - 1))) {
                    bottom--;
                }
            }
            for (int b = bottom; b <= result.size(); b++) {
                List<T> middle = result.subList(t, b);
                Set<T> moved = new java.util.HashSet<>(result.subList(0, t));
                moved.addAll(result.subList(b, result.size()));
                List<T> expected = new ArrayList<>();
                for (T o : original) {
                    if (!moved.contains(o)) {
                        expected.add(o);
                    }
                }
                if (expected.equals(middle)) {
                    return true;
                }
            }
        }
        return false;
    }

    // ---------------------------------------------------------------- damage and amount division

    /** A row of a damage/amount request: the original key Forge passed, its wire id, cap and lethal damage. */
    private record Target(Object key, String id, Map<String, Object> wire, int max, int lethal, boolean defender) {}

    @Override
    public Map<CardView, Integer> assignCombatDamage(CardView attacker, List<CardView> blockers, int damage,
                                                     GameEntityView defender, boolean overrideOrder, boolean maySkip) {
        // Mirrors forge-gui-desktop VAssignCombatDamage: who may receive damage and in which order.
        boolean deathtouch = attacker.getCurrentState().hasDeathtouch();
        boolean infect = attacker.getCurrentState().hasInfect();
        boolean trample = defender != null && attacker.getCurrentState().hasTrample();
        boolean divide = attacker.getCurrentState().hasDivideDamage();
        List<Target> targets = new ArrayList<>();
        for (CardView b : blockers) {
            targets.add(target(b, idOf(b), String.valueOf(b), damage, lethalFor(b, deathtouch), false));
        }
        if (trample || (divide && overrideOrder)) {
            targets.add(target(null, idOf(defender), String.valueOf(defender), damage, defenderLethal(defender, infect), true));
        }
        boolean freeOrder = overrideOrder && divide;
        Predicate<Map<String, Integer>> rules = amounts -> {
            if (sum(amounts) != damage) {
                return false;
            }
            if (freeOrder) {
                return true;
            }
            boolean aliveBefore = false; // a target before this one is not yet dealt lethal damage
            for (Target t : targets) {
                int dmg = amounts.getOrDefault(t.id(), 0);
                if (aliveBefore && (!overrideOrder || t.defender())) {
                    if (dmg != 0) {
                        return false;
                    }
                } else {
                    aliveBefore |= dmg < t.lethal();
                }
            }
            return true;
        };
        Map<String, Object> extras = amountExtras(damage, targets, maySkip);
        extras.put("attackerId", idOf(attacker));
        Map<String, Integer> answer = askAmounts("damage", "Assign damage dealt by " + attacker, targets, rules, maySkip, extras,
                () -> fallbackDamage(targets, damage));
        if (answer == null) {
            return null; // skipped
        }
        Map<CardView, Integer> result = new HashMap<>();
        for (Target t : targets) {
            result.put((CardView) t.key(), answer.getOrDefault(t.id(), 0));
        }
        return result;
    }

    private static Map<String, Integer> fallbackDamage(List<Target> targets, int damage) {
        Map<String, Integer> m = new HashMap<>();
        m.put(targets.get(0).id(), damage);
        return m;
    }

    private static int lethalFor(CardView card, boolean deathtouch) {
        int lethal = Math.max(0, card.getLethalDamage());
        if (card.getCurrentState().isPlaneswalker()) {
            return parseOrZero(card.getCurrentState().getLoyalty());
        }
        return deathtouch ? Math.min(lethal, 1) : lethal;
    }

    private int defenderLethal(GameEntityView defender, boolean infect) {
        if (defender instanceof PlayerView p) {
            return infect ? getGameView().getPoisonCountersToLose() - p.getCounters(CounterEnumType.POISON) : p.getLife();
        }
        if (defender instanceof CardView pw) {
            return parseOrZero(pw.getCurrentState().getLoyalty());
        }
        return 0;
    }

    private static int parseOrZero(String s) {
        try {
            return s == null ? 0 : Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    @Override
    public Map<Object, Integer> assignGenericAmount(CardView effectSource, Map<Object, Integer> target, int amount,
                                                    boolean atLeastOne, String amountLabel) {
        // Mirrors forge-gui-desktop VAssignGenericAmount: each target 0..its cap (>= 1 if atLeastOne), total exact.
        List<Target> targets = new ArrayList<>();
        int i = 0;
        for (Entry<Object, Integer> e : target.entrySet()) {
            Object key = e.getKey();
            String id = idOf(key);
            targets.add(target(key, id != null ? id : "t" + i, String.valueOf(key), e.getValue() != null ? e.getValue() : amount, 0, false));
            i++;
        }
        Predicate<Map<String, Integer>> rules = amounts -> {
            if (sum(amounts) != amount) {
                return false;
            }
            for (Target t : targets) {
                int v = amounts.getOrDefault(t.id(), 0);
                if (v > t.max() || (atLeastOne && v < 1)) {
                    return false;
                }
            }
            return true;
        };
        Map<String, Object> extras = amountExtras(amount, targets, false);
        extras.put("atLeastOne", atLeastOne);
        extras.put("label", amountLabel);
        extras.put("sourceCardId", idOf(effectSource));
        Map<String, Integer> answer = askAmounts("amount", "Assign " + amountLabel + " for " + effectSource, targets,
                rules, false, extras, () -> fallbackAmounts(targets, amount, atLeastOne));
        Map<Object, Integer> result = new HashMap<>();
        for (Target t : targets) {
            result.put(t.key(), answer.getOrDefault(t.id(), 0));
        }
        return result;
    }

    private static Map<String, Integer> fallbackAmounts(List<Target> targets, int amount, boolean atLeastOne) {
        Map<String, Integer> m = new HashMap<>();
        int left = amount;
        for (Target t : targets) {
            int v = atLeastOne ? 1 : 0;
            m.put(t.id(), v);
            left -= v;
        }
        for (Target t : targets) {
            int add = Math.max(0, Math.min(left, t.max() - m.get(t.id())));
            m.put(t.id(), m.get(t.id()) + add);
            left -= add;
        }
        return m;
    }

    private static Target target(Object key, String id, String label, int max, int lethal, boolean defender) {
        Map<String, Object> wire = new LinkedHashMap<>();
        wire.put("id", id);
        if (id != null && id.startsWith("p")) {
            wire.put("playerId", id);
        } else if (id != null && id.startsWith("c")) {
            wire.put("cardId", id);
        }
        wire.put("label", label);
        wire.put("max", max);
        return new Target(key, id, wire, max, lethal, defender);
    }

    private static Map<String, Object> amountExtras(int amount, List<Target> targets, boolean maySkip) {
        Map<String, Object> extras = new LinkedHashMap<>();
        extras.put("amount", amount);
        List<Map<String, Object>> wire = new ArrayList<>();
        for (Target t : targets) {
            wire.add(t.wire());
        }
        extras.put("targets", wire);
        extras.put("maySkip", maySkip);
        return extras;
    }

    private static int sum(Map<String, Integer> amounts) {
        int s = 0;
        for (int v : amounts.values()) {
            s += v;
        }
        return s;
    }

    /**
     * Sends an amounts request whose answer is {@code {targetId: int}}. Unknown ids, negative or
     * non-integral values, and rule violations are rejected. With {@code maySkip}, an empty map skips (null).
     */
    @SuppressWarnings("rawtypes")
    private Map<String, Integer> askAmounts(String kind, String title, List<Target> targets,
                                            Predicate<Map<String, Integer>> rules, boolean maySkip,
                                            Map<String, Object> extras, Supplier<Map<String, Integer>> onCancel) {
        Set<String> ids = new LinkedHashSet<>();
        for (Target t : targets) {
            ids.add(t.id());
        }
        Predicate<Map> valid = raw -> {
            if (maySkip && raw.isEmpty()) {
                return true;
            }
            Map<String, Integer> amounts = parseAmounts(raw, ids);
            return amounts != null && rules.test(amounts);
        };
        Map answer = askValue(kind, Map.class, valid, title, title, List.of(), 0, 0, extras, () -> new HashMap<>(onCancel.get()));
        if (maySkip && answer.isEmpty()) {
            return null;
        }
        Map<String, Integer> parsed = parseAmounts(answer, ids);
        return parsed != null ? parsed : onCancel.get();
    }

    @SuppressWarnings("rawtypes")
    private static Map<String, Integer> parseAmounts(Map raw, Set<String> ids) {
        Map<String, Integer> out = new HashMap<>();
        for (Object o : raw.entrySet()) {
            Entry e = (Entry) o;
            if (!(e.getKey() instanceof String id) || !ids.contains(id) || !(e.getValue() instanceof Number n)) {
                return null;
            }
            double d = n.doubleValue();
            if (d != Math.rint(d) || d < 0 || d > Integer.MAX_VALUE) {
                return null;
            }
            out.put(id, (int) d);
        }
        return out;
    }

    @Override
    public List<PaperCard> sideboard(CardPool sideboard, CardPool main, String message) {
        return null; // keep the main deck (single-game matches)
    }
}
