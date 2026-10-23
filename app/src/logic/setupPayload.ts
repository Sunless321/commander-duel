import type { BotDeck, Difficulty, UiMessage } from '../net/protocol';

export interface BotChoice { deck: BotDeck; difficulty: Difficulty }

export const defaultBot = (): BotChoice => ({ deck: { kind: 'randomPrecon' }, difficulty: 'NORMAL' });

export function buildStartGame(deckId: string, bots: BotChoice[]): UiMessage {
  if (!deckId) throw new Error('Pick a deck to play');
  if (bots.length < 1 || bots.length > 3) throw new Error('A pod needs 1 to 3 bots');
  return {
    type: 'startGame',
    deckId,
    bots: bots.map((b) => ({ deck: { ...b.deck }, difficulty: b.difficulty })),
  };
}
