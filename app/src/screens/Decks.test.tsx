// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { client } from '../net/engineClient';
import type { UiMessage } from '../net/protocol';
import { useStore } from '../state/store';
import { Decks } from './Decks';

let sent: UiMessage[] = [];

beforeEach(() => {
  sent = [];
  vi.spyOn(client, 'send').mockImplementation((m) => {
    sent.push(m);
  });
  act(() => useStore.getState().handle({
    type: 'lobby', precons: [],
    decks: [{ id: 'buffs', name: 'Buffs by Hans', commanders: ['Xyris, the Writhing Storm'] }],
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useStore.setState({ lastError: null });
});

test('rename edits the name in place and sends renameDeck with the trimmed name', () => {
  render(<Decks />);
  fireEvent.click(screen.getByRole('button', { name: 'Rename Buffs by Hans' }));
  const input = screen.getByRole('textbox', { name: 'New name for Buffs by Hans' });
  fireEvent.change(input, { target: { value: '  Snake Storm  ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(sent).toEqual([{ type: 'renameDeck', deckId: 'buffs', name: 'Snake Storm' }]);
  expect(screen.queryByRole('textbox', { name: /New name/ })).toBeNull();
});

test('rename with an unchanged or blank name sends nothing; Escape cancels', () => {
  render(<Decks />);
  fireEvent.click(screen.getByRole('button', { name: 'Rename Buffs by Hans' }));
  const input = screen.getByRole('textbox', { name: 'New name for Buffs by Hans' });
  fireEvent.change(input, { target: { value: '   ' } });
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Rename Buffs by Hans' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(sent).toEqual([]);
});

test('delete asks first; Keep backs out and Delete sends deleteDeck', () => {
  render(<Decks />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Buffs by Hans' }));
  expect(screen.queryByText('Delete this deck?')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
  expect(sent).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Buffs by Hans' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(sent).toEqual([{ type: 'deleteDeck', deckId: 'buffs' }]);
});

test('an engine error (e.g. a rejected rename) is shown on the decks screen', () => {
  render(<Decks />);
  act(() => useStore.getState().handle({ type: 'error', message: "A deck name can't be empty" }));
  expect(screen.getByRole('alert').textContent).toBe("A deck name can't be empty");
});
