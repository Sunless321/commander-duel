package app.commanderduel.transport;

/** Outbound channel to the UI: one JSON protocol message per call. Must be safe to call from any thread. */
public interface Transport {
    void send(String json);
}
