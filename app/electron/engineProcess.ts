import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

export interface EngineOptions {
  javaPath: string;
  jarPath: string;
  forgeDir: string;
  dataDir: string;
  /** Milliseconds to wait for the READY line (default 120 s). */
  readyTimeoutMs?: number;
  /** Called synchronously with the child as soon as it is spawned, before READY. */
  onSpawn?: (child: ChildProcess) => void;
  /** Where the engine's stderr is saved; the previous run's file is kept as `<name>.previous.log`. */
  logFile?: string;
}

/** Opens a fresh log for this engine run, keeping the last run's beside it. Best effort: null if it can't. */
export function openEngineLog(file: string): WriteStream | null {
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) renameSync(file, file.replace(/\.log$/, '') + '.previous.log');
    return createWriteStream(file, { flags: 'w' });
  } catch {
    return null;
  }
}

export interface RunningEngine {
  port: number;
  token: string;
  child: ChildProcess;
}

export function parseReadyLine(line: string): number | null {
  const m = /^READY port=(\d+)\s*$/.exec(line);
  return m ? Number(m[1]) : null;
}

// A 4-player game retains ~270 MB of heap; without a cap the JVM takes up to 1/4 of RAM and keeps it.
// G1's periodic GC and a low free ratio hand idle memory back to Windows between games.
const JVM_FLAGS = [
  '-Xmx1536m',
  '-XX:+UseG1GC',
  '-XX:G1PeriodicGCInterval=15000',
  '-XX:MinHeapFreeRatio=10',
  '-XX:MaxHeapFreeRatio=30',
  '-XX:+UseStringDeduplication',
  '-XX:+ExitOnOutOfMemoryError',
];

export function engineArgs(opts: EngineOptions, token: string): string[] {
  return [...JVM_FLAGS, '-jar', opts.jarPath, '--forge', opts.forgeDir, '--data', opts.dataDir, '--token', token];
}

/** Spawns the engine jar with a fresh random token; resolves on its READY line. */
export function startEngine(opts: EngineOptions): Promise<RunningEngine> {
  const token = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    const child = spawn(opts.javaPath, engineArgs(opts, token), {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    opts.onSpawn?.(child);
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => {
        child.kill();
        reject(new Error('Engine did not become ready in time'));
      });
    }, opts.readyTimeoutMs ?? 120_000);
    function finish(fn: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    }

    createInterface({ input: child.stdout! }).on('line', (line) => {
      const port = parseReadyLine(line);
      if (port !== null) finish(() => resolve({ port, token, child }));
    });
    const log = opts.logFile ? openEngineLog(opts.logFile) : null;
    log?.on('error', () => undefined); // a full disk must not take the app down
    child.stderr!.on('data', (d: Buffer) => {
      process.stderr.write(`[engine] ${d}`);
      log?.write(d);
    });
    child.on('exit', (code, signal) => log?.end(`\n[engine exited: code ${code}, signal ${signal}]\n`));
    child.on('error', (err) => finish(() => reject(err)));
    child.on('exit', (code, signal) =>
      finish(() => reject(new Error(`Engine exited before READY (code ${code}, signal ${signal})`))),
    );
  });
}
