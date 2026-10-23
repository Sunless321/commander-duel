import { describe, expect, test } from 'vitest';
import { buildStartGame, defaultBot, type BotChoice } from './setupPayload';

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
