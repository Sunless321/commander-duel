// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { client } from '../net/engineClient';
import type { CardDto, GameState, PlayerDto, UiMessage } from '../net/protocol';
import { useStore } from '../state/store';
import { Board } from './Board';

let sent: UiMessage[] = [];

beforeEach(() => {
  sent = [];
  vi.spyOn(client, 'send').mockImplementation((m) => {
    sent.push(m);
  });
  useStore.getState().resetGame();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = (id: string, ownerId: string, zone: string, over: Partial<CardDto> = {}): CardDto => ({
  id, name: `Card ${id}`, ownerId, controllerId: ownerId, zone, tapped: false, sick: false, hidden: false,
  imageUrl: null, manaCost: null, typeLine: 'Creature', text: null, power: '2', toughness: '2', damage: 0,
  counters: {}, attachedToId: null, commander: false, ...over,
});

const player = (id: string, name: string, you: boolean, over: Partial<PlayerDto> = {}): PlayerDto => ({
  id, name, you, life: 40, poison: 0, commanderDamage: {}, manaPool: {}, hand: [], handCount: 0, libraryCount: 92,
  graveyard: [], exile: [], command: [], battlefield: [], ...over,
});

function game(): GameState {
  return {
    turn: 3,
    phase: 'MAIN1',
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
    youId: 'p1',
    players: [
      player('p1', 'You', true, { hand: ['c1', 'c2'], handCount: 2, battlefield: ['c3'], command: ['c6'] }),
      player('p2', 'Bot 1', false, { handCount: 5, battlefield: ['c4'] }),
    ],
    cards: {
      c1: card('c1', 'p1', 'Hand'),
      c2: card('c2', 'p1', 'Hand'),
      c3: card('c3', 'p1', 'Battlefield'),
      c4: card('c4', 'p2', 'Battlefield'),
      c6: card('c6', 'p1', 'Command', { commander: true }),
    },
    stack: [],
    combat: [],
  };
}

const cardEl = (id: string) => document.querySelector(`[data-card-id="${id}"] .card`) as HTMLElement;
const glows = (id: string) => cardEl(id).classList.contains('glow');

test('glowing cards = playable ∩ your hand/battlefield; none when selection active', () => {
  act(() => {
    useStore.getState().handle({ type: 'state', state: game() });
    useStore.getState().handle({ type: 'playable', cardIds: ['c1', 'c3', 'c4', 'c99'] });
  });
  render(<Board />);
  expect(glows('c1')).toBe(true);
  expect(glows('c2')).toBe(false);
  expect(glows('c3')).toBe(true);
  expect(glows('c4')).toBe(false);

  act(() => useStore.getState().handle({ type: 'selection', selectable: ['c4', 'p2'], chosen: ['c3'], min: 1, max: 1 }));
  for (const id of ['c1', 'c2', 'c3', 'c4']) expect(glows(id)).toBe(false);
  expect(cardEl('c4').classList.contains('selectable')).toBe(true);
  expect(cardEl('c3').classList.contains('chosen')).toBe(true);
  expect(cardEl('c1').classList.contains('selectable')).toBe(false);

  // Clicks relay to the engine, whatever is lit.
  fireEvent.click(cardEl('c2'));
  fireEvent.click(screen.getByRole('button', { name: /Bot 1/ }));
  expect(sent).toEqual([
    { type: 'action', action: 'selectCard', id: 'c2' },
    { type: 'action', action: 'selectPlayer', id: 'p2' },
  ]);
});

test('ok button mirrors engine label and enabled flag', () => {
  act(() => useStore.getState().handle({
    type: 'prompt', message: 'Keep this hand?', inputKind: 'mulligan',
    ok: { label: 'Keep', enabled: false }, cancel: { label: 'Mulligan', enabled: true },
  }));
  // Prompts arrive before the first state: the bar renders without a game.
  render(<Board />);
  expect(screen.queryByText('Keep this hand?')).not.toBeNull();
  const keep = screen.getByRole('button', { name: 'Keep' }) as HTMLButtonElement;
  expect(keep.disabled).toBe(true);
  const mull = screen.getByRole('button', { name: 'Mulligan' }) as HTMLButtonElement;
  expect(mull.disabled).toBe(false);
  fireEvent.click(mull);
  expect(sent).toEqual([{ type: 'action', action: 'cancel' }]);
});

test('opponent hand renders count of card backs', () => {
  act(() => useStore.getState().handle({ type: 'state', state: game() }));
  render(<Board />);
  const hand = document.querySelector('[data-player-id="p2"] .opp-hand') as HTMLElement;
  expect(hand.querySelectorAll('.card.card-back').length).toBe(5);
});
