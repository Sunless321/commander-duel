import { expect, test } from 'vitest';
import type { GameState, InputKind, PromptMsg } from '../net/protocol';
import { decideResponse } from './respondPolicy';

const prompt = (over: Partial<PromptMsg> = {}): PromptMsg => ({
  type: 'prompt', stateSeq: 1, message: 'You have priority', inputKind: 'priority',
  ok: { label: 'OK', enabled: true }, cancel: null, ...over,
});

const game = (over: Partial<GameState> = {}): GameState => ({
  turn: 3, phase: 'MAIN1', activePlayerId: 'p2', priorityPlayerId: 'p1', youId: 'p1',
  players: [], cards: { c1: { id: 'c1' } as never },
  stack: [{ id: 's1', text: 'Opposition Bolt', sourceCardId: 'c9', activatorId: 'p2', targetIds: [] }],
  combat: [], ...over,
});

const run = (over: { prompt?: PromptMsg; game?: GameState; playable?: string[]; mode?: 'always' | 'smart' | 'never' }) =>
  decideResponse({
    prompt: over.prompt ?? prompt(), game: over.game ?? game(),
    playable: new Set(over.playable ?? []), mode: over.mode ?? 'smart', youId: 'p1',
  });

test('opponent spell + playable -> popup in smart', () => {
  expect(run({ playable: ['c1'] })).toBe('popup');
});

test('opponent spell + nothing playable -> autoPass in smart', () => {
  expect(run({})).toBe('autoPass');
});

test('always -> popup even with nothing playable; never -> autoPass even with playables', () => {
  expect(run({ mode: 'always' })).toBe('popup');
  expect(run({ mode: 'never', playable: ['c1'] })).toBe('autoPass');
});

test('smart: playable ids that are not respond cards do not count', () => {
  const g = game({
    players: [
      { id: 'p1', name: 'You', you: true, life: 40, poison: 0, commanderDamage: {}, manaPool: {}, hand: [], handCount: 0, libraryCount: 0, graveyard: [], exile: [], command: [], battlefield: [] },
      { id: 'p2', name: 'Bot', you: false, life: 40, poison: 0, commanderDamage: {}, manaPool: {}, hand: [], handCount: 0, libraryCount: 0, graveyard: [], exile: [], command: [], battlefield: ['c4'] },
    ],
    cards: { c4: { id: 'c4' } as never },
  });
  expect(run({ game: g, playable: ['c4'] })).toBe('autoPass');
});

test('own spell on stack -> none', () => {
  const g = game({ stack: [{ id: 's1', text: 'x', sourceCardId: null, activatorId: 'p1', targetIds: [] }] });
  expect(run({ game: g, mode: 'always' })).toBe('none');
});

test('empty stack -> none', () => {
  expect(run({ game: game({ stack: [] }), mode: 'always' })).toBe('none');
});

test('not your priority -> none', () => {
  expect(run({ game: game({ priorityPlayerId: 'p2' }), mode: 'always' })).toBe('none');
});

test('disabled ok -> none', () => {
  expect(run({ prompt: prompt({ ok: { label: 'OK', enabled: false } }), mode: 'never' })).toBe('none');
  expect(run({ prompt: prompt({ ok: null }), mode: 'never' })).toBe('none');
});

test('never auto-answers non-priority prompts', () => {
  for (const inputKind of ['target', 'payMana', 'select', 'mulligan'] as InputKind[]) {
    expect(run({ prompt: prompt({ inputKind }), mode: 'never' })).toBe('none');
  }
});
