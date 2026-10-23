// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { client } from '../net/engineClient';
import type { UiMessage } from '../net/protocol';
import { useStore, type StartGameMsg } from '../state/store';
import { GameOver, START_TIMEOUT_MS } from './GameOver';

let sent: UiMessage[] = [];
const start: StartGameMsg = { type: 'startGame', deckId: 'd1', bots: [{ deck: { kind: 'randomPrecon' }, difficulty: 'EASY' }] };

beforeEach(() => {
  sent = [];
  vi.spyOn(client, 'send').mockImplementation((m) => {
    sent.push(m);
  });
  useStore.getState().resetGame();
  useStore.setState({ lastStart: start, lastError: null });
  act(() => useStore.getState().handle({ type: 'gameOver', winnerNames: ['Bot 1'], youWon: false }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('play again resends the same setup and moves to the board when the game begins', () => {
  render(<GameOver />);
  expect(screen.queryByText('Bot 1 won')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
  expect(sent).toEqual([start]);
  expect(screen.queryByText('Bot 1 won')).not.toBeNull();
  act(() => useStore.getState().handle({ type: 'prompt', message: 'Play or draw?', inputKind: 'other', ok: null, cancel: null }));
  expect(useStore.getState().screen).toBe('board');
});

test('play again times out with an error and the buttons back on', () => {
  vi.useFakeTimers();
  render(<GameOver />);
  fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
  expect((screen.getByRole('button', { name: 'Starting game…' }) as HTMLButtonElement).disabled).toBe(true);
  act(() => vi.advanceTimersByTime(START_TIMEOUT_MS));
  expect(screen.getByRole('alert').textContent).toContain("didn't start");
  expect((screen.getByRole('button', { name: 'Play again' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'Back to decks' }) as HTMLButtonElement).disabled).toBe(false);
  expect(useStore.getState().screen).toBe('gameOver');
});
