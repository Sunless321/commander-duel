import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EngineClient, type ClientEvent } from './engineClient';
import { useStore } from '../state/store';
import type { GameState } from './protocol';

class FakeWebSocket {
  static OPEN = 1;
  static last: FakeWebSocket;
  readyState = 1;
  sent: string[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.last = this;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
}

const fixture: GameState = {
  turn: 3, phase: 'MAIN1', activePlayerId: 'p1', priorityPlayerId: 'p1', youId: 'p1',
  players: [], cards: {}, stack: [], combat: [],
};

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  useStore.getState().resetGame();
  useStore.setState({ screen: 'decks' });
});
afterEach(() => vi.unstubAllGlobals());

describe('EngineClient', () => {
  test('close event surfaces engine-stopped', () => {
    const c = new EngineClient();
    const seen: ClientEvent[] = [];
    c.on((m) => seen.push(m));
    c.connect('ws://127.0.0.1:1/?token=x');
    FakeWebSocket.last.onclose!();
    expect(seen).toEqual([{ type: 'engineStopped' }]);
  });

  test('replacing the socket does not report engine-stopped for the old one', () => {
    const c = new EngineClient();
    const seen: ClientEvent[] = [];
    c.on((m) => seen.push(m));
    c.connect('ws://a');
    const first = FakeWebSocket.last;
    c.connect('ws://b');
    first.onclose!();
    expect(seen).toEqual([]);
  });

  test('send serializes and incoming messages are delivered', () => {
    const c = new EngineClient();
    const seen: ClientEvent[] = [];
    c.on((m) => seen.push(m));
    c.connect('ws://a');
    c.send({ type: 'listLobby' });
    expect(FakeWebSocket.last.sent).toEqual(['{"type":"listLobby"}']);
    FakeWebSocket.last.onmessage!({ data: '{"type":"ready"}' });
    expect(seen).toEqual([{ type: 'ready' }]);
  });
});

describe('store', () => {
  test('parses state message into store', () => {
    useStore.getState().handle({ type: 'state', state: fixture });
    expect(useStore.getState().game?.turn).toBe(fixture.turn);
    expect(useStore.getState().screen).toBe('board');
  });

  test('requests are queued FIFO and kept before the first state', () => {
    const req = (id: string) => ({
      type: 'request' as const, requestId: id, kind: 'choose' as const, title: '', message: '',
      options: [], min: 1, max: 1, extras: {},
    });
    useStore.getState().handle(req('r1'));
    useStore.getState().handle(req('r2'));
    expect(useStore.getState().game).toBeNull();
    expect(useStore.getState().requests.map((r) => r.requestId)).toEqual(['r1', 'r2']);
  });

  test('engineStopped sets the engine-stopped screen', () => {
    useStore.getState().handle({ type: 'engineStopped' });
    expect(useStore.getState().screen).toBe('engineStopped');
  });
});
