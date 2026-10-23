import { describe, expect, test } from 'vitest';
import { parseReadyLine, startEngine } from './engineProcess';

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
});
