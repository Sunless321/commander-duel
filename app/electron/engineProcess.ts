import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

/** Spawns the engine jar with a fresh random token; resolves on its READY line. */
export function startEngine(opts: EngineOptions): Promise<RunningEngine> {
  const token = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    const child = spawn(
      opts.javaPath,
      ['-jar', opts.jarPath, '--forge', opts.forgeDir, '--data', opts.dataDir, '--token', token],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
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
    child.stderr!.on('data', (d: Buffer) => process.stderr.write(`[engine] ${d}`));
    child.on('error', (err) => finish(() => reject(err)));
    child.on('exit', (code, signal) =>
      finish(() => reject(new Error(`Engine exited before READY (code ${code}, signal ${signal})`))),
    );
  });
}
