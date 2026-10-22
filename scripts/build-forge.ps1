# Builds and installs the pinned Forge submodule (forge-gui and its dependencies) into ~/.m2.
$ErrorActionPreference = 'Stop'
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $jdk) { throw 'JAVA_HOME is not set and no Temurin 17 was found.' }
    $env:JAVA_HOME = $jdk.FullName
}
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'forge')
try {
    & mvn -B -pl forge-gui -am install "-DskipTests" "-Dcheckstyle.skip"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

# Forge's POMs use the ${revision} CI-friendly version. Maven does not substitute it when it reads
# these POMs as dependencies, so rewrite the installed copies (in ~/.m2 only; forge/ is untouched).
$m2forge = Join-Path $env:USERPROFILE '.m2\repository\forge'
Get-ChildItem $m2forge -Recurse -Filter '*-SNAPSHOT.pom' | ForEach-Object {
    $version = $_.Directory.Name
    $text = [IO.File]::ReadAllText($_.FullName)
    if ($text.Contains('${revision}')) {
        [IO.File]::WriteAllText($_.FullName, $text.Replace('${revision}', $version))
    }
}
Get-ChildItem $m2forge -Recurse -Directory -Filter '${revision}' | Remove-Item -Recurse -Force
