package app.commanderduel.forge;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import forge.StaticData;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class ForgeBootstrapTest {
    @BeforeAll
    static void boot() throws IOException {
        ForgeBootstrap.init(Path.of("../forge/forge-gui"), Files.createTempDirectory("cd"));
    }

    @Test
    void loadsCommanderPrecons() {
        assertTrue(FModel.getDecks().getCommanderPrecons().size() >= 150);
    }

    @Test
    void resolvesCardByName() {
        assertNotNull(StaticData.instance().getCommonCards().getCard("Sol Ring"));
    }

    @Test
    void actionableHighlightsEnabled() {
        assertTrue(FModel.getPreferences().getPrefBoolean(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS));
    }

    @Test
    void initTwiceIsNoOp() {
        assertDoesNotThrow(() -> ForgeBootstrap.init(Path.of("../forge/forge-gui"), Path.of(".")));
    }
}
