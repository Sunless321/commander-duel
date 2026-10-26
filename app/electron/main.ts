import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { fetchArchidekt, parseDeckId, parseTextList } from './archidekt';
import { registerCardProtocol, registerCardScheme } from './cardImages';
import { openEngineLog, startEngine, type EngineOptions, type RunningEngine } from './engineProcess';
import { deleteRecording, listRecordings, loadRecording, saveRecording } from './recordings';

// Must happen before app is ready so userData resolves to %APPDATA%\Commander Duel.
app.setName('Commander Duel');
registerCardScheme(); // privileged scheme must be registered before app ready

let engine: Promise<RunningEngine> | null = null;
// The newest engine child, tracked from spawn (not READY) so quit/restart also reach a still-starting engine.
let child: ChildProcess | null = null;

function killEngine(): void {
  child?.kill();
  child = null;
}

function enginePaths(): Omit<EngineOptions, 'dataDir'> {
  if (app.isPackaged) {
    const r = process.resourcesPath;
    return {
      javaPath: join(r, 'jre', 'bin', 'java.exe'),
      jarPath: join(r, 'engine', 'commander-duel-engine.jar'),
      forgeDir: join(r, 'forge-gui'),
    };
  }
  const javaHome = process.env.JAVA_HOME || 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.20.101-hotspot';
  const appDir = app.getAppPath();
  const jarPath = resolve(appDir, '../engine/target/commander-duel-engine.jar');
  if (!existsSync(jarPath)) {
    throw new Error(`Engine jar not found at ${jarPath}; build it with: mvn -q -f engine/pom.xml package -DskipTests`);
  }
  return {
    javaPath: join(javaHome, 'bin', 'java.exe'),
    jarPath,
    forgeDir: resolve(appDir, '../forge/forge-gui'),
  };
}

function launchEngine(): Promise<RunningEngine> {
  killEngine();
  const p = Promise.resolve().then(() =>
    startEngine({
      ...enginePaths(),
      dataDir: app.getPath('userData'),
      logFile: join(app.getPath('userData'), 'logs', 'engine.log'),
      onSpawn: (c) => (child = c),
    }),
  );
  engine = p;
  return p;
}

const endpoint = ({ port, token }: RunningEngine) => ({ port, token });

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#10131a',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  // Screen errors go to logs\ui.log (the last run's kept as ui.previous.log), so a broken screen leaves a trace.
  const uiLog = openEngineLog(join(app.getPath('userData'), 'logs', 'ui.log'));
  uiLog?.on('error', () => undefined);
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log('[renderer]', message);
    if (level >= 3) uiLog?.write(`${new Date().toISOString()} ${message} (${sourceId}:${line})\n`);
  });
  win.webContents.on('render-process-gone', (_e, d) =>
    uiLog?.write(`${new Date().toISOString()} renderer gone: ${d.reason} (exit ${d.exitCode})\n`),
  );
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  registerCardProtocol(join(app.getPath('userData'), 'card-cache'));
  ipcMain.handle('engine:get', async () => endpoint(await (engine ?? launchEngine())));
  ipcMain.handle('engine:restart', async () => endpoint(await launchEngine()));
  ipcMain.handle('deck:import', async (_e, input: unknown) => {
    const text = typeof input === 'string' ? input : '';
    const id = parseDeckId(text);
    return id ? fetchArchidekt(id) : parseTextList(text);
  });
  const recordings = join(app.getPath('userData'), 'recordings');
  ipcMain.handle('recording:save', (_e, r: unknown) => saveRecording(recordings, r));
  ipcMain.handle('recording:list', () => listRecordings(recordings));
  ipcMain.handle('recording:load', (_e, id: unknown) => loadRecording(recordings, id));
  ipcMain.handle('recording:delete', (_e, id: unknown) => deleteRecording(recordings, id));
  void launchEngine().catch((e) => console.error('engine failed to start', e));
  createWindow();
});

app.on('before-quit', killEngine);
app.on('window-all-closed', () => app.quit());
