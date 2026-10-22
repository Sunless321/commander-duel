# Commander Duel

A Windows desktop app for playing Commander (EDH) against bots. The UI is Electron; the game engine is a Java module that embeds the open-source [Forge](https://github.com/Card-Forge/forge) engine, unmodified, as a git submodule.

## Build

Requirements: Windows, Temurin JDK 17, Maven 3.9+, Node 20+.

```powershell
git clone --recurse-submodules <this repo>
scripts\build-forge.ps1          # installs forge-gui 2.0.16-SNAPSHOT into ~/.m2
cd engine
mvn test                         # boots Forge headless and runs the engine tests
mvn package                      # produces engine/target/commander-duel-engine.jar
```

`scripts/build-forge.ps1` also rewrites the installed Forge POMs in `~/.m2` to replace the `${revision}` placeholder with `2.0.16-SNAPSHOT`; without that Maven cannot resolve Forge's parent POM from the engine (`-Drevision` does not help for dependency POMs).

## License

GPL-3.0, see `LICENSE`. Forge is also GPL-3.0.
