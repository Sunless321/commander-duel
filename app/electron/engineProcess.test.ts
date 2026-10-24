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

  test('engineArgs caps the heap and returns idle memory before -jar', () => {
    const args = engineArgs({ javaPath: 'java', jarPath: 'e.jar', forgeDir: 'f', dataDir: 'd' }, 'tok');
    const jar = args.indexOf('-jar');
    const jvm = args.slice(0, jar);
    expect(jvm).toContain('-Xmx1536m');
    expect(jvm).toContain('-XX:+UseG1GC');
    expect(jvm).toContain('-XX:G1PeriodicGCInterval=15000');
    expect(jvm).toContain('-XX:MaxHeapFreeRatio=30');
    expect(args.slice(jar)).toEqual(['-jar', 'e.jar', '--forge', 'f', '--data', 'd', '--token', 'tok']);
  });
});
