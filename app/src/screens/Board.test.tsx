// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  graveyard: [], exile: [], command: [], battlefield: [], visibleLibrary: [], visibleHand: [], ...over,
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
    useStore.getState().handle({ type: 'state', seq: 1, state: game() });
    useStore.getState().handle({ type: 'playable', cardIds: ['c1', 'c3', 'c4', 'c99'] });
  });
  render(<Board />);
  expect(glows('c1')).toBe(true);
  expect(glows('c2')).toBe(false);
  expect(glows('c3')).toBe(true);
  expect(glows('c4')).toBe(false);

  act(() => useStore.getState().handle({ type: 'selection', stateSeq: 1, selectable: ['c4', 'p2'], chosen: ['c3'], min: 1, max: 1 }));
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
    type: 'prompt', stateSeq: 1, message: 'Keep this hand?', inputKind: 'mulligan',
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
  act(() => useStore.getState().handle({ type: 'state', seq: 1, state: game() }));
  render(<Board />);
  const hand = document.querySelector('[data-player-id="p2"] .opp-hand') as HTMLElement;
  expect(hand.querySelectorAll('.card.card-back').length).toBe(5);
});

function stateWith(edit: (g: GameState) => void): GameState {
  const g = game();
  edit(g);
  return g;
}
const inPlayer = (pid: string) => within(document.querySelector(`[data-panel-for="${pid}"]`) as HTMLElement);

test('a playable card in your graveyard is lit in the zone viewer and clicking it sends selectCard', () => {
  act(() => {
    useStore.getState().handle({
      type: 'state', seq: 1,
      state: stateWith((g) => {
        g.players[0].graveyard = ['c7'];
        g.cards.c7 = card('c7', 'p1', 'Graveyard', { name: 'Think Twice' });
      }),
    });
    useStore.getState().handle({ type: 'playable', cardIds: ['c7'] });
  });
  render(<Board />);
  const zone = inPlayer('p1').getByRole('button', { name: /^Graveyard \(1\), has playable/ });
  expect(zone.classList.contains('lit')).toBe(true);
  fireEvent.click(zone);
  const viewer = screen.getByRole('dialog', { name: /Your graveyard/ });
  const think = within(viewer).getByRole('button', { name: 'Think Twice' });
  expect(think.classList.contains('glow')).toBe(true);
  fireEvent.click(think);
  expect(sent).toEqual([{ type: 'action', action: 'selectCard', id: 'c7' }]);
});

test("a selectable card in an opponent's exile is reachable", () => {
  act(() => {
    useStore.getState().handle({
      type: 'state', seq: 1,
      state: stateWith((g) => {
        g.players[1].exile = ['c8'];
        g.cards.c8 = card('c8', 'p2', 'Exile', { name: 'Exiled Thing' });
      }),
    });
    useStore.getState().handle({ type: 'selection', stateSeq: 1, selectable: ['c8'], chosen: [], min: 1, max: 1 });
  });
  render(<Board />);
  fireEvent.click(inPlayer('p2').getByRole('button', { name: /^Exile \(1\), has playable/ }));
  const viewer = screen.getByRole('dialog', { name: /Bot 1's exile/ });
  const thing = within(viewer).getByRole('button', { name: 'Exiled Thing' });
  expect(thing.classList.contains('selectable')).toBe(true);
  fireEvent.click(thing);
  expect(sent).toEqual([{ type: 'action', action: 'selectCard', id: 'c8' }]);
});

test('an offered card in no rendered zone appears in the Playable elsewhere strip', () => {
  act(() => {
    useStore.getState().handle({
      type: 'state', seq: 1,
      state: stateWith((g) => {
        g.cards.c9 = card('c9', 'p1', 'Library', { name: 'Top Card' });
      }),
    });
    useStore.getState().handle({ type: 'playable', cardIds: ['c9', 'c1'] });
  });
  render(<Board />);
  const strip = screen.getByRole('region', { name: 'Playable elsewhere' });
  expect(within(strip).queryByRole('button', { name: 'Card c1' })).toBeNull();
  fireEvent.click(within(strip).getByRole('button', { name: 'Top Card' }));
  expect(sent).toEqual([{ type: 'action', action: 'selectCard', id: 'c9' }]);
});

test('a selection over cards only in your visibleLibrary opens "Choose from" and clicks send selectCard', () => {
  act(() => {
    useStore.getState().handle({
      type: 'state', seq: 1,
      state: stateWith((g) => {
        g.players[0].visibleLibrary = ['c20', 'c21'];
        g.cards.c20 = card('c20', 'p1', 'Library', { name: 'Forest' });
        g.cards.c21 = card('c21', 'p1', 'Library', { name: 'Swamp' });
      }),
    });
    useStore.getState().handle({
      type: 'prompt', stateSeq: 1, message: 'Search for a Forest or Swamp', inputKind: 'select',
      ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: true },
    });
    useStore.getState().handle({ type: 'selection', stateSeq: 1, selectable: ['c20', 'c21'], chosen: [], min: 1, max: 1 });
  });
  render(<Board />);
  const panel = screen.getByRole('region', { name: /Choose from/ });
  expect(within(panel).queryByText('Your library')).not.toBeNull();
  const forest = within(panel).getByRole('button', { name: 'Forest' });
  expect(forest.classList.contains('selectable')).toBe(true);
  expect(within(panel).getByRole('button', { name: 'Swamp' }).classList.contains('selectable')).toBe(true);
  // Not duplicated in the safety strip; the prompt's buttons stay reachable.
  expect(screen.queryByRole('region', { name: 'Playable elsewhere' })).toBeNull();
  fireEvent.click(forest);
  expect(sent).toEqual([{ type: 'action', action: 'selectCard', id: 'c20' }]);

  act(() => {
    useStore.getState().handle({ type: 'selection', stateSeq: 1, selectable: ['c20', 'c21'], chosen: ['c20'], min: 1, max: 1 });
    useStore.getState().handle({
      type: 'prompt', stateSeq: 1, message: 'Search for a Forest or Swamp', inputKind: 'select',
      ok: { label: 'OK', enabled: true }, cancel: { label: 'Cancel', enabled: true },
    });
  });
  expect(within(screen.getByRole('region', { name: /Choose from/ })).getByRole('button', { name: 'Forest' }).classList.contains('chosen')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  expect(sent[1]).toEqual({ type: 'action', action: 'ok' });

  // The search ends: the cards leave the state and the panel closes.
  act(() => {
    useStore.getState().handle({ type: 'state', seq: 2, state: game() });
    useStore.getState().handle({ type: 'selection', stateSeq: 2, selectable: [], chosen: [], min: 0, max: 0 });
  });
  expect(screen.queryByRole('region', { name: /Choose from/ })).toBeNull();
});

test("a revealed opponent hand card offered by a selection is grouped under that player's hand", () => {
  act(() => {
    useStore.getState().handle({
      type: 'state', seq: 1,
      state: stateWith((g) => {
        g.players[1].visibleHand = ['c30'];
        g.cards.c30 = card('c30', 'p2', 'Hand', { name: 'Revealed Spell' });
      }),
    });
    useStore.getState().handle({ type: 'selection', stateSeq: 1, selectable: ['c30'], chosen: [], min: 1, max: 1 });
  });
  render(<Board />);
  const panel = screen.getByRole('region', { name: /Choose from/ });
  expect(within(panel).queryByText("Bot 1's hand")).not.toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: 'Revealed Spell' }));
  expect(sent).toEqual([{ type: 'action', action: 'selectCard', id: 'c30' }]);
});

test('concede asks in the page first, then sends concede', () => {
  act(() => useStore.getState().handle({ type: 'state', seq: 1, state: game() }));
  render(<Board />);
  fireEvent.click(screen.getByRole('button', { name: 'Concede' }));
  expect(screen.queryByText('Concede this game?')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'No' }));
  expect(sent).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Concede' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  expect(sent).toEqual([{ type: 'action', action: 'concede' }]);
});

test('a hand card is a button that Enter and Space activate', async () => {
  act(() => useStore.getState().handle({ type: 'state', seq: 1, state: game() }));
  render(<Board />);
  const user = userEvent.setup();
  const c1 = within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: 'Card c1' });
  expect(c1.tagName).toBe('BUTTON');
  c1.focus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(sent).toEqual([
    { type: 'action', action: 'selectCard', id: 'c1' },
    { type: 'action', action: 'selectCard', id: 'c1' },
  ]);
});

test('a chosen-only selection keeps the glow', () => {
  act(() => {
    useStore.getState().handle({ type: 'state', seq: 1, state: game() });
    useStore.getState().handle({ type: 'playable', cardIds: ['c3'] });
    useStore.getState().handle({ type: 'selection', stateSeq: 1, selectable: [], chosen: ['p2'], min: 0, max: 0 });
  });
  render(<Board />);
  expect(glows('c3')).toBe(true);
});

test('choosing the starting player: every panel, including your own, is selectable and clickable', () => {
  const g = game();
  g.players.push(player('p3', 'Bot 2', false, { handCount: 5 }));
  act(() => {
    useStore.getState().handle({ type: 'state', seq: 1, state: g });
    useStore.getState().handle({ type: 'selection', stateSeq: 1, selectable: ['p1', 'p2', 'p3'], chosen: [], min: 1, max: 1 });
  });
  render(<Board />);
  for (const id of ['p1', 'p2', 'p3']) {
    expect((document.querySelector(`[data-panel-for="${id}"]`) as HTMLElement).classList.contains('selectable')).toBe(true);
  }
  fireEvent.click(inPlayer('p1').getByRole('button', { name: /You, life/ }));
  expect(sent).toEqual([{ type: 'action', action: 'selectPlayer', id: 'p1' }]);
});
