import { useEffect, useState } from 'react';
import type { PromptButton } from '../net/protocol';
import { useStore } from '../state/store';

const REJECTION_TOAST_MS = 3000;

/** The engine's prompt and its two buttons, exactly as labeled and enabled by the engine, plus toasts. */
export function PromptBar({ onOk, onCancel }: { onOk: () => void; onCancel: () => void }) {
  const prompt = useStore((s) => s.prompt);
  const rejection = useStore((s) => s.lastRejection);
  const info = useStore((s) => s.lastInfo);
  const error = useStore((s) => s.lastError);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!rejection) return;
    setToast(rejection.reason);
    const t = setTimeout(() => setToast(null), REJECTION_TOAST_MS);
    return () => clearTimeout(t);
  }, [rejection]);

  const button = (b: PromptButton | null, kind: 'ok' | 'cancel', onClick: () => void) =>
    b && (
      <button type="button" className={`prompt-btn ${kind}`} disabled={!b.enabled} onClick={onClick}>
        {b.label}
      </button>
    );

  return (
    <section className="prompt-bar" aria-label="Prompt">
      {info && (
        <div className="toast info" role="status">
          {info.title && <strong>{info.title}</strong>}
          <span>{info.message}</span>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => useStore.getState().dismissInfo()}>✕</button>
        </div>
      )}
      {error && (
        <div className="toast error" role="status">
          <span>{error}</span>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => useStore.getState().dismissError()}>✕</button>
        </div>
      )}
      {toast && <div className="toast rejected" role="status">{toast}</div>}
      <p className={`prompt-message${prompt?.inputKind === 'wait' ? ' waiting' : ''}`}>{prompt?.message || 'Waiting for the engine…'}</p>
      {button(prompt?.ok ?? null, 'ok', onOk)}
      {button(prompt?.cancel ?? null, 'cancel', onCancel)}
    </section>
  );
}
