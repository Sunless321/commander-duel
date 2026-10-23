import { describe, expect, test } from 'vitest';
import { buildStartGame, defaultBot, defaultDeckId, filterPrecons, type BotChoice } from './setupPayload';

describe('setupPayload', () => {
  test('builds payload for 3 bots', () => {
    const bots: BotChoice[] = [
      { deck: { kind: 'randomPrecon' }, difficulty: 'EASY' },
      { deck: { kind: 'precon', id: 'p1' }, difficulty: 'NORMAL' },
      { deck: { kind: 'imported', id: 'd1' }, difficulty: 'HARD' },
    ];
    expect(buildStartGame('mine', bots)).toEqual({
      type: 'startGame',
      deckId: 'mine',
      bots: [
        { deck: { kind: 'randomPrecon' }, difficulty: 'EASY' },
        { deck: { kind: 'precon', id: 'p1' }, difficulty: 'NORMAL' },
        { deck: { kind: 'imported', id: 'd1' }, difficulty: 'HARD' },
      ],
    });
  });

  test('rejects 0 and 4 bots, and an empty deck id', () => {
    expect(() => buildStartGame('mine', [])).toThrow();
    expect(() => buildStartGame('mine', [defaultBot(), defaultBot(), defaultBot(), defaultBot()])).toThrow();
    expect(() => buildStartGame('', [defaultBot()])).toThrow();
  });

  test('default bot is randomPrecon NORMAL', () => {
    expect(defaultBot()).toEqual({ deck: { kind: 'randomPrecon' }, difficulty: 'NORMAL' });
  });
});

describe('filterPrecons', () => {
  const precons = [
    { id: 'a', name: 'Abzan Armor', commander: 'Anafenza', colors: [] },
    { id: 'b', name: 'Planar Chaos', commander: 'Ghave, Guru of Spores', colors: [] },
  ];
  test('matches name case-insensitively', () => {
    expect(filterPrecons(precons, 'ABZAN').map((p) => p.id)).toEqual(['a']);
  });
  test('matches commander case-insensitively', () => {
    expect(filterPrecons(precons, 'guru of').map((p) => p.id)).toEqual(['b']);
  });
  test('empty query returns all', () => {
    expect(filterPrecons(precons, '  ')).toHaveLength(2);
  });
});

describe('defaultDeckId', () => {
  const lobby = { precons: [{ id: 'p1' }], decks: [{ id: 'd1' }, { id: 'd2' }] };
  test('uses the selected deck when it exists', () => {
    expect(defaultDeckId(lobby, 'd2')).toBe('d2');
  });
  test('falls back to the first deck when selection is missing or stale', () => {
    expect(defaultDeckId(lobby, 'gone')).toBe('d1');
    expect(defaultDeckId(lobby, null)).toBe('d1');
  });
  test('falls back to the first precon with no imported decks', () => {
    expect(defaultDeckId({ precons: [{ id: 'p1' }], decks: [] }, 'gone')).toBe('p1');
  });
});
