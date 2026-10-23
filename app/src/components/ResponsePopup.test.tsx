// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { client } from '../net/engineClient';
import type { CardDto, GameState, PlayerDto, PromptMsg, RequestMsg, UiMessage } from '../net/protocol';
import { useStore } from '../state/store';
import { ResponsePopup } from './ResponsePopup';

let sent: UiMessage[] = [];

beforeEach(() => {
  sent = [];
  vi.spyOn(client, 'send').mockImplementation((m) => {
    sent.push(m);
  });
  localStorage.clear();
  useStore.getState().resetGame();
  useStore.setState({ respondMode: 'smart', respondTipDismissed: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = (id: string, ownerId: string, zone: string, name: string, over: Partial<CardDto> = {}): CardDto => ({
  id, name, ownerId, controllerId: ownerId, zone, tapped: false, sick: false, hidden: false,
  imageUrl: null, manaCost: null, typeLine: 'Instant', text: null, power: null, toughness: null, damage: 0,
  counters: {}, attachedToId: null, commander: false, ...over,
});

const player = (id: string, name: string, you: boolean, over: Partial<PlayerDto> = {}): PlayerDto => ({
  id, name, you, life: 40, poison: 0, commanderDamage: {}, manaPool: {}, hand: [], handCount: 0, libraryCount: 92,
  graveyard: [], exile: [], command: [], battlefield: [], ...over,
});

function game(over: Partial<GameState> = {}): GameState {
  return {
    turn: 3, phase: 'MAIN1', activePlayerId: 'p2', priorityPlayerId: 'p1', youId: 'p1',
    players: [
      player('p1', 'You', true, { hand: ['c1'], battlefield: ['c3'] }),
      player('p2', 'Atraxa Bot', false, { battlefield: ['c4'] }),
    ],
    cards: {
      c1: card('c1', 'p1', 'Hand', 'Lightning Bolt'),
      c3: card('c3', 'p1', 'Battlefield', 'Llanowar Elves', { typeLine: 'Creature' }),
      c4: card('c4', 'p2', 'Battlefield', 'Their Rock', { typeLine: 'Artifact' }),
      c9: card('c9', 'p2', 'Stack', 'Swords to Plowshares'),
    },
    stack: [{ id: 's1', text: 'Exile target creature.', sourceCardId: 'c9', activatorId: 'p2', targetIds: ['c3'] }],
    combat: [],
    ...over,
  };
}

const prompt = (over: Partial<PromptMsg> = {}): PromptMsg => ({
  type: 'prompt', message: 'You have priority', inputKind: 'priority',
  ok: { label: 'OK', enabled: true }, cancel: null, ...over,
});

const setup = (g: GameState, playable: string[], p: PromptMsg = prompt()) =>
  act(() => useStore.setState({ game: g, prompt: p, playable: new Set(playable) }));

test('shows the spell, its target, text and the playable card', () => {
  setup(game(), ['c1']);
  render(<ResponsePopup />);
  expect(screen.getByRole('dialog', { name: 'Atraxa Bot is casting a spell' })).toBeTruthy();
  expect(screen.getByText('Exile target creature.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Lightning Bolt' })).toBeTruthy();
  expect(screen.getByText(/The spell is on the/)).toBeTruthy();
});

test('an ability source off the stack reads "activated an ability"', () => {
  const g = game();
  g.cards.c9 = card('c9', 'p2', 'Battlefield', 'Their Rock');
  setup(g, ['c1']);
  render(<ResponsePopup />);
  expect(screen.getByRole('dialog', { name: 'Atraxa Bot activated an ability' })).toBeTruthy();
});

test('clicking a response card sends selectCard; opponent permanents are not offered', async () => {
  setup(game(), ['c1', 'c4']);
  render(<ResponsePopup />);
  expect(screen.queryByRole('button', { name: 'Their Rock' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Lightning Bolt' }));
  expect(sent).toEqual([{ type: 'action', action: 'selectCard', id: 'c1' }]);
});

test('popup Let it resolve sends ok', async () => {
  setup(game(), ['c1']);
  render(<ResponsePopup />);
  await userEvent.click(screen.getByRole('button', { name: 'Let it resolve' }));
  expect(sent).toEqual([{ type: 'action', action: 'ok' }]);
});

test('popup closes when the prompt changes', () => {
  setup(game(), ['c1']);
  render(<ResponsePopup />);
  act(() => useStore.setState({ prompt: prompt({ inputKind: 'target', message: 'Pick a victim' }) }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('an open request hides the popup', () => {
  setup(game(), ['c1']);
  const r: RequestMsg = { type: 'request', requestId: 'r1', kind: 'confirm', title: 't', message: 'm', options: [], min: 0, max: 0, extras: {} };
  act(() => useStore.setState({ requests: [r] }));
  render(<ResponsePopup />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('mode control updates and persists the setting', async () => {
  setup(game(), ['c1']);
  render(<ResponsePopup />);
  await userEvent.click(screen.getByRole('button', { name: 'Never' }));
  expect(useStore.getState().respondMode).toBe('never');
  expect(localStorage.getItem('commanderDuel.respondMode')).toBe('never');
});

test('explainer can be dismissed and stays dismissed', async () => {
  setup(game(), ['c1']);
  const { unmount } = render(<ResponsePopup />);
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss explanation' }));
  expect(screen.queryByText(/The spell is on the/)).toBeNull();
  expect(localStorage.getItem('commanderDuel.respondTipDismissed')).toBe('1');
  unmount();
  render(<ResponsePopup />);
  expect(screen.queryByText(/The spell is on the/)).toBeNull();
});

test('autoPass sends ok once per stack item', () => {
  setup(game(), []);
  render(<ResponsePopup />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(sent).toEqual([{ type: 'action', action: 'ok' }]);
  act(() => useStore.setState({ game: game() })); // same state, new object
  expect(sent).toHaveLength(1);
  // a different stack item gets its own pass
  act(() => useStore.setState({ game: game({ stack: [{ id: 's2', text: 'x', sourceCardId: null, activatorId: 'p2', targetIds: [] }] }) }));
  expect(sent).toHaveLength(2);
});

test('autoPass never fires when ok is disabled or the prompt is not priority', () => {
  setup(game(), [], prompt({ ok: { label: 'OK', enabled: false } }));
  render(<ResponsePopup />);
  act(() => useStore.setState({ prompt: prompt({ inputKind: 'payMana', message: 'Pay' }) }));
  expect(sent).toEqual([]);
});

test('never mode auto-passes even when you could respond', () => {
  useStore.setState({ respondMode: 'never' });
  setup(game(), ['c1']);
  render(<ResponsePopup />);
  expect(sent).toEqual([{ type: 'action', action: 'ok' }]);
});
