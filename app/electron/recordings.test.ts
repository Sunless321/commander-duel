import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Recording } from '../src/logic/recording';
import { deleteRecording, isRecordingId, listRecordings, loadRecording, recordingId, saveRecording } from './recordings';

const rec = (savedAt: string, title = 'Buffs by Hans vs Anhelo, the Painter'): Recording => ({
  version: 1, savedAt, title, deckName: 'Buffs by Hans', players: ['You', 'Anhelo'], winners: ['You'], youWon: true,
  turns: [], final: null, log: [{ kind: 'TURN', text: 'Turn 1 (You)' }],
});

test('save, list newest first, load back, delete', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'cd-rec-')), 'recordings');
  const a = await saveRecording(dir, rec('2026-10-25T10:00:00.000Z'));
  const b = await saveRecording(dir, rec('2026-10-25T11:00:00.000Z', 'Other'));
  expect(a.id).toBe('2026-10-25-10-00-00_Buffs-by-Hans-vs-Anhelo-the-Painter');
  expect((await listRecordings(dir)).map((s) => s.id)).toEqual([b.id, a.id]);
  expect((await loadRecording(dir, a.id)).log[0].text).toBe('Turn 1 (You)');
  await deleteRecording(dir, a.id);
  expect((await listRecordings(dir)).map((s) => s.id)).toEqual([b.id]);
  expect(readdirSync(dir).sort()).toEqual([`${b.id}.json.gz`, `${b.id}.meta.json`]);
});

test('saving the same match twice keeps both', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-rec-'));
  const a = await saveRecording(dir, rec('2026-10-25T10:00:00.000Z'));
  const b = await saveRecording(dir, rec('2026-10-25T10:00:00.000Z'));
  expect(b.id).toBe(`${a.id}-2`);
});

test('rejects things that are not recordings, and ids that could leave the folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-rec-'));
  await expect(saveRecording(dir, { hello: 1 })).rejects.toThrow('not a match recording');
  for (const bad of ['../x', 'a/b', 'C:\\x', '', 5]) {
    expect(isRecordingId(bad)).toBe(false);
    await expect(loadRecording(dir, bad)).rejects.toThrow('bad recording id');
    await expect(deleteRecording(dir, bad)).rejects.toThrow('bad recording id');
  }
});

test('a listing with no recording file, or a damaged one, is skipped; a missing folder lists nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-rec-'));
  writeFileSync(join(dir, 'orphan.meta.json'), '{"title":"x","savedAt":"y"}');
  writeFileSync(join(dir, 'bad.meta.json'), 'not json');
  writeFileSync(join(dir, 'bad.json.gz'), 'x');
  expect(await listRecordings(dir)).toEqual([]);
  expect(await listRecordings(join(dir, 'nope'))).toEqual([]);
  expect(recordingId(rec('2026-01-02T03:04:05.678Z', '!!!'))).toBe('2026-01-02-03-04-05_match');
});
