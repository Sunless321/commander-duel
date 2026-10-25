import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { isRecording, type Recording, type RecordingSummary } from '../src/logic/recording';

// Saved matches: <id>.json.gz holds the recording, <id>.meta.json the small listing entry beside it.
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_BYTES = 64 * 1024 * 1024;

export function isRecordingId(id: unknown): id is string {
  return typeof id === 'string' && ID.test(id);
}

/** A file-safe id from the save time and title, e.g. 2026-10-25_14-03-12_Buffs-by-Hans-vs-Anhelo. */
export function recordingId(r: Recording): string {
  const when = r.savedAt.replace(/\.\d+Z$/, '').replace(/[:T]/g, '-').replace(/[^0-9-]/g, '');
  const title = r.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `${when}_${title || 'match'}`.slice(0, 120);
}

function summary(id: string, r: Recording): RecordingSummary {
  return { id, savedAt: r.savedAt, title: r.title, youWon: r.youWon, turns: r.turns.length };
}

export async function saveRecording(dir: string, input: unknown): Promise<RecordingSummary> {
  if (!isRecording(input)) throw new Error('not a match recording');
  const data = gzipSync(Buffer.from(JSON.stringify(input)));
  if (data.length > MAX_BYTES) throw new Error('recording too large');
  await mkdir(dir, { recursive: true });
  let id = recordingId(input);
  const taken = new Set(await readdir(dir));
  for (let n = 2; taken.has(`${id}.json.gz`); n++) id = `${recordingId(input)}-${n}`;
  const s = summary(id, input);
  await writeFile(join(dir, `${id}.json.gz`), data);
  await writeFile(join(dir, `${id}.meta.json`), JSON.stringify(s));
  return s;
}

/** Newest first. Unreadable entries are skipped. */
export async function listRecordings(dir: string): Promise<RecordingSummary[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: RecordingSummary[] = [];
  for (const n of names) {
    const id = n.endsWith('.meta.json') ? n.slice(0, -'.meta.json'.length) : null;
    if (!id || !isRecordingId(id) || !names.includes(`${id}.json.gz`)) continue;
    try {
      const s = JSON.parse(await readFile(join(dir, n), 'utf8')) as RecordingSummary;
      if (typeof s.title === 'string' && typeof s.savedAt === 'string') out.push({ ...s, id });
    } catch {
      /* skip a damaged listing */
    }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function loadRecording(dir: string, id: unknown): Promise<Recording> {
  if (!isRecordingId(id)) throw new Error('bad recording id');
  const raw = gunzipSync(await readFile(join(dir, `${id}.json.gz`)), { maxOutputLength: 8 * MAX_BYTES });
  const r: unknown = JSON.parse(raw.toString('utf8'));
  if (!isRecording(r)) throw new Error('not a match recording');
  return r;
}

export async function deleteRecording(dir: string, id: unknown): Promise<void> {
  if (!isRecordingId(id)) throw new Error('bad recording id');
  await rm(join(dir, `${id}.json.gz`), { force: true });
  await rm(join(dir, `${id}.meta.json`), { force: true });
}
