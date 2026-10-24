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
  graveyard: [], exile: [], command: [], battlefield: [], visibleLibrary: [], visibleHand: [], ...over,
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
  type: 'prompt', stateSeq: 1, promptSeq: 1, message: 'You have priority', inputKind: 'priority',
  ok: { label: 'OK', enabled: true }, cancel: null, ...over,
});

const setup = (g: GameState, playable: string[], p: PromptMsg = prompt()) =>
  act(() => useStore.setState({ game: g, prompt: p, playable: new Set(playable), stateSeq: 1 }));

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
  expect(sent).toEqual([{ type: 'action', action: 'selectCard', id: 'c1', promptSeq: 1 }]);
});

test('popup Let it resolve sends ok', async () => {
  setup(game(), ['c1']);
  render(<ResponsePopup />);
  await userEvent.click(screen.getByRole('button', { name: 'Let it resolve' }));
  expect(sent).toEqual([{ type: 'action', action: 'ok', promptSeq: 1 }]);
});

test('popup closes when the prompt changes', () => {
  setup(game(), ['c1']);
  render(<ResponsePopup />);
  act(() => useStore.setState({ prompt: prompt({ inputKind: 'target', message: 'Pick a victim' }) }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('an open request hides the popup', () => {
  setup(game(), ['c1']);
  const r: RequestMsg = { type: 'request', stateSeq: 1, requestId: 'r1', kind: 'confirm', title: 't', message: 'm', options: [], min: 0, max: 0, extras: {} };
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
  expect(sent).toEqual([{ type: 'action', action: 'ok', promptSeq: 1 }]);
  act(() => useStore.setState({ game: game() })); // same state, new object
  expect(sent).toHaveLength(1);
  // the same prompt with a different stack item is not passed again: a new item comes with a new prompt
  act(() => useStore.setState({ game: game({ stack: [{ id: 's2', text: 'x', sourceCardId: null, activatorId: 'p2', targetIds: [] }] }) }));
  expect(sent).toHaveLength(1);
  act(() => useStore.setState({ prompt: prompt({ promptSeq: 2 }) }));
  expect(sent).toEqual([{ type: 'action', action: 'ok', promptSeq: 1 }, { type: 'action', action: 'ok', promptSeq: 2 }]);
});

test('smart mode ignores playable ids the popup would not show', () => {
  setup(game(), ['c4']); // only an opponent permanent
  render(<ResponsePopup />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(sent).toEqual([{ type: 'action', action: 'ok', promptSeq: 1 }]);
});

test('smart mode explains what it relies on', () => {
  setup(game(), ['c1']);
  render(<ResponsePopup />);
  expect(screen.getByText(/Uses the game's playable-card hints/)).toBeTruthy();
});

const pr = (stateSeq: number, message: string, inputKind: PromptMsg['inputKind'] = 'priority', promptSeq = stateSeq): PromptMsg => ({
  type: 'prompt', stateSeq, promptSeq, message, inputKind, ok: inputKind === 'wait' ? null : { label: 'OK', enabled: true }, cancel: null,
});

test('a prompt whose stateSeq does not match the applied state is not acted on', () => {
  const h = useStore.getState().handle;
  act(() => {
    h({ type: 'state', seq: 1, state: game({ stack: [] }) });
    h({ type: 'playable', cardIds: [] });
  });
  render(<ResponsePopup />);
  // prompt B was stamped for state 2, which has not arrived: the applied state (1) must not be used
  act(() => h(pr(2, 'B')));
  expect(sent).toEqual([]);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('once the matching state arrives the prompt is decided (auto-pass)', () => {
  const h = useStore.getState().handle;
  act(() => h({ type: 'state', seq: 1, state: game({ stack: [] }) }));
  render(<ResponsePopup />);
  act(() => h(pr(2, 'B')));
  expect(sent).toEqual([]);
  act(() => h({ type: 'state', seq: 2, state: game() })); // opponent spell, nothing playable
  expect(sent).toEqual([{ type: 'action', action: 'ok', promptSeq: 2 }]);
});

test('a mismatched pair shows no popup; the matching state shows it', () => {
  const h = useStore.getState().handle;
  act(() => {
    h({ type: 'state', seq: 1, state: game({ stack: [] }) });
    h({ type: 'playable', cardIds: ['c1'] });
  });
  render(<ResponsePopup />);
  act(() => h(pr(2, 'B')));
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => h({ type: 'state', seq: 2, state: game() }));
  expect(screen.getByRole('dialog')).toBeTruthy();
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
  expect(sent).toEqual([{ type: 'action', action: 'ok', promptSeq: 1 }]);
});

test('a newer state while the same prompt stands keeps the popup (older waits, equal decides, newer decides)', () => {
  const h = useStore.getState().handle;
  act(() => {
    h({ type: 'state', seq: 1, state: game({ stack: [] }) });
    h({ type: 'playable', cardIds: ['c1'] });
  });
  render(<ResponsePopup />);
  act(() => h(pr(2, 'B')));
  expect(screen.queryByRole('dialog')).toBeNull(); // older state: wait
  act(() => h({ type: 'state', seq: 2, state: game() }));
  expect(screen.getByRole('dialog')).toBeTruthy(); // equal: decide
  const g = game();
  g.players[0].manaPool = { G: 1 };
  act(() => h({ type: 'state', seq: 3, state: g })); // e.g. a mana-pool update after the prompt
  expect(screen.getByRole('dialog')).toBeTruthy(); // newer: still decides
});

test('a prompt that showed the popup is never auto-passed, even when playable empties (you clicked a response)', () => {
  setup(game(), ['c1']);
  render(<ResponsePopup />);
  expect(screen.getByRole('dialog')).toBeTruthy();
  // Forge clears the playable list as soon as your click stops the priority input
  act(() => useStore.setState({ playable: new Set() }));
  expect(sent).toEqual([]);
});

test('auto-pass needs the state the prompt was stamped with; a newer state means the prompt is about to change', () => {
  const h = useStore.getState().handle;
  render(<ResponsePopup />);
  act(() => {
    h({ type: 'state', seq: 3, state: game() }); // flushed for the next (not yet arrived) prompt
    h({ type: 'playable', cardIds: [] });
  });
  act(() => useStore.setState({ prompt: pr(2, 'B') }));
  expect(sent).toEqual([]);
});
