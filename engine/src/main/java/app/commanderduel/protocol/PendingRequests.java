package app.commanderduel.protocol;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Predicate;

/**
 * Registry of engine decisions awaiting a UI answer. The UI may only answer with option ids the
 * engine offered; everything else is rejected. Answers arrive on a WebSocket thread while futures
 * are awaited on the game thread, so all state is concurrent and a request is answered at most once.
 */
public final class PendingRequests {
    public record Result(boolean ok, String reason) {
        static Result accepted() { return new Result(true, null); }
        static Result rejected(String reason) { return new Result(false, reason); }
    }

    public static final class Pending<T> {
        private final String requestId;
        private final List<String> optionIds;
        private final CompletableFuture<List<T>> future = new CompletableFuture<>();

        private Pending(String requestId, List<String> optionIds) {
            this.requestId = requestId;
            this.optionIds = optionIds;
        }

        public String requestId() { return requestId; }
        public List<String> optionIds() { return optionIds; }
        public CompletableFuture<List<T>> future() { return future; }
    }

    public static final class PendingValue<R> {
        private final String requestId;
        private final CompletableFuture<R> future = new CompletableFuture<>();

        private PendingValue(String requestId) { this.requestId = requestId; }

        public String requestId() { return requestId; }
        public CompletableFuture<R> future() { return future; }
    }

    private interface Entry {
        /** Returns the value to complete with; throws IllegalArgumentException(reason) if invalid. */
        Object validate(Object answer);
        void complete(Object validated);
        void cancel();
    }

    private final Map<String, Entry> open = new ConcurrentHashMap<>();
    private final AtomicLong counter = new AtomicLong();

    public <T> Pending<T> open(String kind, List<T> options, int min, int max) {
        List<T> objs = List.copyOf(options);
        List<String> ids = new ArrayList<>(objs.size());
        for (int i = 0; i < objs.size(); i++) ids.add("o" + i);
        Pending<T> pending = new Pending<>("r" + counter.getAndIncrement(), List.copyOf(ids));
        open.put(pending.requestId, new Entry() {
            @Override public Object validate(Object answer) {
                if (!(answer instanceof List<?> given)) throw new IllegalArgumentException("expected a list of option ids");
                if (given.size() < min || given.size() > max) {
                    throw new IllegalArgumentException("expected between " + min + " and " + max + " options, got " + given.size());
                }
                Set<Object> seen = new HashSet<>();
                List<T> chosen = new ArrayList<>(given.size());
                for (Object id : given) {
                    int idx = ids.indexOf(id);
                    if (idx < 0) throw new IllegalArgumentException("unknown option id: " + id);
                    if (!seen.add(id)) throw new IllegalArgumentException("duplicate option id: " + id);
                    chosen.add(objs.get(idx));
                }
                return chosen;
            }

            @Override @SuppressWarnings("unchecked")
            public void complete(Object validated) { pending.future.complete((List<T>) validated); }

            @Override public void cancel() { pending.future.completeExceptionally(new CancellationException("request cancelled")); }
        });
        return pending;
    }

    public <R> PendingValue<R> openValue(String kind, Predicate<R> validator) {
        PendingValue<R> pending = new PendingValue<>("r" + counter.getAndIncrement());
        open.put(pending.requestId, new Entry() {
            @Override @SuppressWarnings("unchecked")
            public Object validate(Object answer) {
                boolean valid;
                try {
                    valid = answer != null && validator.test((R) answer);
                } catch (ClassCastException e) {
                    valid = false;
                }
                if (!valid) throw new IllegalArgumentException("invalid " + kind + " value: " + answer);
                return answer;
            }

            @Override @SuppressWarnings("unchecked")
            public void complete(Object validated) { pending.future.complete((R) validated); }

            @Override public void cancel() { pending.future.completeExceptionally(new CancellationException("request cancelled")); }
        });
        return pending;
    }

    public Result answer(String requestId, List<String> optionIds) {
        return dispatch(requestId, optionIds);
    }

    public Result answerValue(String requestId, Object value) {
        return dispatch(requestId, value);
    }

    private Result dispatch(String requestId, Object answer) {
        Entry entry = requestId == null ? null : open.get(requestId);
        if (entry == null) return Result.rejected("unknown or already answered request: " + requestId);
        Object validated;
        try {
            validated = entry.validate(answer);
        } catch (IllegalArgumentException e) {
            return Result.rejected(e.getMessage());
        }
        // Claim atomically so concurrent duplicate answers cannot both succeed.
        if (!open.remove(requestId, entry)) return Result.rejected("request already answered: " + requestId);
        entry.complete(validated);
        return Result.accepted();
    }

    public void cancelAll() {
        for (String id : List.copyOf(open.keySet())) {
            Entry e = open.remove(id);
            if (e != null) e.cancel();
        }
    }
}
