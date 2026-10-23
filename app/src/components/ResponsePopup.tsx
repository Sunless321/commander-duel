import { useEffect, useRef } from 'react';
import { autoPassKey, decideResponse, respondCards } from '../logic/respondPolicy';
import { client } from '../net/engineClient';
import type { CardDto, GameState } from '../net/protocol';
import { useStore, type RespondMode } from '../state/store';
import { Card } from './Card';
import '../styles/popup.css';

const MODES: { id: RespondMode; label: string }[] = [
  { id: 'always', label: 'Every time' },
  { id: 'smart', label: 'Only when I have a response' },
  { id: 'never', label: 'Never' },
];

/**
 * Timing popup (mockup screen 2): shown when you hold priority over an opponent's spell or ability.
 * It never judges legality. Cards come from the engine's playable list, and auto-pass only ever
 * answers a plain priority prompt by pressing the engine's own enabled OK.
 */
export function ResponsePopup() {
  const game = useStore((s) => s.game);
  const prompt = useStore((s) => s.prompt);
  const playable = useStore((s) => s.playable);
  const mode = useStore((s) => s.respondMode);
  const tipDismissed = useStore((s) => s.respondTipDismissed);
  const stateSeq = useStore((s) => s.stateSeq);
  const requestOpen = useStore((s) => s.requests.length > 0);
  const passedKey = useRef<string | null>(null);

  // An open request always wins, and then we neither show nor answer anything.
  const decision = requestOpen || !game || !prompt || prompt.stateSeq > stateSeq
    ? 'none'
    : decideResponse({ prompt, game, playable, mode, youId: game.youId });

  useEffect(() => {
    if (decision !== 'autoPass' || !game || !prompt) return;
    const key = autoPassKey(game, prompt);
    if (passedKey.current === key) return;
    passedKey.current = key;
    client.send({ type: 'action', action: 'ok' });
  }, [decision, game, prompt]);

  if (decision !== 'popup' || !game || !prompt) return null;
  const item = game.stack[0];
  const source = item.sourceCardId ? game.cards[item.sourceCardId] : undefined;
  const activator = game.players.find((p) => p.id === item.activatorId);
  const who = activator?.name ?? 'Opponent';
  const title = source?.zone === 'Stack' ? `${who} is casting a spell` : `${who} activated an ability`;
  const responses = respondCards(game, playable);
  const okLabel = prompt.ok?.label;

  return (
    <div className="modal-backdrop popup-backdrop">
      <div className="response-popup" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <span className="popup-kicker">Your chance to respond</span>
          <h1 className="popup-title">{title}</h1>
        </header>

        <div className="popup-item">
          {source && <Card card={source} size="stack" glow={false} selectable={false} chosen={false} />}
          {item.targetIds.length > 0 && (
            <>
              <svg width="40" height="20" viewBox="0 0 40 20" aria-hidden="true">
                <path d="M2 10h32M26 3l8 7-8 7" fill="none" stroke="#d4a64a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {item.targetIds.map((id) => <Target key={id} id={id} game={game} />)}
            </>
          )}
          <p className="popup-text">{item.text}</p>
        </div>

        {!tipDismissed && (
          <div className="popup-tip">
            <span className="popup-tip-title">What&apos;s happening?</span>
            <span>
              The spell is on the <b>stack</b> and hasn&apos;t happened yet. You have <b>priority</b>, which means you can cast an
              instant or use an ability now. Whatever you cast goes on top and resolves first.
            </span>
            <button type="button" className="toast-close" aria-label="Dismiss explanation" onClick={() => useStore.getState().dismissRespondTip()}>
              ✕
            </button>
          </div>
        )}

        {responses.length > 0 && (
          <div className="popup-responses">
            <span className="popup-label">You can respond with</span>
            <div className="popup-cards">
              {responses.map((id) => (
                <Card
                  key={id}
                  card={game.cards[id]}
                  size="stack"
                  glow
                  selectable={false}
                  chosen={false}
                  onClick={() => client.send({ type: 'action', action: 'selectCard', id })}
                />
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions popup-actions">
          <span className="popup-status">
            {responses.length > 0 ? 'Pick a glowing card, or let it resolve' : 'Nothing to respond with'}
          </span>
          <button type="button" className="btn" onClick={() => client.send({ type: 'action', action: 'ok' })}>
            Let it resolve
            {okLabel && okLabel !== 'OK' && okLabel !== 'Let it resolve' && <span className="popup-ok-label"> · {okLabel}</span>}
          </button>
        </div>

        <div className="popup-modes">
          <span className="popup-label">Ask me to respond</span>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`pill${mode === m.id ? ' on' : ''}`}
              aria-pressed={mode === m.id}
              onClick={() => useStore.getState().setRespondMode(m.id)}
            >
              {m.label}
            </button>
          ))}
          {mode === 'smart' && (
            <p className="popup-help">
              Uses the game's playable-card hints; choose Every time if you rely on unusual abilities.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Target({ id, game }: { id: string; game: GameState }) {
  const card: CardDto | undefined = game.cards[id];
  if (card) return <Card card={card} size="stack" glow={false} selectable={false} chosen={false} />;
  const player = game.players.find((p) => p.id === id);
  if (player) return <span className="popup-target">{player.you ? 'You' : player.name}</span>;
  const stackItem = game.stack.find((s) => s.id === id);
  return stackItem ? <span className="popup-target">{stackItem.text}</span> : null;
}
