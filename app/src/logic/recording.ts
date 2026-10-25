import type { GameState, LogEntry } from '../net/protocol';

/** The board as it stood when a turn began. */
export interface TurnSnapshot { turn: number; state: GameState }

/** What a match records while it is played: memory only until the player chooses to save it. */
export interface Recorder { turns: TurnSnapshot[]; log: LogEntry[] }

/** A finished match as saved to disk and shown by the replay viewer. */
export interface Recording {
  version: 1;
  savedAt: string;
  title: string;
  deckName: string | null;
  players: string[];
  winners: string[];
  youWon: boolean;
  turns: TurnSnapshot[];
  /** The board when the game ended. */
  final: GameState | null;
  log: LogEntry[];
}

/** The listing entry for a saved recording (read without loading the whole file). */
export interface RecordingSummary {
  id: string;
  savedAt: string;
  title: string;
  youWon: boolean;
  turns: number;
}

export const emptyRecorder = (): Recorder => ({ turns: [], log: [] });

/** Keeps the first state of every new turn (turn 0 is the pre-game: mulligans, commanders being dealt). */
export function recordState(rec: Recorder, state: GameState): Recorder {
  const last = rec.turns[rec.turns.length - 1];
  if (state.turn < 1 || (last && state.turn <= last.turn)) return rec;
  return { ...rec, turns: [...rec.turns, { turn: state.turn, state }] };
}

export function recordLog(rec: Recorder, entries: LogEntry[]): Recorder {
  return entries.length === 0 ? rec : { ...rec, log: [...rec.log, ...entries] };
}

export function finishRecording(
  rec: Recorder,
  final: GameState | null,
  result: { winnerNames: string[]; youWon: boolean },
  deckName: string | null,
  now: Date = new Date(),
): Recording {
  const players = (final ?? rec.turns[rec.turns.length - 1]?.state)?.players ?? [];
  const opponents = players.filter((p) => !p.you).map((p) => p.name.replace(/ Bot$/, ''));
  const title = `${deckName ?? 'You'} vs ${opponents.join(', ') || 'bots'}`;
  return {
    version: 1,
    savedAt: now.toISOString(),
    title,
    deckName,
    players: players.map((p) => p.name),
    winners: result.winnerNames,
    youWon: result.youWon,
    turns: rec.turns,
    final,
    log: rec.log,
  };
}

/**
 * The log split by turn: the lines after Forge's "Turn N (...)" line belong to turn N; anything before the
 * first one (mulligans, the opening) belongs to turn 0.
 */
export function logByTurn(log: LogEntry[]): Map<number, LogEntry[]> {
  const out = new Map<number, LogEntry[]>();
  let turn = 0;
  for (const e of log) {
    if (e.kind === 'TURN') {
      const m = /^Turn (\d+)/.exec(e.text);
      if (m) turn = Number(m[1]);
    }
    const list = out.get(turn) ?? [];
    list.push(e);
    out.set(turn, list);
  }
  return out;
}

/** Light shape check for a recording read back from disk (it came from this app, but files can be edited). */
export function isRecording(x: unknown): x is Recording {
  const r = x as Recording;
  return !!r && typeof r === 'object' && r.version === 1 && typeof r.title === 'string'
    && Array.isArray(r.turns) && Array.isArray(r.log) && Array.isArray(r.winners);
}
