package app.commanderduel.forge;

import forge.gui.GuiBase;
import forge.localinstance.properties.ForgeConstants;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import java.nio.file.Path;

/** Boots Forge headless, once per JVM. */
public final class ForgeBootstrap {
    private static BridgeGuiBase gui;

    private ForgeBootstrap() { }

    /**
     * @param forgeGuiDir the forge-gui directory (holds res/)
     * @param dataDir     where Forge keeps its user data ({@code dataDir/data}) and cache ({@code dataDir/cache})
     */
    public static synchronized void init(Path forgeGuiDir, Path dataDir) {
        if (gui != null) {
            return;
        }
        BridgeGuiBase base = new BridgeGuiBase(forgeGuiDir);
        GuiBase.setInterface(base);
        redirectProfile(base, dataDir);

        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            prefs.setPref(FPref.PLAYER_NAME, "You");
            prefs.setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, true);
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, false);
            prefs.setPref(FPref.UI_RECORD_REPLAYS, false);
            prefs.setPref(FPref.ENFORCE_DECK_LEGALITY, false);
            return null;
        });
        gui = base;
    }

    public static synchronized BridgeGuiBase gui() {
        if (gui == null) {
            throw new IllegalStateException("ForgeBootstrap.init has not been called");
        }
        return gui;
    }

    /**
     * ForgeProfileProperties picks its dirs in ForgeConstants' static initializer, from a
     * forge.profile.properties file inside the (shared) forge-gui dir or from %APPDATA%.
     * Its only other hook is the "mobile" branch, which honours the forge.ios.userDir/cacheDir
     * system properties. So we report isRunningOnDesktop()==false just while ForgeConstants initializes.
     */
    private static void redirectProfile(BridgeGuiBase base, Path dataDir) {
        Path root = dataDir.toAbsolutePath().normalize();
        System.setProperty("forge.ios.userDir", root.resolve("data").toString());
        System.setProperty("forge.ios.cacheDir", root.resolve("cache").toString());
        base.setRunningOnDesktop(false);
        try {
            String userDir = ForgeConstants.USER_DIR; // forces ForgeConstants.<clinit>
            if (!userDir.startsWith(root.toString())) {
                throw new IllegalStateException("Forge profile not redirected: " + userDir);
            }
        } finally {
            base.setRunningOnDesktop(true);
        }
    }
}
