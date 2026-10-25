# Commander Duel

A Windows desktop app for playing Magic: The Gathering Commander (EDH) against bots. Import your deck from Archidekt, pick 1–3 bots (difficulty and deck each, or a random precon), and play. The rules are enforced by the open-source [Forge](https://github.com/Card-Forge/forge) engine, so the app only lets you make legal plays. Cards you can play glow blue, and a popup tells you when an opponent's spell gives you a chance to respond.

## Install (for players)

1. Download `Commander Duel Setup <version>.exe` from the Releases page.
2. Run it. Windows SmartScreen may warn that the app is unrecognized because it is not code-signed: click **More info → Run anyway**.
3. Start **Commander Duel** from the Start menu or the desktop shortcut.

Nothing else is needed: Java is bundled. Card images are downloaded from [Scryfall](https://scryfall.com) the first time each card is shown and cached in `%APPDATA%\Commander Duel\card-cache`, so the first games need an internet connection.

**Import a deck:** on the Decks screen, paste a public Archidekt deck link, or a text decklist (`1 Sol Ring` per line) with the commander under a `Commander` header or tagged `*CMDR*`. Import as many decks as you like; each one gets **Rename** and **Delete** buttons.

## Update to a new version

Your decks, saved matches and settings are kept when you update. They live in `%APPDATA%\Commander Duel`, which the installer never touches.

1. **Close Commander Duel** if it is open, including a game in progress (concede it or just close the window).
2. Download the newest `Commander Duel Setup <version>.exe` from the [Releases page](https://github.com/Sunless321/commander-duel/releases/latest).
3. Run it and click through. It installs over the old version; you don't need to uninstall first. If SmartScreen warns, click **More info → Run anyway**.
4. Start Commander Duel as usual.

To check which version you have: **Settings → Apps → Installed apps → Commander Duel**.

## What you can do

- **Play** 1–3 bots, each with its own deck (yours, a precon or a random precon) and difficulty.
- **Respond** to opponents: a popup shows their spell large enough to read, its targets, and the cards you can answer with.
- **See everything:** click an empty spot of an opponent's field (or **View board**) for their whole board at once. Tapped cards are drawn upright with a "Tapped" label.
- **Know what's coming:** a red banner warns when creatures attack you (with the total damage) or an opponent's spell targets you or your permanents.
- **Follow the game** in the **Log** on the right. It is cleared when the match ends.
- **Save a match** with **Save recording** on the game-over screen, then watch it turn by turn from **Saved matches** on the Decks screen.

## If something goes wrong

- **The game seems stuck** (a bot "thinking" forever): you'll see a red notice if the engine hit an error. Press **Concede** to leave the game. Bots that hit an engine error while deciding now make a safe choice instead of freezing the game.
- **Report a problem:** attach `%APPDATA%\Commander Duel\logs\engine.log` (the last run) and `engine.previous.log` (the run before) to an issue on GitHub.

## Build from source

Requirements: Windows, [Temurin JDK 17](https://adoptium.net), Maven 3.9+, Node 20+.

```powershell
git clone --recurse-submodules <this repo>
cd commander-duel
powershell -ExecutionPolicy Bypass -File scripts\package.ps1
```

This builds Forge, the engine jar, a trimmed Java runtime, and the installer at `app\dist\Commander Duel Setup <version>.exe`. Pass `-SkipForge` to reuse a Forge build already in `~/.m2`.

For development:

```powershell
scripts\build-forge.ps1                 # once: installs forge-gui 2.0.16-SNAPSHOT into ~/.m2
mvn -f engine\pom.xml package           # runs the engine tests, builds engine\target\commander-duel-engine.jar
cd app; npm ci; npm test; npm run dev   # app tests, then the app against the dev engine
```

`scripts/build-forge.ps1` also rewrites the installed Forge POMs in `~/.m2` to replace the `${revision}` placeholder with `2.0.16-SNAPSHOT`; without that Maven cannot resolve Forge's parent POM from the engine (`-Drevision` does not help for dependency POMs).

**How it fits together:** the Electron app starts the engine (`engine/`, Java) as a child process and talks to it over a localhost WebSocket protected by a random token. The engine embeds Forge unmodified (git submodule at `forge/`) and relays every decision Forge asks for to the UI; Forge re-validates every click and answer.

## License and notices

Commander Duel is free software under the GNU General Public License v3.0 (see `LICENSE`). Forge is also GPL-3.0; its source is in the `forge/` submodule.

Commander Duel is unofficial Fan Content permitted under the [Wizards of the Coast Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. No card images are included in this repository or the installer; they are fetched from Scryfall at runtime.
