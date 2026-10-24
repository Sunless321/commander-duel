import type { GameState, PromptMsg } from '../net/protocol';
import type { RespondMode } from '../state/store';

export type ResponseDecision = 'popup' | 'autoPass' | 'none';

export interface ResponseInput {
  prompt: PromptMsg | null;
  game: GameState | null;
  playable: Set<string>;
  mode: RespondMode;
  youId: string;
}

/**
 * Decides how to treat the moment you get priority with something on the stack. It never judges legality:
 * 'autoPass' is only ever returned for a plain priority prompt whose OK button the engine has enabled.
 * The top of the stack is stack[0] (Forge iterates its stack top first; StateMapper keeps that order).
 */
export function decideResponse({ prompt, game, playable, mode, youId }: ResponseInput): ResponseDecision {
  if (!prompt || !game) return 'none';
  if (prompt.inputKind !== 'priority' || prompt.ok?.enabled !== true) return 'none';
  if (game.priorityPlayerId !== youId || game.stack.length === 0) return 'none';
  if (game.stack[0].activatorId === youId) return 'none';
  if (mode === 'always') return 'popup';
  if (mode === 'smart') return respondCards(game, playable).length > 0 ? 'popup' : 'autoPass';
  return 'autoPass';
}

/** The cards the board would glow for you: playable ids, minus opponents' permanents and command zone. */
export function respondCards(game: GameState, playable: Iterable<string>): string[] {
  const theirs = new Set(game.players.filter((p) => !p.you).flatMap((p) => [...p.battlefield, ...p.command]));
  return [...playable].filter((id) => !theirs.has(id) && game.cards[id]);
}
