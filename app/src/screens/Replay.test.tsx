// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { client } from '../net/engineClient';
import type { GameState, PlayerDto, UiMessage } from '../net/protocol';
import { useStore } from '../state/store';
import { GameOver } from './GameOver';
import { Replay } from './Replay';

const player = (id: string, name: string, you: boolean, life = 40): PlayerDto => ({
  id, name, you, life, poison: 0, commanderDamage: {}, manaPool: {}, hand: [], handCount: 0, libraryCount: 90,
  graveyard: [], exile: [], command: [], battlefield: [], visibleLibrary: [], visibleHand: [],
});
const state = (turn: number, life: number): GameState => ({
  turn, phase: 'UNTAP', activePlayerId: 'p1', priorityPlayerId: null, youId: 'p1',
  players: [player('p1', 'You', true, life), player('p2', 'Anhelo, the Painter Bot', false)],
  cards: {}, stack: [], combat: [],
});

let sent: UiMessage[] = [];
beforeEach(() => {
  sent = [];
  vi.spyOn(client, 'send').mockImplementation((m) => { sent.push(m); });
  useStore.getState().resetGame();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function playAMatch() {
  act(() => {
    const h = useStore.getState().handle;
    h({ type: 'lobby', precons: [], decks: [{ id: 'buffs', name: 'Buffs by Hans', commanders: [] }] });
    useStore.setState({ lastStart: { type: 'startGame', deckId: 'buffs', bots: [] } });
    h({ type: 'state', seq: 1, state: state(1, 40) });
    h({ type: 'log', entries: [{ kind: 'TURN', text: 'Turn 1 (You)' }, { kind: 'LAND', text: 'You played Forest (12)' }] });
    h({ type: 'state', seq: 2, state: state(2, 33) });
    h({ type: 'log', entries: [{ kind: 'TURN', text: 'Turn 2 (Anhelo, the Painter Bot)' }, { kind: 'DAMAGE', text: 'Bear deals 7 damage to You.' }] });
    h({ type: 'state', seq: 3, state: state(2, 25) });
    h({ type: 'gameOver', winnerNames: ['Anhelo, the Painter Bot'], youWon: false });
  });
}

test('a finished match can be saved from the game-over screen', async () => {
  const saveRecording = vi.fn(async () => ({ id: 'x', savedAt: '', title: '', youWon: false, turns: 2 }));
  (window as unknown as { duel: unknown }).duel = { saveRecording };
  playAMatch();
  render(<GameOver />);
  fireEvent.click(screen.getByRole('button', { name: 'Save recording' }));
  await act(async () => {});
  expect(saveRecording).toHaveBeenCalledTimes(1);
  const rec = (saveRecording.mock.calls[0] as unknown[])[0] as { title: string; turns: unknown[]; log: unknown[] };
  expect(rec.title).toBe('Buffs by Hans vs Anhelo, the Painter');
  expect(rec.turns).toHaveLength(2);
  expect(rec.log).toHaveLength(4);
  expect(screen.getByRole('button', { name: /Recording saved/ })).toBeTruthy();
  // and the live log was still cleared with the match
  expect(useStore.getState().log).toEqual([]);
});

test('the replay steps through turns with their moves, then the final board, and never talks to the engine', () => {
  playAMatch();
  act(() => useStore.getState().openReplay(useStore.getState().lastRecording!));
  render(<Replay />);
  expect(screen.getByText('Turn 1')).toBeTruthy();
  expect(screen.getByText('You played Forest')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next turn' }));
  expect(screen.getByText('Bear deals 7 damage to You.')).toBeTruthy();
  expect(document.querySelector('[data-panel-for="p1"] .life')?.textContent).toBe('33');
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(screen.getByText('End of game')).toBeTruthy();
  expect(document.querySelector('[data-panel-for="p1"] .life')?.textContent).toBe('25');
  expect((screen.getByRole('button', { name: 'Next turn' }) as HTMLButtonElement).disabled).toBe(true);
  // clicking a player panel in a replay sends nothing
  fireEvent.click(screen.getByRole('button', { name: /^You, life/ }));
  expect(sent).toEqual([]);
});
