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
  onclose: ((ev?: { code: number }) => void) | null = null;
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

describe('EngineClient close codes', () => {
  test('4002 retries instead of reporting engine-stopped', () => {
    vi.useFakeTimers();
    try {
      const c = new EngineClient();
      const seen: ClientEvent[] = [];
      c.on((m) => seen.push(m));
      c.connect('ws://a');
      c.connect('ws://a');
      const second = FakeWebSocket.last;
      second.onclose!({ code: 4002 });
      expect(seen).toEqual([]);
      vi.advanceTimersByTime(250);
      expect(FakeWebSocket.last).not.toBe(second);
      FakeWebSocket.last.onclose!({ code: 1006 });
      expect(seen).toEqual([{ type: 'engineStopped' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('gives up after repeated 4002', () => {
    vi.useFakeTimers();
    try {
      const c = new EngineClient();
      const seen: ClientEvent[] = [];
      c.on((m) => seen.push(m));
      c.connect('ws://a');
      for (let i = 0; i < 5; i++) {
        FakeWebSocket.last.onclose!({ code: 4002 });
        vi.advanceTimersByTime(250);
      }
      FakeWebSocket.last.onclose!({ code: 4002 });
      expect(seen).toEqual([{ type: 'engineStopped' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('store', () => {
  test('parses state message into store', () => {
    useStore.getState().handle({ type: 'state', seq: 1, state: fixture });
    expect(useStore.getState().game?.turn).toBe(fixture.turn);
    expect(useStore.getState().screen).toBe('board');
  });

  test('requests are queued FIFO and kept before the first state', () => {
    const req = (id: string) => ({
      type: 'request' as const, stateSeq: 1, requestId: id, kind: 'choose' as const, title: '', message: '',
      options: [], min: 1, max: 1, extras: {},
    });
    useStore.getState().handle(req('r1'));
    useStore.getState().handle(req('r2'));
    expect(useStore.getState().game).toBeNull();
    expect(useStore.getState().requests.map((r) => r.requestId)).toEqual(['r1', 'r2']);
  });

  test('engineStopped sets the engine-stopped screen and clears game state', () => {
    useStore.getState().handle({ type: 'state', seq: 1, state: fixture });
    useStore.getState().handle({ type: 'playable', cardIds: ['c1'] });
    useStore.getState().handle({ type: 'engineStopped' });
    expect(useStore.getState().game).toBeNull();
    expect(useStore.getState().playable.size).toBe(0);
    expect(useStore.getState().screen).toBe('engineStopped');
  });
});
