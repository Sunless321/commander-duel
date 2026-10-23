import { useEffect } from 'react';
import { client } from './net/engineClient';
import type { DuelBridge, EngineEndpoint } from './net/protocol';
import { useStore } from './state/store';

declare global {
  interface Window {
    duel: DuelBridge;
  }
}

function connect(e: EngineEndpoint): void {
  client.connect(`ws://127.0.0.1:${e.port}/?token=${e.token}`);
}

async function startConnection(restart: boolean): Promise<void> {
  try {
    connect(await (restart ? window.duel.restartEngine() : window.duel.getEngine()));
  } catch (err) {
    console.error('engine unavailable', err);
    useStore.getState().handle({ type: 'engineStopped' });
  }
}

function EngineStopped() {
  const back = () => {
    useStore.getState().resetGame();
    useStore.getState().setScreen('decks');
    void startConnection(true);
  };
  return (
    <div style={{ padding: 32 }}>
      <h1>The game engine stopped</h1>
      <button onClick={back}>Back to menu</button>
    </div>
  );
}

export function App() {
  const screen = useStore((s) => s.screen);
  const lobby = useStore((s) => s.lobby);

  useEffect(() => {
    const off = client.on((m) => {
      useStore.getState().handle(m);
      if (m.type === 'ready') client.send({ type: 'listLobby' });
      if (m.type === 'lobby') console.log(`lobby: ${m.precons.length} precons`);
    });
    void startConnection(false);
    return off;
  }, []);

  if (screen === 'engineStopped') return <EngineStopped />;
  return (
    <div style={{ padding: 32 }}>
      {lobby ? `Engine connected · ${lobby.precons.length} precons` : 'Starting engine…'}
    </div>
  );
}
