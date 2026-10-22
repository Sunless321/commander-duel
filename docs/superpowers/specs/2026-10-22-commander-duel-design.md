# Commander Duel — Design

## Intent

A free, open-source Windows desktop app for testing Magic: The Gathering Commander decks against bots.
It is "a better Forge": Forge's rules engine and AI underneath, with a modern interface modeled on
Yu-Gi-Oh! Master Duel on top. The owner wants to share it with friends and publish it on GitHub.

Why: Forge already knows almost every card and rule, but its interface is clunky and hard to learn.
The goal is a game that feels polished and teaches you the timing rules as you play.

## Goals

1. **Solo Commander games against 1–3 bots** (a 2–4 player pod).
2. **Master Duel-style board** (see the approved mockups: https://claude.ai/artifact/9f4Ke26bapF6HnL1AvrLs5):
   - Cards you can legally play right now glow blue and lift slightly. Everything else is dimmed.
   - A turn-phase bar shows the current step.
   - The command zone shows your commander, with a note explaining why it can't be cast when it's dimmed.
3. **Timing popups.** When you get priority while something is on the stack (for example, an opponent casts
   a spell), a popup shows the spell, its target, and what it does, plus the cards you can respond with (glowing).
   Buttons: "Respond" and "Let it resolve". An optional "What's happening?" explainer covers the stack and priority.
   A setting controls when the game stops to ask: *Every time*, *Only when I have a response* (default), or *Never*.
4. **Archidekt deck import.** Paste an Archidekt deck link; the app fetches the list (public or unlisted decks),
   identifies the commander(s), and saves the deck locally. Pasting a plain text decklist is the fallback.
5. **Game setup screen.** Choose your deck, the pod size, and for each bot:
   - Deck: random precon, a specific precon (searchable), or an imported deck.
   - Difficulty: Easy / Normal / Hard.
6. **Shareable.** One Windows installer that bundles Java, so friends need no setup. Source on GitHub under GPL-3.0.

## Hard rule: no illegal moves

The interface never decides what is legal. Forge's engine is the only authority.

- Every action the UI offers (playable cards, abilities, targets, attackers, blockers, mana payments, choices)
  comes from a list the engine produced for the current decision.
- The UI sends back only the identifier of an option the engine offered. The bridge rejects anything else.
- Choices the engine needs (targets, modes, X values, ordering, mulligans) are relayed exactly as the engine
  asks for them, never simplified in a way that drops options or adds new ones.
- The whole Forge engine runs unmodified where possible, so its rules coverage is kept intact.

The owner said they would "wince" at any illegal move. Treat any rules discrepancy introduced by this project
as a top-severity bug.

## Non-goals

- Online or local multiplayer between humans.
- Building decks inside the app (use Archidekt).
- Formats other than Commander.
- macOS or Linux builds.
- Making Forge's AI play better than it does today.

## Anti-goals

- Allowing any move the rules forbid, or hiding any legal option.
- Bundling card images or other Wizards of the Coast assets in the repo or installer. Images are downloaded
  at runtime from Scryfall and cached locally (permitted under the WotC Fan Content Policy for free, non-commercial projects).
- Making friends install Java or anything else by hand.

## Constraints

- **License:** Forge is GPL-3.0, so this project is GPL-3.0 and its source is public.
- **Platform:** Windows 10/11 x64 only.
- **Development machine:** Windows 11, 16 GB RAM. The project lives at `C:\Users\arham\dev\commander-duel`,
  outside OneDrive, because the Forge build is several GB.

## How it's built (builder's calls, stated to the owner)

- **Engine process (Java 17):** Forge's `forge-core`, `forge-game`, `forge-ai`, and `forge-gui` modules, plus a new
  bridge module implementing Forge's GUI interfaces (`IGuiBase`, `IGuiGame`, and the human player's input flow).
  The bridge exposes the game over a local WebSocket (localhost only, random port, session token) as JSON:
  game state snapshots and deltas, plus "decision requests" listing exactly the legal options.
- **Desktop shell + UI:** Electron, with the interface in React/TypeScript. Electron launches the bundled Java
  runtime and engine, connects to the WebSocket, and renders the board, popups, and setup screens.
- **Card images:** Scryfall API, cached on disk.
- **Archidekt:** public deck API (`https://archidekt.com/api/decks/<id>/`), mapped to Forge card names.
  Unknown or unsupported cards are reported to the user by name, never silently dropped.
- **Packaging:** electron-builder producing an NSIS installer that includes a trimmed Java runtime (jlink) and the engine.

## Difficulty mapping (builder's call)

Forge has AI profiles rather than true difficulty levels:
- **Easy:** Forge's `Cautious` profile.
- **Normal:** Forge's `Default` profile.
- **Hard:** Forge's `Default` profile plus hybrid simulation (`AIOption.USE_HYBRID_SIMULATION`), which looks ahead before acting.

Deliberately weakening the AI further (e.g. skipping plays) is deferred; it needs engine changes.

## Left to the builder

Visual details beyond the mockups, animation style, bridge protocol details, the precon list source
(Forge ships Commander precons), local storage format, and the test strategy. The test strategy must include
checks that the UI can only send engine-offered options.
