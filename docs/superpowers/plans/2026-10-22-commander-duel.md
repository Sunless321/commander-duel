# Commander Duel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows desktop app for playing Commander against 1–3 Forge bots, with a Master Duel-style board, blue "playable" glow, and timing popups, importing decks from Archidekt.

**Architecture:** A Java 17 "engine" process embeds Forge unmodified (forge-core/game/ai/gui) and implements Forge's GUI interface (`BridgeGuiGame extends NetworkGuiGame`). It relays every engine decision over a localhost WebSocket as JSON, with an id for each legal option. An Electron + React app spawns the engine, renders the game, and can only answer with option ids the engine offered. The engine validates every answer again before handing it to Forge.

**Tech Stack:**
- Java 17 (Temurin), Maven 3.9.9, Forge `2.0.16-SNAPSHOT` (git submodule pinned at `ccff857b`), Java-WebSocket 1.5.7, Gson (already in Forge), JUnit 5.10.2, maven-shade-plugin 3.6.0.
- Electron 33.2.0, electron-vite 2.3.0, Vite 5.4.11, React 18.3.1, TypeScript 5.6.3, zustand 5.0.2, Vitest 2.1.8, @testing-library/react 16.1.0, electron-builder 25.1.8.

**Spec:** `docs/superpowers/specs/2026-10-22-commander-duel-design.md` (approved mockups: https://claude.ai/artifact/9f4Ke26bapF6HnL1AvrLs5)

## Global Constraints

- **No illegal moves:**
  - The UI never computes legality.
  - Every UI→engine answer is an option id from the request it answers, or a click on an object the current game state contains.
  - The engine rejects anything else and leaves the request open.
  - Forge source is not modified. Any rules discrepancy introduced by this project is top-severity.
- **License:** GPL-3.0 for the whole repo (`LICENSE` at the root).
- **Platform:** Windows 10/11 x64 only.
- **No WotC assets in the repo or installer:**
  - Card images come from Scryfall at runtime and are cached in `%APPDATA%\Commander Duel\card-cache`.
  - The card back is drawn in CSS.
- **Repo root:** `C:\Users\arham\dev\commander-duel`, outside OneDrive.
- **Engine binding:** the engine listens on `127.0.0.1` only, on a random port. It requires the session token (32 random hex chars) as the query param `?token=` on connect, and accepts one client.
- **Scryfall:** requests carry `User-Agent: CommanderDuel/0.1` and `Accept: */*`, and are spaced at least 100 ms apart.
- **Game format:** Commander only. A pod is the human plus 1–3 bots. Life is 40 (Forge's `RegisteredPlayer.forCommander` sets this).

## Review Focus

1. **Hidden information leaking to the UI.** This covers opponents' hands, libraries, and face-down cards. The UI must receive only counts or "hidden" placeholders for anything the human can't see. Pinned by `StateMapperTest.opponentHandIsCountOnly` and `faceDownOpponentCardHasNoName` (Task 3).
2. **Stale or duplicate answers.** When the UI answers a request twice, or answers after the engine moved on, the second answer is rejected, never applied. Pinned by `PendingRequestsTest.secondAnswerRejected` and `unknownRequestIdRejected` (Task 2).
3. **The auto-pass setting acting on something other than plain priority.** "Never" or "Only when I have a response" must only ever click Pass on an `InputPassPriority` prompt. A targeting, payment, or choice prompt must never be auto-answered. Pinned by `respondPolicy.test.ts › never auto-answers non-priority prompts` (Task 12).
4. **Archidekt decks Forge can't use.** This covers private decks, unknown card names, no commander category, and partner pairs. Each gets a clear message that names the offending cards. Partners import as two commanders. Pinned by `DeckStoreTest.unknownCardsReportedByName` and `partnersBecomeTwoCommanders` (Task 4), and `archidekt.test.ts › private deck gives readable error` (Task 8).
5. **The engine process dying mid-game.** The UI shows "The game engine stopped" with a "Back to menu" button, and Electron restarts the engine. It must never hang on a dead socket. Pinned by `engineClient.test.ts › close event surfaces engine-stopped` (Task 6).

---

## File Structure

```
commander-duel/
  LICENSE, README.md, .gitignore, .gitmodules
  forge/                                   # submodule, Card-Forge/forge @ ccff857b, never edited
  scripts/build-forge.ps1                  # mvn -pl forge-gui -am install -DskipTests in forge/
  scripts/package.ps1                      # Task 13
  engine/                                  # standalone Maven project app.commanderduel:commander-duel-engine
    pom.xml
    src/main/java/app/commanderduel/
      Main.java                            # args, bootstrap, start server, print READY line
      forge/ForgeBootstrap.java            # GuiBase.setInterface + FModel.initialize with prefs
      forge/BridgeGuiBase.java             # IGuiBase: EDT executor, stubs
      forge/BridgeGuiGame.java             # extends NetworkGuiGame: notifications + blocking requests
      protocol/Json.java                   # one Gson instance
      protocol/Dto.java                    # records: GameState, PlayerDto, CardDto, StackItemDto, ...
      protocol/StateMapper.java            # GameView + viewer -> Dto.GameState (hidden info rules)
      protocol/PendingRequests.java        # request ids, offered option ids, answer validation
      transport/Transport.java             # interface: void send(String json)
      transport/EngineServer.java          # Java-WebSocket server, token, single client
      session/Session.java                 # routes inbound JSON: lobby commands + game actions
      decks/DeckStore.java                 # import lines -> Deck, save/list .dck
      match/MatchStarter.java              # setup -> HostedMatch.startMatch
      match/Difficulty.java                # EASY/NORMAL/HARD -> profile + AIOptions
    src/test/java/app/commanderduel/...    # tests named below
  app/                                     # Electron + React (electron-vite layout)
    package.json, electron.vite.config.ts, electron-builder.yml, tsconfig*.json
    electron/main.ts                       # window, IPC, engine lifecycle
    electron/engineProcess.ts              # spawn java, parse READY, restart
    electron/cardImages.ts                 # card:// protocol, disk cache, Scryfall queue
    electron/archidekt.ts                  # fetch + parse Archidekt deck -> lines
    electron/preload.ts                    # exposes window.duel {engine: {port, token}, importArchidekt}
    src/main.tsx, src/App.tsx
    src/net/protocol.ts                    # TS mirror of Dto + message types
    src/net/engineClient.ts                # WebSocket client, typed send/subscribe
    src/state/store.ts                     # zustand: screen, game state, prompt, selection, playable, requests
    src/screens/Decks.tsx, Setup.tsx, Board.tsx, GameOver.tsx
    src/components/Card.tsx, Hand.tsx, Battlefield.tsx, PlayerPanel.tsx, PhaseBar.tsx,
                   PromptBar.tsx, StackView.tsx, RequestDialog.tsx, ResponsePopup.tsx
    src/logic/respondPolicy.ts             # when to show the timing popup / auto-pass
    src/styles/*.css
```

## Wire Protocol (shared by Tasks 2–12)

All messages are JSON objects with a `type` field. All ids are strings: the Forge `TrackableObject` id as a decimal string for cards and players, and `"o0".."oN"` for options.

**Engine → UI:**
- `{"type":"ready"}` is sent on connect.
- `{"type":"lobby", "precons":[{"id","name","commander","colors"}], "decks":[{"id","name","commanders":[...]}]}` answers `listLobby`.
- `{"type":"importResult", "ok":bool, "deck":{...}|null, "unknownCards":[names], "problems":[strings]}`
- `{"type":"state", "state": GameState}`. A full snapshot, debounced 50 ms after any engine notification.
- `{"type":"prompt", "message":str, "inputKind":"priority"|"mulligan"|"attack"|"block"|"payMana"|"target"|"select"|"other"|"wait", "ok":{"label","enabled"}|null, "cancel":{"label","enabled"}|null}`
- `{"type":"selection", "selectable":[ids], "chosen":[ids], "min":int, "max":int}`. Cards, players, and stack items share one id space.
- `{"type":"playable", "cardIds":[ids]}` comes from `setWeaklySelectable`, and `[]` on clear.
- `{"type":"request", "requestId":"r12", "kind":K, "title":str, "message":str, "options":[{"id":"o0","label":str,"cardId":id|null}], "min":int, "max":int, ...kind extras}`. `K` is one of:
  - `choose`: getChoices / one / many / oneOrNone
  - `order`: `extras.ordered=true`
  - `confirm`: options are the button labels
  - `ability`: getAbilityToPlay
  - `integer`: `extras {min,max}`, no options
  - `text`: showInputDialog
  - `damage`: assignCombatDamage, `extras {amount, targets:[{id,cardId|playerId,label}], maySkip}`
  - `amount`: assignGenericAmount, same extras
  - `entity`: chooseSingleEntityForEffect / chooseEntitiesForEffect
  - `manipulate`: manipulateCardList
- `{"type":"rejected", "requestId":str|null, "reason":str}` is sent when an answer or action failed validation.
- `{"type":"gameOver", "winnerNames":[str], "youWon":bool}`
- `{"type":"error", "message":str}`

**UI → Engine:**
- `{"type":"listLobby"}`
- `{"type":"importDeck", "name":str, "commanders":[cardName], "main":[{"count":int,"name":str}]}`
- `{"type":"startGame", "deckId":str, "bots":[{"deck":{"kind":"randomPrecon"}|{"kind":"precon","id"}|{"kind":"imported","id"}, "difficulty":"EASY"|"NORMAL"|"HARD"}]}`. `bots` has 1–3 entries.
- `{"type":"answer", "requestId":str, "optionIds":[ids]}`. For `integer` it is `{"value":int}`, for `text` it is `{"text":str}`, and for `damage`/`amount` it is `{"amounts":{targetId:int}}`.
- `{"type":"action", "action":"selectCard"|"selectPlayer"|"selectStackItem"|"ok"|"cancel"|"useMana"|"concede", "id":str?, "color":"W|U|B|R|G|C"?}`

---

### Task 1: Repo, Forge submodule, engine skeleton that boots Forge headless

**Files:**
- Create: `.gitmodules` (convert the existing `forge/` clone into a submodule pinned at `ccff857b`), `.gitignore` (`engine/target/`, `app/node_modules/`, `app/out/`, `app/dist/`, `.superpowers/`), `LICENSE` (GPL-3.0 text), `README.md` (stub: what it is, how to build), `scripts/build-forge.ps1`
- Create: `engine/pom.xml`, `engine/src/main/java/app/commanderduel/forge/ForgeBootstrap.java`, `engine/src/main/java/app/commanderduel/forge/BridgeGuiBase.java`
- Test: `engine/src/test/java/app/commanderduel/forge/ForgeBootstrapTest.java`

**Interfaces:**
- Produces:
  - `ForgeBootstrap.init(Path forgeGuiDir, Path dataDir)`. It is idempotent: a static guard ensures a second call is a no-op.
  - `BridgeGuiBase implements IGuiBase` with `ExecutorService edt()`.
  - `BridgeGuiBase.isGuiThread()` returns true only on the EDT executor's thread.

- [ ] **Step 1: Pin Forge as a submodule.** The repo root already has `git init` and a shallow clone at `forge/`. Register it with `git submodule add https://github.com/Card-Forge/forge.git forge` (move the clone aside first if git refuses, then re-add), then check out `ccff857b`. Verify with `git submodule status`, which should print `ccff857b... forge`.
- [ ] **Step 2: Write `scripts/build-forge.ps1`.** It runs `mvn -B -pl forge-gui -am install -DskipTests -Dcheckstyle.skip` inside `forge/`, with `JAVA_HOME` set to Temurin 17 if unset. Run it and expect exit 0 and `forge-gui-2.0.16-SNAPSHOT.jar` installed in `~/.m2`.
- [ ] **Step 3: Write `engine/pom.xml`.**
  - Coordinates: groupId `app.commanderduel`, artifact `commander-duel-engine`, version `0.1.0`, Java release 17.
  - Dependencies: `forge:forge-gui:2.0.16-SNAPSHOT` and `forge:forge-ai:2.0.16-SNAPSHOT`, `org.java-websocket:Java-WebSocket:1.5.7`, and JUnit Jupiter 5.10.2 (test scope).
  - Surefire 3.2.5 with `-Xmx2g`.
  - Shade plugin 3.6.0: main class `app.commanderduel.Main`, output `engine/target/commander-duel-engine.jar`. Include the `ServicesResourceTransformer` and exclude signature files.
  - If Maven can't resolve Forge's `${revision}` parent from `~/.m2`, add `-Drevision=2.0.16-SNAPSHOT` to `engine/.mvn/maven.config` and record that in the README.
- [ ] **Step 4: Write the failing test `ForgeBootstrapTest`:**

```java
@BeforeAll static void boot() { ForgeBootstrap.init(Path.of("../forge/forge-gui"), Files.createTempDirectory("cd")); }
@Test void loadsCommanderPrecons() { assertTrue(FModel.getDecks().getCommanderPrecons().size() >= 150); }
@Test void resolvesCardByName() { assertNotNull(StaticData.instance().getCommonCards().getCard("Sol Ring")); }
@Test void actionableHighlightsEnabled() { assertTrue(FModel.getPreferences().getPrefBoolean(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS)); }
@Test void initTwiceIsNoOp() { assertDoesNotThrow(() -> ForgeBootstrap.init(Path.of("../forge/forge-gui"), Path.of("."))); }
```

- [ ] **Step 5: Run the test to verify it fails.** Run `mvn -q test -Dtest=ForgeBootstrapTest` in `engine/`. Expect a compile failure: `ForgeBootstrap` doesn't exist yet.
- [ ] **Step 6: Implement `BridgeGuiBase`.**
  - Base it on `forge-gui/tools/java/ForgeMatrixWriter.java` lines 150-202 (`HeadlessGui`), but `isGuiThread()` checks the EDT thread.
  - `invokeInEdtNow` runs inline when already on the EDT. `invokeInEdtAndWait` uses `submit().get()`, or runs inline when on the EDT.
  - `runBackgroundTask` uses a cached pool.
  - `getAssetsDir()` returns `forgeGuiDir` plus a trailing `/`.
  - `isLibgdxPort()` returns `false`, so Forge uses board-click inputs and our UI drives them.
  - `getNewGuiGame()` throws `UnsupportedOperationException`.
  - `hostMatch()` returns `new HostedMatch()`.
  - `getAvatarCount`/`getSleevesCount` return 0.
  - All image and audio methods return null/false.
- [ ] **Step 7: Implement `ForgeBootstrap.init`.**
  - Call `GuiBase.setInterface` first.
  - Point Forge's profile at `dataDir`. Check how `ForgeProfileProperties` reads its user/cache dirs, and set them before `FModel.initialize`.
  - Call `FModel.initialize(null, prefs -> { ... })` with these prefs:
    - `UI_LANGUAGE=en-US`, `PLAYER_NAME=You`
    - `UI_SHOW_ACTIONABLE_HIGHLIGHTS=true`, `LOAD_CARD_SCRIPTS_LAZILY=false`
    - `UI_RECORD_REPLAYS=false`, `ENFORCE_DECK_LEGALITY=false`
- [ ] **Step 8: Run the test to verify it passes.** Expect 4 tests passing. A cold card-script load can take up to ~60 s; that's fine.
- [ ] **Step 9: Commit:** `git add -A && git commit -m "feat(engine): boot Forge headless with bridge IGuiBase"`

### Task 2: PendingRequests — option ids and answer validation

**Files:**
- Create: `engine/src/main/java/app/commanderduel/protocol/PendingRequests.java`, `protocol/Json.java`
- Test: `engine/src/test/java/app/commanderduel/protocol/PendingRequestsTest.java`

**Interfaces:**
- Produces:
  - `final class PendingRequests` with:
    - `<T> Pending<T> open(String kind, List<T> options, int min, int max)`. It assigns `requestId` `"r"+counter` and option ids `"o0".."oN"` in list order.
    - `Pending<T>` exposes `requestId()`, `optionIds()`, `CompletableFuture<List<T>> future()`.
    - `Result answer(String requestId, List<String> optionIds)`. `Result` is a record `(boolean ok, String reason)`. On success it completes the future with the original objects (same identity, in the given order) and removes the request.
    - `void cancelAll()` completes all open futures exceptionally with `CancellationException`. It is used at game end and on disconnect.
  - For kinds without options (`integer`, `text`, `damage`, `amount`): `<R> PendingValue<R> openValue(String kind, Predicate<R> validator)` and `Result answerValue(String requestId, Object value)`.
  - `Json.GSON`: a `Gson` with `serializeNulls`.

- [ ] **Step 1: Write the failing tests:**

```java
@Test void answerReturnsSameObjectsInOrder()   // open(["a","b","c"],1,2); answer(id,["o2","o0"]) -> future == ["c","a"] (assertSame each)
@Test void unknownOptionRejected()             // answer(id,["o9"]) -> ok=false, reason contains "o9"; future not done
@Test void tooFewOrTooManyRejected()           // min1 max1: [] rejected, ["o0","o1"] rejected
@Test void duplicateIdsRejected()              // ["o0","o0"] rejected
@Test void unknownRequestIdRejected()          // answer("r999",...) -> ok=false
@Test void secondAnswerRejected()              // valid answer, then same answer again -> ok=false
@Test void cancelAllFailsOpenFutures()         // future completes exceptionally with CancellationException
@Test void valueValidatorEnforced()            // openValue("integer", v -> v>=0 && v<=3); answerValue(id,5) rejected; 2 accepted
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `mvn -q test -Dtest=PendingRequestsTest`. Expect a compile failure.
- [ ] **Step 3: Implement it.** Use a `ConcurrentHashMap<String, Entry>`, with the counter in an `AtomicLong`. Answers come from the WebSocket thread while futures are awaited on Forge's game thread.
- [ ] **Step 4: Run the tests to verify they pass.** Expect 8 passing.
- [ ] **Step 5: Commit:** `feat(engine): request/option registry with strict answer validation`

### Task 3: StateMapper — GameView to JSON snapshot with hidden-info rules

**Files:**
- Create: `engine/src/main/java/app/commanderduel/protocol/Dto.java`, `protocol/StateMapper.java`
- Test: `engine/src/test/java/app/commanderduel/protocol/StateMapperTest.java`

**Interfaces:**
- Consumes: `ForgeBootstrap.init` (Task 1)
- Produces:
  - `Dto.GameState(int turn, String phase, String activePlayerId, String priorityPlayerId, String youId, List<PlayerDto> players, Map<String,CardDto> cards, List<StackItemDto> stack, List<AttackDto> combat)`
  - `Dto.PlayerDto(String id, String name, boolean you, int life, int poison, Map<String,Integer> commanderDamage, Map<String,Integer> manaPool, List<String> hand, int handCount, int libraryCount, List<String> graveyard, List<String> exile, List<String> command, List<String> battlefield)`
  - `Dto.CardDto(String id, String name, String ownerId, String controllerId, String zone, boolean tapped, boolean sick, boolean hidden, String imageUrl, String manaCost, String typeLine, String text, String power, String toughness, int damage, Map<String,Integer> counters, String attachedToId, boolean commander)`
  - `Dto.StackItemDto(String id, String text, String sourceCardId, String activatorId, List<String> targetIds)`
  - `Dto.AttackDto(String attackerId, String defenderId, List<String> blockerIds)`
  - `static Dto.GameState StateMapper.map(GameView game, PlayerView viewer)`
  - `phase` is the `PhaseType` enum name, e.g. `MAIN1`. `imageUrl` is `https://api.scryfall.com/cards/` plus `ImageUtil.getScryfallDownloadUrl(paperCard, face, scryfallSetCode, "en", false)`. It is `null` when hidden or unresolvable.

- [ ] **Step 1: Write the failing tests.** Build a real `Game` without a GUI:
  - `new Match(GameRules(Commander, variants={Commander}), [forCommander(preconA) with AI lobby player, forCommander(preconB) with AI lobby player], "t").createGame()`.
  - Treat player 0 as the viewer.
  - Use `game.getAction().moveToHand/moveToPlay` to place cards, and `card.turnFaceDown()` for the face-down case.

```java
@Test void opponentHandIsCountOnly()        // opp.hand() is empty, opp.handCount()==7; no CardDto for those cards in cards map
@Test void viewerHandIsListed()             // viewer.hand().size()==7, each id present in cards with name != null
@Test void libraryIsCountOnly()             // libraryCount == 99 - 7 (after drawing 7); no library card ids in cards map
@Test void faceDownOpponentCardHasNoName()  // card on opp battlefield face down -> hidden==true, name==null, imageUrl==null
@Test void commanderInCommandZone()         // viewer.command() contains id whose CardDto.commander==true and life==40
@Test void imageUrlIsScryfall()             // a visible Sol Ring -> imageUrl startsWith "https://api.scryfall.com/cards/"
@Test void serializesToJson()               // Json.GSON.toJson(state) contains "\"phase\""
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `mvn -q test -Dtest=StateMapperTest`.
- [ ] **Step 3: Implement `StateMapper.map`.**
  - Visibility uses Forge's own check: the `CardView` method that tests whether a card may be shown to a given `PlayerView`, as used by Forge's own zone rendering (`canBeShownTo`; confirm the name in `forge-game/.../card/CardView.java`).
  - A card the viewer can't see on a public zone gets `hidden=true` and all text fields null.
  - Hidden hand and library cards are never put in `cards`.
  - Card fields come from `CardView` / `CardView.getCurrentState()`.
- [ ] **Step 4: Run the tests to verify they pass.** Expect 7 passing.
- [ ] **Step 5: Commit:** `feat(engine): game snapshot mapper with hidden-information rules`

### Task 4: DeckStore — import, validate, save, list

**Files:**
- Create: `engine/src/main/java/app/commanderduel/decks/DeckStore.java`
- Test: `engine/src/test/java/app/commanderduel/decks/DeckStoreTest.java`

**Interfaces:**
- Consumes: Task 1 bootstrap
- Produces:
  - `DeckStore(Path decksDir)`
  - `ImportResult importDeck(String name, List<String> commanders, List<Entry> main)`. `Entry(int count, String name)`. `ImportResult(boolean ok, DeckSummary deck, List<String> unknownCards, List<String> problems)`.
  - `List<DeckSummary> list()`. `DeckSummary(String id, String name, List<String> commanders)`, where `id` is the file stem.
  - `Deck load(String id)`
  - `List<DeckSummary> precons()`. The `id` is the precon's name in `FModel.getDecks().getCommanderPrecons()`.
  - `Deck loadPrecon(String id)`
  - `Deck randomPrecon(Random rnd)`
- Rules:
  - A name resolves via `CardDb.getCard(name)`. On failure, retry with the front face name before `" // "`.
  - Unknown names: `ok=false`, nothing saved.
  - 0 commanders: `ok=false` with problem `"No commander found — mark your commander in Archidekt's Commander category"`.
  - Otherwise save with `DeckSerializer` to `decksDir/<sanitized name>.dck`, overwriting on the same name.
  - `problems` gets `DeckFormat.Commander.getDeckConformanceProblem(deck)` when it is non-null. It's a warning only: still `ok=true`, since users test unfinished decks.

- [ ] **Step 1: Write the failing tests:**

```java
@Test void importsAndListsDeck()            // commanders ["Atraxa, Praetors' Voice"], main 99 lines -> ok, list() has it, load(id).getCommanders().size()==1
@Test void unknownCardsReportedByName()     // main includes "Not A Real Card" -> ok=false, unknownCards==["Not A Real Card"], list() empty
@Test void partnersBecomeTwoCommanders()    // ["Thrasios, Triton Hero","Tymna the Weaver"] -> load().getCommanders().size()==2
@Test void noCommanderIsProblem()           // [] commanders -> ok=false, problems.get(0) startsWith "No commander"
@Test void splitCardFrontFaceResolves()     // "Fire // Ice" and "Fire" both resolve
@Test void preconsListed()                  // precons().size() >= 150; loadPrecon(first.id()).getCommanders() non-empty
@Test void illegalDeckStillSavesWithWarning() // 10-card deck -> ok=true, problems non-empty
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `mvn -q test -Dtest=DeckStoreTest`.
- [ ] **Step 3: Implement it.** Use `Deck.getOrCreate(DeckSection.Commander).add(paperCard, 1)` and `deck.getMain().add(paperCard, count)`.
- [ ] **Step 4: Run the tests to verify they pass.** Expect 7 passing.
- [ ] **Step 5: Commit:** `feat(engine): deck import/storage with precon access`

### Task 5: BridgeGuiGame + MatchStarter — a full game playable over a Transport

**Files:**
- Create:
  - `engine/src/main/java/app/commanderduel/forge/BridgeGuiGame.java`
  - `transport/Transport.java`
  - `match/MatchStarter.java`
  - `match/Difficulty.java`
- Test:
  - `engine/src/test/java/app/commanderduel/match/ScriptedClient.java` (test helper)
  - `engine/src/test/java/app/commanderduel/match/BridgeGameTest.java`

**Interfaces:**
- Consumes: `PendingRequests` (Task 2), `StateMapper` (Task 3), `DeckStore` (Task 4).
- Produces:
  - `interface Transport { void send(String json); }`
  - `BridgeGuiGame(Transport out, PendingRequests pending) extends forge.gamemodes.net.NetworkGuiGame`. Model it on `forge-gui-desktop/src/test/java/forge/net/HeadlessNetworkGuiGame.java`.
  - `void BridgeGuiGame.onAction(String action, String id, String color)` dispatches to `getGameController(you)`:
    - `selectCard` → `selectCard(cardView, null, null)`. The `CardView` is resolved by id from `getGameView()`. An unknown id gets a `rejected` message.
    - `selectPlayer`, `selectStackItem`, `ok` → `selectButtonOk`, `cancel` → `selectButtonCancel`, `useMana` → `useMana(MagicColor byte)`, `concede`.
  - `Difficulty { EASY("Cautious", none), NORMAL("Default", none), HARD("Default", {USE_HYBRID_SIMULATION}) }` with `String profile()` and `Set<AIOption> options()`.
  - `MatchStarter.start(Deck you, List<BotSpec> bots, BridgeGuiGame gui) -> HostedMatch`. `BotSpec(Deck deck, Difficulty difficulty, String name)`.
    - Calls `startMatch(GameType.Commander, EnumSet.of(GameType.Commander), players, human, gui)`.
    - Seats the human first. Bots are named `"<commander name> Bot"`. Every player gets a distinct team number.
- Behavior:
  - Notification overrides (`updatePhase`, `updateZones`, `updateCards`, `updateStack`, `updateLives`, `updateManaPool`, `showCombat`, `setGameView`, `openView`, ...) schedule one debounced 50 ms `state` send via `StateMapper.map(getGameView(), you)`.
  - `showPromptMessage` + `updateButtons` → `prompt`. `inputKind` comes from the class of the current input on the human's `InputQueue`: `InputPassPriority`→`priority`, `InputConfirmMulligan`/`InputLondonMulligan`→`mulligan`, `InputAttack`→`attack`, `InputBlock`→`block`, `InputPayMana*`→`payMana`, `InputSelectTargets`→`target`, `InputSelect*`→`select`, `InputLockUI`→`wait`, else `other`.
  - `setSelection` → `selection`, `setWeaklySelectable`/`clearWeaklySelectable` → `playable`.
  - Each blocking method opens a `PendingRequests` entry, sends `request`, and blocks on `future().get()`:
    - `getChoices`, `order`, `confirm`, `showConfirmDialog`, `showOptionDialog`, `showInputDialog`
    - `getAbilityToPlay`, `assignCombatDamage`, `assignGenericAmount`
    - `chooseSingleEntityForEffect`, `chooseEntitiesForEffect`, `manipulateCardList`
  - `getChoices` with `min=max=-1` (reveal-only) sends a `choose` request with `min=0,max=0`. The single OK answer is `optionIds=[]`.
  - `message`/`showErrorDialog` send `prompt`-free `error`/info and return immediately.
  - `finishGame`/`afterGameEnd` send `gameOver` and call `pending.cancelAll()`.
  - `isUiSetToSkipPhase` returns false.

- [ ] **Step 1: Write `ScriptedClient implements Transport` (test helper).**
  - It records every message.
  - On `request` it answers with the first `min` options, or `[]`. For `integer` it answers `min`, and for `damage` it puts all damage on the first target.
  - On `prompt` with `ok.enabled`, it sends `action ok`.
  - It runs answers on its own thread.
  - It keeps `List<String> rejections`.
- [ ] **Step 2: Write the failing tests:**

```java
@Test void humanVsBotPlaysToTurn4WithNoRejections()  // start(precon A, [precon B NORMAL]); wait until state.turn>=4 or 120s; assert rejections empty and >0 "state" messages
@Test void threeBotPodStarts()                        // 3 bots; first state has 4 players, each life 40, each command zone non-empty
@Test void playableMessagesSent()                     // at least one "playable" message with non-empty cardIds during human main phase
@Test void bogusActionIdRejected()                    // onAction("selectCard","999999",null) -> a "rejected" message, game continues
@Test void bogusAnswerRejected()                      // when a request arrives, answer with ["o999"] first -> "rejected"; request still answerable; game continues
@Test void concedeEndsGameWithGameOver()              // onAction("concede") vs 1 bot -> "gameOver" with youWon=false within 30s
```

- [ ] **Step 3: Run the tests to verify they fail.** Run `mvn -q test -Dtest=BridgeGameTest`.
- [ ] **Step 4: Implement `Transport`, `Difficulty`, `MatchStarter`, `BridgeGuiGame`.** Answers map back to the original Java objects through `PendingRequests` (Task 2). Never construct new choice objects.
- [ ] **Step 5: Run the tests to verify they pass.** Expect 6 passing. Debug hangs with `jstack`: the game thread should be parked in `future().get()` or `awaitInput`.
- [ ] **Step 6: Commit:** `feat(engine): bridge GUI game relaying all engine decisions`

### Task 6: EngineServer, Session, Main — engine over WebSocket

**Files:**
- Create: `engine/src/main/java/app/commanderduel/transport/EngineServer.java`, `session/Session.java`, `Main.java`
- Test: `engine/src/test/java/app/commanderduel/session/EngineServerTest.java`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `java -jar commander-duel-engine.jar --forge <forge-gui dir> --data <dir> --token <hex>`. It prints exactly one stdout line `READY port=<n>` once listening, and exits when its client disconnects for more than 10 s with no game running.
  - `EngineServer(int port0, String token, Session session)` binds `127.0.0.1`.
    - Connections without `?token=<token>` are closed with code 4001.
    - A second concurrent client is closed with code 4002.
  - `Session.onMessage(String json)` handles `listLobby`, `importDeck`, `startGame`, `answer`, `action`, per the Wire Protocol above.
    - `startGame` while a game is running concedes the old one first.
    - Malformed JSON returns `error`.

- [ ] **Step 1: Write the failing tests** (use Java-WebSocket's `WebSocketClient`):

```java
@Test void rejectsMissingToken()          // connect without token -> onClose code 4001
@Test void secondClientRejected()         // 2nd connection -> 4002
@Test void readyThenLobby()               // receive {"type":"ready"}; send listLobby -> lobby.precons.size()>=150
@Test void importThenStartGame()          // importDeck (a precon's lines) ok -> startGame with 1 RANDOM precon bot -> "state" arrives within 60s
@Test void malformedJsonGivesError()      // send "{" -> {"type":"error"}
```

- [ ] **Step 2: Run the tests to verify they fail.**
- [ ] **Step 3: Implement it.** `Main` uses `SecureRandom`-free args; the token comes from the parent. Run `ForgeBootstrap.init` before binding.
- [ ] **Step 4: Run the tests to verify they pass.** Then run `mvn -q package` and expect `engine/target/commander-duel-engine.jar`. Manually run `java -jar engine/target/commander-duel-engine.jar --forge forge/forge-gui --data %TEMP%\cd --token abc` and expect `READY port=...`.
- [ ] **Step 5: Commit:** `feat(engine): localhost WebSocket server and session routing`

### Task 7: Electron app shell — spawn engine, connect, typed client

**Files:**
- Create:
  - `app/package.json` (versions from the Tech Stack; scripts `dev`, `build`, `test`=`vitest run`, `dist`)
  - `app/electron.vite.config.ts`, `app/tsconfig.json`
  - `app/electron/main.ts`, `app/electron/engineProcess.ts`, `app/electron/preload.ts`
  - `app/src/main.tsx`, `app/src/App.tsx`
  - `app/src/net/protocol.ts`, `app/src/net/engineClient.ts`, `app/src/state/store.ts`
- Test: `app/src/net/engineClient.test.ts`, `app/electron/engineProcess.test.ts`

**Interfaces:**
- Consumes: the Task 6 CLI and Wire Protocol.
- Produces:
  - `protocol.ts` exports TS types mirroring every message above and `Dto` (`GameState`, `PlayerDto`, `CardDto`, ...), plus `type EngineMessage`, `type UiMessage`.
  - `class EngineClient`:
    - `connect(url: string): void`
    - `send(m: UiMessage): void`
    - `on(handler: (m: EngineMessage | {type:'engineStopped'}) => void): () => void`
    - On socket close it emits `{type:'engineStopped'}`.
  - `engineProcess.ts`:
    - `startEngine(opts:{javaPath, jarPath, forgeDir, dataDir}): Promise<{port:number, token:string, child}>`. It resolves on the `READY port=` line and rejects on exit before READY or after 120 s.
    - `parseReadyLine(line:string): number|null`
  - `window.duel` (preload): `{ getEngine(): Promise<{port,token}>, restartEngine(): Promise<{port,token}>, importArchidekt(url:string): Promise<ArchidektResult> }`.
  - Dev paths:
    - java: `%JAVA_HOME%\bin\java.exe`
    - jar: `../engine/target/commander-duel-engine.jar`
    - forgeDir: `../forge/forge-gui`
    - dataDir: `app.getPath('userData')`
  - Packaged paths: `process.resourcesPath` + `jre/bin/java.exe`, `engine/commander-duel-engine.jar`, `forge-gui`.
  - `store.ts` zustand slices: `screen: 'decks'|'setup'|'board'|'gameOver'|'engineStopped'`, `lobby`, `game: GameState|null`, `prompt`, `selection`, `playable: Set<string>`, `requests: RequestMsg[]` (FIFO), `lastRejection`, and the `respondMode` setting (Task 12).

- [ ] **Step 1: Write the failing tests:**

```ts
test('parseReadyLine', () => { expect(parseReadyLine('READY port=51234')).toBe(51234); expect(parseReadyLine('INFO x')).toBeNull(); });
test('close event surfaces engine-stopped', ...) // mock WebSocket (vi.stubGlobal), connect, trigger onclose -> handler got {type:'engineStopped'}
test('parses state message into store', ...)      // feed {"type":"state",...fixture} -> store.game.turn === fixture.turn
test('requests are queued FIFO', ...)              // two request msgs -> store.requests ids in order
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npm test` in `app/`.
- [ ] **Step 3: Implement it.**
  - The window is 1280×720 minimum, `contextIsolation: true`, `nodeIntegration: false`.
  - The CSP allows `ws://127.0.0.1:*` and `card:`.
  - On `engineStopped` the store sets `screen='engineStopped'`. That screen shows "The game engine stopped" and a "Back to menu" button that calls `restartEngine()` and reconnects.
- [ ] **Step 4: Run the tests to verify they pass.** Then run `npm run dev` and verify the window opens and shows "Engine connected · N precons".
- [ ] **Step 5: Commit:** `feat(app): electron shell with engine lifecycle and typed client`

### Task 8: Archidekt import + Decks screen

**Files:**
- Create: `app/electron/archidekt.ts`, `app/src/screens/Decks.tsx`, `app/electron/__fixtures__/archidekt-deck.json`
- Test: `app/electron/archidekt.test.ts`

**Interfaces:**
- Produces:
  - `parseDeckId(urlOrId: string): string|null`. It accepts `https://archidekt.com/decks/123456/slug`, `archidekt.com/decks/123456`, and `123456`.
  - `fetchArchidekt(id): Promise<ArchidektResult>`. It GETs `https://archidekt.com/api/decks/<id>/`.
  - `parseArchidekt(json): ArchidektResult`, where `ArchidektResult = {ok:true, name, commanders:string[], main:{count,name}[]} | {ok:false, error:string}`.
- Rules:
  - A card is a commander if any of its categories is `Commander`.
  - Cards whose every category has `includedInDeck === false` in the deck's top-level `categories` list are dropped (Maybeboard, Sideboard, ...).
  - The name comes from `card.oracleCard.name`.
  - HTTP 404/403 means `"That deck is private or doesn't exist. In Archidekt, set it to Public or Unlisted."`
  - A network failure means `"Couldn't reach Archidekt — check your internet connection."`
  - Paste fallback: `parseTextList(text)` accepts `1 Sol Ring` lines. A `Commander` header or a `*CMDR*` suffix marks commanders.

- [ ] **Step 1: Capture a real fixture.** Fetch a public Commander deck from `https://archidekt.com/api/decks/<id>/` and save it to `__fixtures__/archidekt-deck.json`. Record the real field names. If they differ from the names above, adapt the parser and keep this plan's behavior.
- [ ] **Step 2: Write the failing tests:**

```ts
test('parseDeckId variants')                 // three forms above -> '123456'; 'https://example.com' -> null
test('fixture yields commander and 99ish')   // commanders.length>=1; sum(main.count)+commanders.length === 100 for a legal fixture
test('maybeboard excluded')                  // inject a card with category "Maybeboard"(includedInDeck false) -> absent
test('private deck gives readable error')    // mock fetch 404 -> ok:false, error contains "Public or Unlisted"
test('parseTextList handles *CMDR*')
```

- [ ] **Step 3: Run the tests to verify they fail.**
- [ ] **Step 4: Implement the parser, the IPC handler `importArchidekt`, and `Decks.tsx`.**
  - `Decks.tsx` has a list of imported decks and a paste box: "Paste an Archidekt link or a decklist".
  - Submitting sends `importDeck`, then shows the `importResult`: success, the unknown cards listed by name, or problems shown as warnings.
  - The "Play" button on a deck goes to Setup.
- [ ] **Step 5: Run the tests to verify they pass.** Then manually import the fixture deck's real URL and expect it to appear in the list.
- [ ] **Step 6: Commit:** `feat(app): Archidekt and text decklist import`

### Task 9: Card images — card:// protocol with disk cache and Scryfall pacing

**Files:**
- Create: `app/electron/cardImages.ts`, `app/src/components/Card.tsx`, `app/src/styles/card.css`
- Test: `app/electron/cardImages.test.ts`, `app/src/components/Card.test.tsx`

**Interfaces:**
- Produces:
  - `cacheFileFor(url: string, dir: string): string` is the sha1 of the url plus `.jpg`.
  - `class FetchQueue { constructor(minGapMs=100, fetchFn); get(url): Promise<Buffer> }`. It serializes requests at least 100 ms apart and dedupes concurrent requests for the same url.
  - `registerCardProtocol(dir)`. `card://img?u=<encodeURIComponent(scryfallUrl)>` serves from cache or fetches. Only `https://api.scryfall.com/cards/` URLs are allowed; anything else gets a 400.
  - `<Card card={CardDto|undefined} size="hand"|"field"|"stack" glow={boolean} selectable={boolean} chosen={boolean} onClick?>`. `hidden`/undefined renders the CSS card back. A missing image renders a text frame with name, cost, type, and P/T.
  - Classes:
    - `glow` = the blue `#4fb3ff` ring and lift from the mockup
    - `selectable` = a gold `#d4a64a` ring
    - `chosen` = a solid white ring
    - `tapped` = rotate 90°
  - `size` dimensions: hand 108×150, field 74×104, stack 86×120.

- [ ] **Step 1: Write the failing tests:**

```ts
test('queue spaces requests >=100ms')        // 3 urls with fake timers -> fetchFn call times differ by >=100
test('queue dedupes same url')               // 2 concurrent gets -> fetchFn called once
test('rejects non-scryfall urls')
test('Card hidden renders back, no name')    // render <Card card={{...hidden:true,name:null}}/> -> no text, has .card-back
test('Card glow adds class')
```

- [ ] **Step 2: Run the tests to verify they fail.**
- [ ] **Step 3: Implement it.** Use `protocol.handle('card', ...)` in main.
- [ ] **Step 4: Run the tests to verify they pass.**
- [ ] **Step 5: Commit:** `feat(app): cached Scryfall card images and Card component`

### Task 10: Setup screen

**Files:**
- Create: `app/src/screens/Setup.tsx`, `app/src/logic/setupPayload.ts`
- Test: `app/src/logic/setupPayload.test.ts`

**Interfaces:**
- Consumes: `lobby` (Task 7), the Task 8 decks.
- Produces: `buildStartGame(deckId: string, bots: BotChoice[]): UiMessage`. `BotChoice = {deck: {kind:'randomPrecon'}|{kind:'precon',id}|{kind:'imported',id}, difficulty:'EASY'|'NORMAL'|'HARD'}`. It throws when `bots.length` is outside 1..3 or `deckId` is empty.
- UI:
  - Your deck (select).
  - Pod size: 1/2/3 bots.
  - Per bot:
    - A deck select whose first option is "Random precon", then a searchable precon list (filter by name or commander), then "My decks".
    - Difficulty segmented control Easy/Normal/Hard, default Normal.
  - "Start game".

- [ ] **Step 1: Write the failing tests:**

```ts
test('builds payload for 3 bots')   // matches Wire Protocol startGame shape exactly
test('rejects 0 and 4 bots')
test('default bot is randomPrecon NORMAL')  // defaultBot() === {deck:{kind:'randomPrecon'},difficulty:'NORMAL'}
```

- [ ] **Step 2: Run the tests to verify they fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests to verify they pass.** Then manually start a game and expect the screen to change to `board` on the first `state`.
- [ ] **Step 5: Commit:** `feat(app): game setup screen`

### Task 11: Board, prompt bar, and request dialogs

**Files:**
- Create:
  - `app/src/screens/Board.tsx`, `app/src/screens/GameOver.tsx`
  - `app/src/components/{Hand,Battlefield,PlayerPanel,PhaseBar,PromptBar,StackView,RequestDialog}.tsx`
  - `app/src/styles/board.css`
- Test: `app/src/components/RequestDialog.test.tsx`, `app/src/screens/Board.test.tsx`

**Interfaces:**
- Consumes: the store (Task 7), `Card` (Task 9), `EngineClient.send`.
- Layout follows mockup screen 1:
  - Opponent strips across the top. With 2–3 opponents, the top row splits into equal columns, each with a `PlayerPanel` (name, life, hand count, library count, commander damage taken from that player) and their battlefield.
  - The phase bar shows `Untap, Upkeep, Draw, Main 1, Combat, Main 2, End`. It maps the `PhaseType` enum names, with combat sub-steps highlighting "Combat" and `CLEANUP`/`END_OF_TURN` highlighting "End". It also shows "Your turn · Turn N" or "<name>'s turn".
  - Your battlefield has the command zone on the left.
  - Your hand is centered at the bottom.
  - The right column holds `PromptBar` (message plus the `ok`/`cancel` buttons, each exactly as labeled and enabled by the engine) and `StackView` when the stack is non-empty.
  - Your mana pool shows clickable pips when non-empty, each sending `useMana`.
- Click rules:
  - A card click sends `selectCard`, a player panel click sends `selectPlayer`, and a stack item click sends `selectStackItem`.
  - The UI sends clicks only for objects present in `game`. It does not filter by glow, since the engine decides.
  - Glow is applied when an id is in `playable` and no `selection` is active.
  - With a selection active, `selectable` ids get the gold ring and `chosen` ids the white ring.
- `RequestDialog`: a modal for the head of `requests`. It renders by `kind`:
  - `choose`/`entity`: a list or card grid, enforcing min/max on the Confirm button.
  - `order`: drag or up/down buttons, submitting all ids in order.
  - `confirm`/`ability`: one button per option.
  - `integer`: a number stepper clamped to min..max.
  - `text`: an input.
  - `damage`/`amount`: a stepper per target, Confirm enabled when the sum equals `amount`.
  - `manipulate`: the ordered list.
  - It sends exactly one `answer`, with ids taken only from `options`.
  - On `rejected` for that `requestId`, it shows the reason inline and stays open.
- `GameOver`: "You won" or "<names> won", plus "Play again" (same setup) and "Back to decks".

- [ ] **Step 1: Write the failing tests:**

```ts
test('choose dialog enforces min/max')         // min1 max1, Confirm disabled until one picked; two picks impossible
test('answer only contains offered ids')        // click options -> sent optionIds ⊆ options.map(o=>o.id)
test('damage dialog requires exact total')
test('rejected keeps dialog open with reason')
test('glowing cards = playable ∩ your hand/battlefield; none when selection active')
test('ok button mirrors engine label and enabled flag')  // prompt ok {label:"Keep",enabled:false} -> button "Keep" disabled
test('opponent hand renders count of card backs')
```

- [ ] **Step 2: Run the tests to verify they fail.**
- [ ] **Step 3: Implement the components.** Reuse the mockup palette:
  - Ground `#0b1322`, panels `#121c31`, borders `#24324f`.
  - Gold `#d4a64a`, glow `#4fb3ff`.
  - Fonts: Cinzel for life totals and headings, Inter for body text, loaded from Google Fonts with system fallbacks.
  - Animate card moves with a CSS transform transition of 200 ms.
- [ ] **Step 4: Run the tests to verify they pass.** Then manually play a game vs 1 Easy bot through mulligan, land drop, casting a spell (paying mana by clicking lands and by "Auto" if the engine offers it), attacking, and blocking. Expect no `rejected` messages from normal play.
- [ ] **Step 5: Commit:** `feat(app): game board, prompt bar, and engine request dialogs`

### Task 12: Timing popup and "Ask me to respond" setting

**Files:**
- Create: `app/src/logic/respondPolicy.ts`, `app/src/components/ResponsePopup.tsx`
- Modify: `app/src/screens/Board.tsx` (mount the popup), `app/src/state/store.ts` (`respondMode` persisted to `localStorage`, default `'smart'`)
- Test: `app/src/logic/respondPolicy.test.ts`, `app/src/components/ResponsePopup.test.tsx`

**Interfaces:**
- Produces: `decideResponse(input:{prompt, game, playable:Set<string>, mode:'always'|'smart'|'never', youId}): 'popup'|'autoPass'|'none'`. Rules:
  - If `prompt.inputKind !== 'priority'` or `prompt.ok?.enabled !== true`, return `'none'`.
  - If `game.priorityPlayerId !== youId` or the stack is empty, return `'none'`.
  - If the top stack item's `activatorId === youId`, return `'none'` (your own spell: the normal prompt bar handles it).
  - `always` returns `'popup'`.
  - `smart` returns `'popup'` if `playable.size > 0`, else `'autoPass'`.
  - `never` returns `'autoPass'`.
- `autoPass` sends `{type:'action', action:'ok'}` exactly once per distinct `(stack top id, prompt)` pair.
- `ResponsePopup` follows mockup screen 2:
  - Title "<player> is casting a spell" (or "… activated an ability").
  - The source card, an arrow, and its targets.
  - The stack item text.
  - The "What's happening?" explainer, dismissible, with the copy fixed by the mockup: *"The spell is on the stack and hasn't happened yet. You have priority, which means you can cast an instant or use an ability now. Whatever you cast goes on top and resolves first."*
  - The glowing playable cards; clicking one sends `selectCard`.
  - "Let it resolve" sends `ok`, labeled with the engine's ok label if it differs.
  - The "Ask me to respond: Every time / Only when I have a response / Never" control.

- [ ] **Step 1: Write the failing tests:**

```ts
test('opponent spell + playable -> popup in smart')
test('opponent spell + nothing playable -> autoPass in smart')
test('own spell on stack -> none')
test('empty stack -> none')
test('never auto-answers non-priority prompts')   // inputKind 'target' | 'payMana' | 'select' | 'mulligan' with mode 'never' -> 'none'
test('autoPass sends ok once per stack item')      // re-render with same state -> one send
test('popup Let it resolve sends ok')
```

- [ ] **Step 2: Run the tests to verify they fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests to verify they pass.** Then manually play vs a blue precon bot (pick one with counterspells or instants) and confirm the popup appears on their spells, and auto-passes in `smart` when you have nothing to play.
- [ ] **Step 5: Commit:** `feat(app): timing popup with respond policy`

### Task 13: Windows installer

**Files:**
- Create: `scripts/package.ps1`, `app/electron-builder.yml`
- Modify: `README.md` (build and install instructions, Fan Content Policy notice, GPL notice)

**Interfaces:**
- Consumes: the engine jar (Task 6) and the app build (Tasks 7–12).
- `scripts/package.ps1` does, in order:
  1. `scripts/build-forge.ps1`.
  2. `mvn -q -f engine/pom.xml package -DskipTests`.
  3. Builds a jlink runtime into `build/jre`. The modules come from `jdeps --ignore-missing-deps --print-module-deps engine/target/commander-duel-engine.jar`, plus `jdk.crypto.ec,jdk.unsupported` (Scryfall TLS, Forge reflection). It uses `--strip-debug --no-header-files --no-man-pages`.
  4. `npm ci && npm run build && npx electron-builder --win nsis` in `app/`.
- `electron-builder.yml`:
  - `appId: app.commanderduel`, `productName: Commander Duel`.
  - `extraResources`: `../build/jre` → `jre`, `../engine/target/commander-duel-engine.jar` → `engine/`, and `../forge/forge-gui/res` → `forge-gui/res`. Exclude `res/adventure/**`, `res/quest/world/**`, and `res/skins/**` unless Forge init requires them; verify by launching the packaged app.
  - `nsis: { oneClick: false, allowToChangeInstallationDirectory: true }`.
  - Output to `app/dist/Commander Duel Setup <version>.exe`.

- [ ] **Step 1: Write `package.ps1` and `electron-builder.yml`.**
- [ ] **Step 2: Run `pwsh scripts/package.ps1`.** Expect exit 0 and the installer in `app/dist/`.
- [ ] **Step 3: Verify the installed app.** Install it, temporarily rename `JAVA_HOME`'s folder or run on a PATH without Java, and launch. Expect the engine to start from the bundled `jre` and the Decks screen to load precons. Then import a deck and play a game to turn 3 against 3 bots.
- [ ] **Step 4: Commit:** `build: Windows installer with bundled Java runtime`

### Task 14: End-to-end verification and README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run all suites.** Run `mvn -q -f engine/pom.xml test` and `npm --prefix app test`. Expect everything to pass and record the counts.
- [ ] **Step 2: Manual acceptance on the installed build.** Expect each of these to work, and note any `rejected` messages seen. Any rejection during normal play is a bug to fix before shipping.
  - (a) Import a public Archidekt deck by link.
  - (b) A 4-player pod with one bot each on Easy, Normal, and Hard, decks random / specific precon / imported.
  - (c) The blue glow appears only on things the engine lists as actionable.
  - (d) The timing popup appears on an opponent's instant.
  - (e) Combat with multiple opponents: choose which player to attack.
  - (f) Concede and play again.
  - (g) Kill `java.exe` mid-game; the "engine stopped" screen appears, and "Back to menu" recovers.
- [ ] **Step 3: Finish the README.** Cover what it is, the install steps for friends, building from source, the license, and the WotC Fan Content Policy disclaimer.
- [ ] **Step 4: Commit:** `docs: README with install and build instructions`
