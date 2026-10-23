// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { client } from '../net/engineClient';
import type { RequestMsg, UiMessage } from '../net/protocol';
import { useStore } from '../state/store';
import { RequestDialog } from './RequestDialog';

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

const req = (over: Partial<RequestMsg>): RequestMsg => ({
  type: 'request',
  stateSeq: 1,
  requestId: 'r1',
  kind: 'choose',
  title: 'Choose',
  message: 'Pick one',
  options: [
    { id: 'o0', label: 'Alpha', cardId: null },
    { id: 'o1', label: 'Beta', cardId: null },
    { id: 'o2', label: 'Gamma', cardId: null },
  ],
  min: 1,
  max: 1,
  extras: {},
  ...over,
});

const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

function open(r: RequestMsg) {
  act(() => useStore.getState().handle(r));
  return render(<RequestDialog />);
}

test('choose dialog enforces min/max', () => {
  open(req({}));
  const confirm = screen.getByRole('button', { name: 'Confirm' });
  expect(isDisabled(confirm)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
  expect(isDisabled(confirm)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
  const pressed = screen.getAllByRole('button', { pressed: true });
  expect(pressed.map((b) => b.textContent)).toEqual(['Beta']);
  fireEvent.click(confirm);
  expect(sent).toEqual([{ type: 'answer', requestId: 'r1', optionIds: ['o1'] }]);
});

test('answer only contains offered ids', () => {
  open(req({ min: 0, max: 3 }));
  for (const name of ['Gamma', 'Alpha', 'Beta']) fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(sent).toHaveLength(1);
  const m = sent[0] as { optionIds: string[] };
  expect(m.optionIds.length).toBe(3);
  for (const id of m.optionIds) expect(['o0', 'o1', 'o2']).toContain(id);
});

test('damage dialog requires exact total', () => {
  open(req({
    kind: 'damage',
    title: 'Assign damage dealt by Bear',
    options: [],
    min: 0,
    max: 0,
    extras: {
      amount: 3,
      maySkip: false,
      targets: [
        { id: 'c5', cardId: 'c5', label: 'Wall', max: 3 },
        { id: 'p2', playerId: 'p2', label: 'Bot 1', max: 3 },
      ],
    },
  }));
  const confirm = screen.getByRole('button', { name: 'Confirm' });
  expect(isDisabled(confirm)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'More to Wall' }));
  fireEvent.click(screen.getByRole('button', { name: 'More to Wall' }));
  expect(isDisabled(confirm)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'More to Bot 1' }));
  expect(isDisabled(confirm)).toBe(false);
  // The total cannot go past the amount.
  fireEvent.click(screen.getByRole('button', { name: 'More to Bot 1' }));
  fireEvent.click(confirm);
  expect(sent).toEqual([{ type: 'answer', requestId: 'r1', amounts: { c5: 2, p2: 1 } }]);
});

test('rejected keeps dialog open with reason', () => {
  open(req({}));
  fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(sent).toHaveLength(1);
  act(() => useStore.getState().handle({ type: 'rejected', requestId: 'r1', reason: 'not allowed here' }));
  expect(screen.queryByRole('dialog')).not.toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('not allowed here');
  expect(screen.queryByText('Pick one')).not.toBeNull();
});

test('"Other" number never goes below 0 (the engine accepts digits only)', () => {
  open(req({ kind: 'text', title: 'X', message: 'Enter a number', options: [], min: 0, max: 0, extras: { initial: '', numeric: true, min: -5, max: 3 } }));
  expect((screen.getByRole('button', { name: 'Less to value' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(sent).toEqual([{ type: 'answer', requestId: 'r1', text: '0' }]);
});
