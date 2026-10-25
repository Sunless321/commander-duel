import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { engineArgs, parseReadyLine, startEngine } from './engineProcess';

describe('engineProcess', () => {
  test('parseReadyLine', () => {
    expect(parseReadyLine('READY port=51234')).toBe(51234);
    expect(parseReadyLine('INFO x')).toBeNull();
  });

  test('startEngine rejects when the process exits before READY', async () => {
    // node rejects the java-style "-jar" flag and exits non-zero without printing READY
    await expect(
      startEngine({ javaPath: process.execPath, jarPath: 'x.jar', forgeDir: 'f', dataDir: 'd' }),
    ).rejects.toThrow(/exited before READY/);
  });

  test("the engine's stderr is saved to the log file and the previous run's log is kept", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-log-'));
    const file = join(dir, 'logs', 'engine.log');
    mkdirSync(join(dir, 'logs'));
    writeFileSync(file, 'last run');
    // node prints its "bad option" complaint to stderr and exits before READY
    await expect(
      startEngine({ javaPath: process.execPath, jarPath: 'x.jar', forgeDir: 'f', dataDir: 'd', logFile: file }),
    ).rejects.toThrow(/exited before READY/);
    await new Promise((r) => setTimeout(r, 200)); // let the stream flush
    expect(readFileSync(join(dir, 'logs', 'engine.previous.log'), 'utf8')).toBe('last run');
    const log = readFileSync(file, 'utf8');
    expect(log).toMatch(/bad option/);
    expect(log).toMatch(/\[engine exited: code \d+/);
  });

  test('engineArgs caps the heap and returns idle memory before -jar', () => {
    const args = engineArgs({ javaPath: 'java', jarPath: 'e.jar', forgeDir: 'f', dataDir: 'd' }, 'tok');
    const jar = args.indexOf('-jar');
    const jvm = args.slice(0, jar);
    expect(jvm).toContain('-Xmx1536m');
    expect(jvm).toContain('-XX:+UseG1GC');
    expect(jvm).toContain('-XX:G1PeriodicGCInterval=15000');
    expect(jvm).toContain('-XX:MaxHeapFreeRatio=30');
    // out of memory must end the process, so the app's engine-stopped recovery takes over instead of a silent hang
    expect(jvm).toContain('-XX:+ExitOnOutOfMemoryError');
    expect(args.slice(jar)).toEqual(['-jar', 'e.jar', '--forge', 'f', '--data', 'd', '--token', 'tok']);
  });
});
