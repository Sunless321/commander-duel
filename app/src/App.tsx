import { useEffect } from 'react';
import { client } from './net/engineClient';
import type { DuelBridge, EngineEndpoint } from './net/protocol';
import { Decks } from './screens/Decks';
import { useStore } from './state/store';

declare global {
  interface Window {
    duel: DuelBridge;
  }
}

function connect(e: EngineEndpoint): void {
  client.connect(`ws://127.0.0.1:${e.port}/?token=${e.token}`);
}

async function startConnection(restart: boolean, isCancelled: () => boolean = () => false): Promise<void> {
  try {
    const endpoint = await (restart ? window.duel.restartEngine() : window.duel.getEngine());
    if (!isCancelled()) connect(endpoint);
  } catch (err) {
    console.error('engine unavailable', err);
    useStore.getState().handle({ type: 'engineStopped' });
  }
}

function EngineStopped() {
  const back = () => {
    useStore.getState().resetGame();
    useStore.setState({ lobby: null });
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
      if (m.type === 'importResult' && m.ok) client.send({ type: 'listLobby' });
      if (m.type === 'lobby') console.log(`lobby: ${m.precons.length} precons`);
    });
    let cancelled = false;
    void startConnection(false, () => cancelled);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (screen === 'engineStopped') return <EngineStopped />;
  if (!lobby) return <div style={{ padding: 32 }}>Starting engine…</div>;
  if (screen === 'setup') return <SetupPlaceholder />;
  return <Decks />;
}

// Replaced by the real Setup screen in Task 10.
function SetupPlaceholder() {
  const deck = useStore((s) => s.selectedDeck);
  return (
    <div style={{ padding: 32 }}>
      <h1>Setup</h1>
      <p>Chosen deck: {deck?.name ?? 'none'}</p>
      <button onClick={() => useStore.getState().setScreen('decks')}>Back</button>
    </div>
  );
}
