import { useEffect, useRef, useState } from 'react';
import { cleanText, HIDDEN_STACK_TEXT } from '../logic/cleanText';
import { decideResponse, respondCards } from '../logic/respondPolicy';
import { sendAction } from '../net/sendAction';
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
  // Each prompt is auto-passed at most once, and never after it showed you the popup: clicking a response
  // clears the playable list before the next prompt arrives, which would otherwise read as "nothing to respond".
  const passedPrompt = useRef<number | null>(null);
  const shownPrompt = useRef<number | null>(null);
  // The card under the mouse, shown full size beside the spell so its text is readable.
  const [zoom, setZoom] = useState<string | null>(null);

  // An open request always wins, and then we neither show nor answer anything.
  const decision = requestOpen || !game || !prompt || prompt.stateSeq > stateSeq
    ? 'none'
    : decideResponse({ prompt, game, playable, mode, youId: game.youId });
  if (decision === 'popup' && prompt) shownPrompt.current = prompt.promptSeq;

  useEffect(() => {
    if (decision !== 'autoPass' || !game || !prompt) return;
    // Only on the exact state the prompt was stamped with: a newer state is flushed just before the next prompt,
    // so pairing it with this one would decide on a prompt that is about to be replaced.
    if (prompt.stateSeq !== stateSeq) return;
    if (passedPrompt.current === prompt.promptSeq || shownPrompt.current === prompt.promptSeq) return;
    passedPrompt.current = prompt.promptSeq;
    sendAction({ action: 'ok' }, prompt.promptSeq);
  }, [decision, game, prompt, stateSeq]);

  if (decision !== 'popup' || !game || !prompt) return null;
  const item = game.stack[0];
  const source = item.sourceCardId ? game.cards[item.sourceCardId] : undefined;
  const activator = game.players.find((p) => p.id === item.activatorId);
  const who = activator?.name ?? 'Opponent';
  const title = source?.zone === 'Stack' ? `${who} is casting a spell` : `${who} activated an ability`;
  const responses = respondCards(game, playable);
  const okLabel = prompt.ok?.label;
  const zoomed = zoom && zoom !== item.sourceCardId ? game.cards[zoom] : undefined;
  const hover = (id: string) => ({ onMouseEnter: () => setZoom(id), onMouseLeave: () => setZoom(null) });

  return (
    <div className="modal-backdrop popup-backdrop">
      <div className="response-popup" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <span className="popup-kicker">Your chance to respond</span>
          <h1 className="popup-title">{title}</h1>
        </header>

        <div className="popup-item">
          {source && (
            <div className="popup-source">
              <Card card={zoomed ?? source} size="hand" glow={false} selectable={false} chosen={false} upright />
              {zoomed && <span className="popup-zoom-note">Showing {zoomed.name}</span>}
            </div>
          )}
          <div className="popup-detail">
            {source?.name && <p className="popup-name">{source.name}</p>}
            <p className="popup-text">{cleanText(stackText(item.text, source))}</p>
            {item.targetIds.length > 0 && (
              <div className="popup-targets">
                <span className="popup-label">Targeting</span>
                <div className="popup-target-row">
                  {item.targetIds.map((id) => <Target key={id} id={id} game={game} hover={hover(id)} />)}
                </div>
              </div>
            )}
          </div>
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
                <div key={id} className="popup-card-slot" {...hover(id)}>
                  <Card
                    card={game.cards[id]}
                    size="stack"
                    glow
                    selectable={false}
                    chosen={false}
                    onClick={() => sendAction({ action: 'selectCard', id })}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions popup-actions">
          <span className="popup-status">
            {responses.length > 0 ? 'Pick a glowing card, or let it resolve' : 'Nothing to respond with'}
          </span>
          <button type="button" className="btn" onClick={() => sendAction({ action: 'ok' })}>
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

/** A permanent spell's stack text is just its name; then its rules text says more. */
export function stackText(text: string | null, source: CardDto | undefined): string {
  if (text == null) return source?.text ?? HIDDEN_STACK_TEXT;
  const bare = cleanText(text).trim();
  if (source?.text && (bare === '' || bare === source.name)) return source.text;
  return text;
}

function Target({ id, game, hover }: { id: string; game: GameState; hover: { onMouseEnter: () => void; onMouseLeave: () => void } }) {
  const card: CardDto | undefined = game.cards[id];
  if (card) {
    return (
      <div className="popup-card-slot" {...hover}>
        <Card card={card} size="stack" glow={false} selectable={false} chosen={false} upright />
      </div>
    );
  }
  const player = game.players.find((p) => p.id === id);
  if (player) return <span className="popup-target">{player.you ? 'You' : player.name}</span>;
  const stackItem = game.stack.find((s) => s.id === id);
  return stackItem ? <span className="popup-target">{stackItem.text ?? HIDDEN_STACK_TEXT}</span> : null;
}
