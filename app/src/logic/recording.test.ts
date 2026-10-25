import { expect, test } from 'vitest';
import type { GameState, PlayerDto } from '../net/protocol';
import { emptyRecorder, finishRecording, isRecording, logByTurn, recordLog, recordState } from './recording';

const player = (id: string, name: string, you: boolean): PlayerDto => ({
  id, name, you, life: 40, poison: 0, commanderDamage: {}, manaPool: {}, hand: [], handCount: 0, libraryCount: 90,
  graveyard: [], exile: [], command: [], battlefield: [], visibleLibrary: [], visibleHand: [],
});
const state = (turn: number, life = 40): GameState => ({
  turn, phase: 'UNTAP', activePlayerId: 'p1', priorityPlayerId: null, youId: 'p1',
  players: [{ ...player('p1', 'You', true), life }, player('p2', 'Anhelo, the Painter Bot', false)],
  cards: {}, stack: [], combat: [],
});

test('keeps only the first state of each new turn, skipping the pre-game', () => {
  let rec = emptyRecorder();
  for (const s of [state(0), state(1), state(1, 30), state(2), state(2, 20), state(3)]) rec = recordState(rec, s);
  expect(rec.turns.map((t) => [t.turn, t.state.players[0].life])).toEqual([[1, 40], [2, 40], [3, 40]]);
});

test('an unchanged recorder is returned as is (no needless store updates)', () => {
  const rec = recordState(emptyRecorder(), state(1));
  expect(recordState(rec, state(1, 5))).toBe(rec);
  expect(recordLog(rec, [])).toBe(rec);
});

test('finishing names the match after your deck and the bots, and keeps the result', () => {
  let rec = recordState(emptyRecorder(), state(1));
  rec = recordLog(rec, [{ kind: 'TURN', text: 'Turn 1 (You)' }]);
  const r = finishRecording(rec, state(9, 0), { winnerNames: ['Anhelo, the Painter Bot'], youWon: false }, 'Buffs by Hans',
    new Date('2026-10-25T12:00:00Z'));
  expect(r.title).toBe('Buffs by Hans vs Anhelo, the Painter');
  expect(r.savedAt).toBe('2026-10-25T12:00:00.000Z');
  expect(r.final?.turn).toBe(9);
  expect(r.youWon).toBe(false);
  expect(r.log).toHaveLength(1);
  expect(isRecording(JSON.parse(JSON.stringify(r)))).toBe(true);
  expect(isRecording({ version: 2 })).toBe(false);
  expect(isRecording(null)).toBe(false);
});

test('the log splits at each "Turn N" line; earlier lines go to turn 0', () => {
  const byTurn = logByTurn([
    { kind: 'MULLIGAN', text: 'You has kept a hand of 7 cards' },
    { kind: 'TURN', text: 'Turn 1 (You)' },
    { kind: 'LAND', text: 'You played Forest' },
    { kind: 'TURN', text: 'Turn 2 (Anhelo, the Painter Bot)' },
    { kind: 'STACK_ADD', text: 'Anhelo cast Flawless Forgery' },
  ]);
  expect([...byTurn.keys()]).toEqual([0, 1, 2]);
  expect(byTurn.get(1)?.map((e) => e.text)).toEqual(['Turn 1 (You)', 'You played Forest']);
  expect(byTurn.get(2)).toHaveLength(2);
});
