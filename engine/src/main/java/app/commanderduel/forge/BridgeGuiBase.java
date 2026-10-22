package app.commanderduel.forge;

import forge.gamemodes.match.HostedMatch;
import forge.gui.download.GuiDownloadService;
import forge.gui.interfaces.IGuiBase;
import forge.gui.interfaces.IGuiGame;
import forge.item.PaperCard;
import forge.localinstance.skin.FSkinProp;
import forge.localinstance.skin.ISkinImage;
import forge.sound.IAudioClip;
import forge.sound.IAudioMusic;
import forge.util.FSerializableFunction;
import forge.util.ImageFetcher;
import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.jupnp.UpnpServiceConfiguration;

/**
 * Headless {@link IGuiBase} for the engine process. Forge's "GUI thread" is a dedicated single-thread
 * executor (the "EDT"); the game thread must never be it, so {@link #isGuiThread()} is true only there.
 */
public class BridgeGuiBase implements IGuiBase {
    private final String assetsDir;
    private volatile Thread edtThread;
    private final ExecutorService edt = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "forge-edt");
        t.setDaemon(true);
        edtThread = t;
        return t;
    });
    private final ExecutorService background = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "forge-background");
        t.setDaemon(true);
        return t;
    });
    /** Reported to Forge as isRunningOnDesktop(); ForgeBootstrap flips it briefly to redirect profile dirs. */
    private volatile boolean runningOnDesktop = true;

    public BridgeGuiBase(Path forgeGuiDir) {
        this.assetsDir = forgeGuiDir.toAbsolutePath().normalize() + File.separator;
    }

    public ExecutorService edt() {
        return edt;
    }

    void setRunningOnDesktop(boolean value) {
        this.runningOnDesktop = value;
    }

    @Override public boolean isRunningOnDesktop() { return runningOnDesktop; }
    @Override public boolean isLibgdxPort() { return false; }
    @Override public String getCurrentVersion() { return "commander-duel"; }
    @Override public String getUserAgent() { return "CommanderDuel/0.1.0"; }

    @Override
    public boolean isGuiThread() {
        return Thread.currentThread() == edtThread;
    }

    @Override
    public void invokeInEdtNow(Runnable runnable) {
        if (isGuiThread()) {
            runnable.run();
        } else {
            edt.execute(runnable);
        }
    }

    @Override
    public void invokeInEdtLater(Runnable runnable) {
        edt.execute(runnable);
    }

    @Override
    public void invokeInEdtAndWait(Runnable proc) {
        if (isGuiThread()) {
            proc.run();
            return;
        }
        try {
            edt.submit(proc).get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (ExecutionException e) {
            throw new RuntimeException(e.getCause());
        }
    }

    @Override
    public void runBackgroundTask(String message, Runnable task) {
        background.execute(task);
    }

    @Override public String getAssetsDir() { return assetsDir; }
    @Override public ImageFetcher getImageFetcher() { return null; }
    @Override public ISkinImage getSkinIcon(FSkinProp skinProp) { return null; }
    @Override public ISkinImage getUnskinnedIcon(String path) { return null; }
    @Override public ISkinImage getCardArt(PaperCard card, boolean backFace) { return null; }
    @Override public ISkinImage createLayeredImage(PaperCard card, FSkinProp background, String overlayFilename, float opacity) { return null; }
    @Override public void clearImageCache() { }
    @Override public String encodeSymbols(String str, boolean formatReminderText) { return str; }
    @Override public int getAvatarCount() { return 0; }
    @Override public int getSleevesCount() { return 0; }
    @Override public float getScreenScale() { return 1.0f; }
    @Override public void preventSystemSleep(boolean preventSleep) { }
    @Override public void download(GuiDownloadService service, Consumer<Boolean> callback) { callback.accept(false); }
    @Override public void copyToClipboard(String text) { }
    @Override public void browseToUrl(String url) { }
    @Override public void showCardList(String title, String message, List<PaperCard> list) { }
    @Override public boolean showBoxedProduct(String title, String message, List<PaperCard> list) { return false; }
    @Override public void showBugReportDialog(String title, String text, boolean showExitAppBtn) { }
    @Override public void showImageDialog(ISkinImage image, String message, String title) { }
    @Override public int showOptionDialog(String message, String title, FSkinProp icon, List<String> options, int defaultOption) { return defaultOption; }
    @Override public String showInputDialog(String message, String title, FSkinProp icon, String initialInput, List<String> inputOptions, boolean isNumeric) { return initialInput; }
    @Override public String showFileDialog(String title, String defaultDir) { return defaultDir; }
    @Override public File getSaveFile(File defaultFile) { return defaultFile; }
    @Override public <T> List<T> order(String title, String top, int remainingObjectsMin, int remainingObjectsMax, List<T> sourceChoices, List<T> destChoices) { return destChoices; }
    @Override public <T> List<T> getChoices(String message, int min, int max, Collection<T> choices, Collection<T> selected, FSerializableFunction<T, String> display) { return new ArrayList<>(selected); }
    @Override public PaperCard chooseCard(String title, String message, List<PaperCard> list) { return list.isEmpty() ? null : list.get(0); }
    @Override public boolean isSupportedAudioFormat(File file) { return false; }
    @Override public IAudioClip createAudioClip(String filename) { return null; }
    @Override public IAudioMusic createAudioMusic(String filename) { return null; }
    @Override public void startAltSoundSystem(String filename, boolean isSynchronized) { }
    @Override public void showSpellShop() { }
    @Override public void showBazaar() { }
    @Override public IGuiGame getNewGuiGame() { throw new UnsupportedOperationException("match GUIs are created by the engine session"); }
    @Override public HostedMatch hostMatch() { return new HostedMatch(); }
    @Override public UpnpServiceConfiguration getUpnpPlatformService() { return null; }
    @Override public boolean hasNetGame() { return false; }
}
