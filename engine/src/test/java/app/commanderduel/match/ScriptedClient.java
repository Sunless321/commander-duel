package app.commanderduel.match;

import app.commanderduel.forge.BridgeGuiGame;
import app.commanderduel.protocol.Json;
import app.commanderduel.transport.Transport;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BiPredicate;
import java.util.function.Predicate;

/**
 * Test stand-in for the UI. Records every engine message and plays the most passive legal line:
 * answers each request with its first {@code min} options (integers with {@code min}, damage all on
 * the first target), presses an enabled OK, and clicks the first unchosen selectable object while a
 * selection still needs more picks (e.g. discarding to hand size). Answers run on its own thread.
 */
final class ScriptedClient implements Transport {
    final List<JsonObject> messages = Collections.synchronizedList(new ArrayList<>());
    final List<String> rejections = Collections.synchronizedList(new ArrayList<>());

    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "scripted-client");
        t.setDaemon(true);
        return t;
    });
    private volatile BridgeGuiGame gui;
    /** When set, the next request is first answered with a bogus option id, then answered properly. */
    volatile boolean sendBogusAnswerFirst;
    /** Set once the bogus answer of {@link #sendBogusAnswerFirst} has been sent. */
    volatile String bogusRequestId;
    /** When false, the client records messages but never acts. */
    volatile boolean autoPlay = true;
    /**
     * When set, the first prompt matching it (tested with the latest state's {@code state} object) is not acted on:
     * autoPlay is switched off and the prompt kept in {@link #pausedAt}, so a test can take over at that point.
     */
    volatile BiPredicate<JsonObject, JsonObject> pauseOn;
    volatile JsonObject pausedAt;
    private volatile JsonObject lastPrompt;
    private volatile JsonObject lastSelection;

    void attach(BridgeGuiGame gui) {
        this.gui = gui;
    }

    @Override
    public void send(String json) {
        JsonObject msg = Json.GSON.fromJson(json, JsonObject.class);
        messages.add(msg);
        String type = msg.get("type").getAsString();
        if (type.equals("rejected")) {
            rejections.add(msg.get("reason").getAsString());
        }
        if (!autoPlay) {
            return;
        }
        BiPredicate<JsonObject, JsonObject> pause = pauseOn;
        if (type.equals("prompt") && pause != null) {
            List<JsonObject> states = ofType("state");
            JsonObject state = states.isEmpty() ? null : states.get(states.size() - 1).getAsJsonObject("state");
            if (state != null && pause.test(state, msg)) {
                autoPlay = false;
                pauseOn = null;
                pausedAt = msg;
                return;
            }
        }
        switch (type) {
            case "request" -> worker.execute(() -> answer(msg));
            case "prompt" -> {
                lastPrompt = msg;
                worker.execute(() -> onPrompt(msg));
            }
            case "selection" -> {
                lastSelection = msg;
                worker.execute(() -> onSelection(msg));
            }
            default -> { }
        }
    }

    void shutdown() {
        autoPlay = false;
        worker.shutdownNow();
    }

    List<JsonObject> ofType(String type) {
        synchronized (messages) {
            return messages.stream().filter(m -> m.get("type").getAsString().equals(type)).toList();
        }
    }

    JsonObject first(String type, Predicate<JsonObject> p) {
        synchronized (messages) {
            return messages.stream()
                    .filter(m -> m.get("type").getAsString().equals(type))
                    .filter(p)
                    .findFirst().orElse(null);
        }
    }

    boolean await(Predicate<ScriptedClient> condition, long timeoutMs) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (condition.test(this)) {
                return true;
            }
            TimeUnit.MILLISECONDS.sleep(100);
        }
        return condition.test(this);
    }

    int latestTurn() {
        List<JsonObject> states = ofType("state");
        return states.isEmpty() ? 0 : states.get(states.size() - 1).getAsJsonObject("state").get("turn").getAsInt();
    }

    private void answer(JsonObject req) {
        String id = req.get("requestId").getAsString();
        if (sendBogusAnswerFirst) {
            sendBogusAnswerFirst = false;
            bogusRequestId = id;
            gui.onAnswer(id, List.of("o999"));
        }
        String kind = req.get("kind").getAsString();
        JsonObject extras = req.getAsJsonObject("extras");
        switch (kind) {
            case "integer" -> gui.onAnswerValue(id, extras.get("min").getAsInt());
            case "text" -> gui.onAnswerValue(id, defaultText(req, extras));
            case "damage", "amount" -> gui.onAnswerValue(id, amounts(kind, extras));
            default -> {
                int min = req.get("min").getAsInt();
                JsonArray options = req.getAsJsonArray("options");
                List<String> ids = new ArrayList<>();
                for (int i = 0; i < min; i++) {
                    ids.add(options.get(i).getAsJsonObject().get("id").getAsString());
                }
                gui.onAnswer(id, ids);
            }
        }
    }

    private static String defaultText(JsonObject req, JsonObject extras) {
        JsonArray options = req.getAsJsonArray("options");
        if (!options.isEmpty()) {
            return options.get(0).getAsJsonObject().get("label").getAsString();
        }
        JsonElement initial = extras.get("initial");
        if (initial != null && !initial.isJsonNull() && !initial.getAsString().isEmpty()) {
            return initial.getAsString();
        }
        return extras.get("numeric").getAsBoolean() ? "0" : "";
    }

    /** Damage: everything on the first target. Amount: the same, respecting per-target caps and at-least-one. */
    private static Map<String, Object> amounts(String kind, JsonObject extras) {
        int total = extras.get("amount").getAsInt();
        JsonArray targets = extras.getAsJsonArray("targets");
        Map<String, Object> out = new LinkedHashMap<>();
        if (kind.equals("damage")) {
            out.put(targets.get(0).getAsJsonObject().get("id").getAsString(), total);
            return out;
        }
        boolean atLeastOne = extras.get("atLeastOne").getAsBoolean();
        int left = total;
        int[] given = new int[targets.size()];
        if (atLeastOne) {
            for (int i = 0; i < given.length; i++) {
                given[i] = 1;
                left--;
            }
        }
        for (int i = 0; i < given.length && left > 0; i++) {
            int cap = targets.get(i).getAsJsonObject().get("max").getAsInt();
            int add = Math.min(left, cap - given[i]);
            given[i] += add;
            left -= add;
        }
        for (int i = 0; i < given.length; i++) {
            out.put(targets.get(i).getAsJsonObject().get("id").getAsString(), given[i]);
        }
        return out;
    }

    private void onPrompt(JsonObject prompt) {
        if (prompt != lastPrompt) {
            return; // superseded
        }
        if (enabled(prompt, "ok")) {
            gui.onAction("ok", null, null);
        } else if (enabled(prompt, "cancel") && prompt.get("inputKind").getAsString().equals("payMana")) {
            gui.onAction("cancel", null, null); // cannot auto-pay: back out
        }
    }

    private void onSelection(JsonObject sel) {
        if (sel != lastSelection) {
            return; // superseded
        }
        int min = sel.get("min").getAsInt();
        JsonArray chosen = sel.getAsJsonArray("chosen");
        if (chosen.size() >= min) {
            return;
        }
        for (JsonElement e : sel.getAsJsonArray("selectable")) {
            String id = e.getAsString();
            if (!chosen.contains(e)) {
                String action = switch (id.charAt(0)) {
                    case 'p' -> "selectPlayer";
                    case 's' -> "selectStackItem";
                    default -> "selectCard";
                };
                gui.onAction(action, id, null);
                return;
            }
        }
    }

    private static boolean enabled(JsonObject prompt, String button) {
        JsonElement b = prompt.get(button);
        return b != null && b.isJsonObject() && b.getAsJsonObject().get("enabled").getAsBoolean();
    }
}
