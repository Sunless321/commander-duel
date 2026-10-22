package app.commanderduel.protocol;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.concurrent.CancellationException;
import org.junit.jupiter.api.Test;

class PendingRequestsTest {
    private final PendingRequests reg = new PendingRequests();

    @Test void answerReturnsSameObjectsInOrder() throws Exception {
        Object a = new Object(), b = new Object(), c = new Object();
        PendingRequests.Pending<Object> p = reg.open("choose", List.of(a, b, c), 1, 2);
        assertEquals(List.of("o0", "o1", "o2"), p.optionIds());
        PendingRequests.Result r = reg.answer(p.requestId(), List.of("o2", "o0"));
        assertTrue(r.ok());
        List<Object> got = p.future().get();
        assertEquals(2, got.size());
        assertSame(c, got.get(0));
        assertSame(a, got.get(1));
    }

    @Test void unknownOptionRejected() {
        PendingRequests.Pending<String> p = reg.open("choose", List.of("a"), 1, 1);
        PendingRequests.Result r = reg.answer(p.requestId(), List.of("o9"));
        assertFalse(r.ok());
        assertTrue(r.reason().contains("o9"));
        assertFalse(p.future().isDone());
    }

    @Test void tooFewOrTooManyRejected() {
        PendingRequests.Pending<String> p = reg.open("choose", List.of("a", "b"), 1, 1);
        assertFalse(reg.answer(p.requestId(), List.of()).ok());
        assertFalse(reg.answer(p.requestId(), List.of("o0", "o1")).ok());
        assertFalse(p.future().isDone());
    }

    @Test void duplicateIdsRejected() {
        PendingRequests.Pending<String> p = reg.open("choose", List.of("a", "b"), 1, 2);
        assertFalse(reg.answer(p.requestId(), List.of("o0", "o0")).ok());
        assertFalse(p.future().isDone());
    }

    @Test void unknownRequestIdRejected() {
        assertFalse(reg.answer("r999", List.of("o0")).ok());
    }

    @Test void secondAnswerRejected() {
        PendingRequests.Pending<String> p = reg.open("choose", List.of("a"), 1, 1);
        assertTrue(reg.answer(p.requestId(), List.of("o0")).ok());
        assertFalse(reg.answer(p.requestId(), List.of("o0")).ok());
    }

    @Test void cancelAllFailsOpenFutures() {
        PendingRequests.Pending<String> p = reg.open("choose", List.of("a"), 1, 1);
        PendingRequests.PendingValue<Integer> v = reg.openValue("integer", Integer.class, x -> true);
        reg.cancelAll();
        assertThrows(CancellationException.class, () -> p.future().get());
        assertTrue(v.future().isCompletedExceptionally());
        assertFalse(reg.answer(p.requestId(), List.of("o0")).ok());
    }

    @Test void valueValidatorEnforced() throws Exception {
        PendingRequests.PendingValue<Integer> p = reg.openValue("integer", Integer.class, v -> v >= 0 && v <= 3);
        assertFalse(reg.answerValue(p.requestId(), 5).ok());
        assertFalse(reg.answerValue(p.requestId(), "x").ok());
        assertFalse(p.future().isDone());
        assertTrue(reg.answerValue(p.requestId(), 2).ok());
        assertEquals(2, p.future().get());
    }

    @Test void wrongTypeRejected() {
        PendingRequests.PendingValue<String> p = reg.openValue("text", String.class, s -> true);
        assertFalse(reg.answerValue(p.requestId(), 5).ok());
        assertFalse(p.future().isDone());
    }

    @Test void integralDoubleCoercedToInteger() throws Exception {
        PendingRequests.PendingValue<Integer> p = reg.openValue("integer", Integer.class, v -> true);
        assertFalse(reg.answerValue(p.requestId(), 2.5).ok());
        assertTrue(reg.answerValue(p.requestId(), 2.0).ok());
        Object got = p.future().get();
        assertEquals(Integer.valueOf(2), got);
    }

    @Test void concurrentAnswersExactlyOneSucceeds() throws Exception {
        int n = 16;
        PendingRequests.Pending<String> p = reg.open("choose", List.of("a", "b"), 1, 1);
        java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.ExecutorService ex = java.util.concurrent.Executors.newFixedThreadPool(n);
        List<java.util.concurrent.Future<PendingRequests.Result>> fs = new java.util.ArrayList<>();
        for (int i = 0; i < n; i++) {
            fs.add(ex.submit(() -> { go.await(); return reg.answer(p.requestId(), List.of("o1")); }));
        }
        go.countDown();
        int ok = 0;
        for (var f : fs) if (f.get().ok()) ok++;
        ex.shutdown();
        assertEquals(1, ok);
        assertEquals(List.of("b"), p.future().get());
    }
}
