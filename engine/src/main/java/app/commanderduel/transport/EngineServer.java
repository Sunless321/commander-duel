package app.commanderduel.transport;

import app.commanderduel.session.Session;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

/** Localhost-only WebSocket endpoint: one token-authenticated client at a time, wired to a {@link Session}. */
public class EngineServer extends WebSocketServer {
    public static final int CLOSE_BAD_TOKEN = 4001;
    public static final int CLOSE_BUSY = 4002;

    private final String token;
    private final Session session;
    private final CountDownLatch started = new CountDownLatch(1);
    private volatile Exception startFailure;
    private WebSocket client; // guarded by this

    /** @param port0 port to bind on 127.0.0.1; 0 picks a free one (see {@link #getPort()}) */
    public EngineServer(int port0, String token, Session session) {
        super(new InetSocketAddress("127.0.0.1", port0));
        this.token = token;
        this.session = session;
        setReuseAddr(true);
    }

    /** Starts listening and returns once the socket is bound. */
    public void startAndWait() throws InterruptedException {
        start();
        if (!started.await(15, TimeUnit.SECONDS)) {
            throw new IllegalStateException("engine server did not start");
        }
        if (startFailure != null) {
            throw new IllegalStateException("engine server failed to start", startFailure);
        }
    }

    public synchronized boolean hasClient() {
        return client != null;
    }

    @Override
    public void onStart() {
        started.countDown();
    }

    @Override
    public synchronized void onOpen(WebSocket conn, ClientHandshake handshake) {
        if (!tokenMatches(handshake.getResourceDescriptor())) {
            conn.close(CLOSE_BAD_TOKEN, "bad token");
            return;
        }
        if (client != null) {
            conn.close(CLOSE_BUSY, "another client is connected");
            return;
        }
        client = conn;
        session.onConnect(json -> {
            try {
                conn.send(json);
            } catch (RuntimeException e) {
                // client went away mid-send; onClose handles the rest
            }
        });
        conn.send("{\"type\":\"ready\"}");
    }

    @Override
    public synchronized void onClose(WebSocket conn, int code, String reason, boolean remote) {
        if (client != conn) {
            return; // a rejected connection
        }
        client = null;
        // Under the lock, so a fast reconnect's onConnect cannot be undone by this disconnect.
        session.onDisconnect();
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        synchronized (this) {
            if (client != conn) {
                return;
            }
        }
        session.onMessage(message);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        if (conn == null) { // server-level failure, e.g. bind
            startFailure = ex;
            started.countDown();
        }
        System.err.println("engine server error: " + ex);
    }

    private boolean tokenMatches(String resourceDescriptor) {
        int q = resourceDescriptor == null ? -1 : resourceDescriptor.indexOf('?');
        if (q < 0) {
            return false;
        }
        for (String pair : resourceDescriptor.substring(q + 1).split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals("token")) {
                String given;
                try {
                    given = URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
                } catch (IllegalArgumentException e) {
                    return false;
                }
                return MessageDigest.isEqual(given.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8));
            }
        }
        return false;
    }
}
