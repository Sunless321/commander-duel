# Builds the Windows installer: Forge -> engine jar -> trimmed Java runtime -> Forge resources -> NSIS setup.
# Output: app\dist\Commander Duel Setup <version>.exe
param(
    # Skip rebuilding Forge into ~/.m2 when it is already installed there.
    [switch]$SkipForge
)
$ErrorActionPreference = 'Stop'
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $jdk) { throw 'JAVA_HOME is not set and no Temurin 17 was found.' }
    $env:JAVA_HOME = $jdk.FullName
}
$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root 'build'
$jar = Join-Path $root 'engine\target\commander-duel-engine.jar'

function Invoke-Native([string]$exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$exe exited with code $LASTEXITCODE" }
}

# 1. Forge
if (-not $SkipForge) { & (Join-Path $PSScriptRoot 'build-forge.ps1') }

# 2. Engine jar
Invoke-Native 'mvn' @('-q', '-B', '-f', (Join-Path $root 'engine\pom.xml'), 'package', '-DskipTests')

# 3. Trimmed Java runtime
$jre = Join-Path $build 'jre'
if (Test-Path $jre) { Remove-Item $jre -Recurse -Force }
$jdeps = Join-Path $env:JAVA_HOME 'bin\jdeps.exe'
$modules = (& $jdeps --ignore-missing-deps --print-module-deps --multi-release 17 $jar | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0 -or -not $modules) { throw 'jdeps failed' }
$modules = "$modules,jdk.crypto.ec,jdk.unsupported,jdk.zipfs"
Write-Host "jlink modules: $modules"
Invoke-Native (Join-Path $env:JAVA_HOME 'bin\jlink.exe') @(
    '--add-modules', $modules, '--output', $jre,
    '--strip-debug', '--no-header-files', '--no-man-pages', '--compress=2')

# 4. Forge resources, minus what a headless Commander engine never reads
$src = Join-Path $root 'forge\forge-gui\res'
$res = Join-Path $build 'forge-gui\res'
if (Test-Path (Join-Path $build 'forge-gui')) { Remove-Item (Join-Path $build 'forge-gui') -Recurse -Force }
& robocopy $src $res /E /NFL /NDL /NJH /NJS /NP `
    /XD (Join-Path $src 'adventure') (Join-Path $src 'music') (Join-Path $src 'quest\world') `
    /XF 'cardnames-*.txt' 'mkzip.sh' | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }
Get-ChildItem (Join-Path $res 'languages') -File | Where-Object { $_.Name -ne 'en-US.properties' } | Remove-Item -Force

# Card scripts as one archive (Forge reads res\cardsfolder\cardsfolder.zip and skips loose files):
# installs ~34,000 fewer files.
$cards = Join-Path $res 'cardsfolder'
$zipStage = Join-Path $build 'cardsfolder-stage'
if (Test-Path $zipStage) { Remove-Item $zipStage -Recurse -Force }
Move-Item $cards $zipStage
New-Item -ItemType Directory $cards | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($zipStage, (Join-Path $cards 'cardsfolder.zip'), [IO.Compression.CompressionLevel]::Fastest, $false)
Remove-Item $zipStage -Recurse -Force

# 5. App and installer
Push-Location (Join-Path $root 'app')
try {
    Invoke-Native 'npm.cmd' @('ci')
    # electron-builder's winCodeSign archive contains macOS symlinks, which Windows cannot create without
    # admin rights or Developer Mode, so its own extraction fails. Pre-fill its cache without the darwin folder.
    $wcsCache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
    $wcs = Join-Path $wcsCache 'winCodeSign-2.6.0'
    if (-not (Test-Path $wcs)) {
        New-Item -ItemType Directory $wcsCache -Force | Out-Null
        $archive = Join-Path $wcsCache 'winCodeSign-2.6.0.7z'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -OutFile $archive `
            'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z'
        Invoke-Native (Join-Path $root 'app\node_modules\7zip-bin\win\x64\7za.exe') @('x', '-bd', '-y', "-o$wcs", $archive, '-xr!darwin')
        Remove-Item $archive -Force
    }
    Invoke-Native 'npm.cmd' @('run', 'build')
    Invoke-Native 'npx.cmd' @('electron-builder', '--win', 'nsis')
} finally {
    Pop-Location
}
Get-ChildItem (Join-Path $root 'app\dist') -Filter '*.exe' | ForEach-Object { Write-Host "Installer: $($_.FullName)" }
