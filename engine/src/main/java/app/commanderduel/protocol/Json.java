package app.commanderduel.protocol;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

/** Single shared Gson for the wire protocol. */
public final class Json {
    public static final Gson GSON = new GsonBuilder().serializeNulls().create();

    private Json() {}
}
