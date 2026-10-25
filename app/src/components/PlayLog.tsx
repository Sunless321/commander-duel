import { useEffect, useRef, useState } from 'react';
import { cleanText } from '../logic/cleanText';
import type { LogEntry } from '../net/protocol';
import { useStore } from '../state/store';

const OPEN_KEY = 'commanderDuel.logOpen';

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

/** CSS class for a line: damage and life loss stand out, and so does anything that names you. */
export function logLineClass(e: LogEntry): string {
  const k = e.kind.toLowerCase().replace(/_/g, '-');
  const you = /\bYou\b/.test(e.text) ? ' you' : '';
  return `log-line log-${k}${you}`;
}

/**
 * The match's moves as the engine logs them, newest at the bottom. It lives only in memory for this match
 * (the store clears it when the game ends); nothing is written to disk.
 */
export function PlayLog() {
  const log = useStore((s) => s.log);
  const [open, setOpen] = useState(loadOpen);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log, open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
  };

  return (
    <section className={`play-log${open ? ' open' : ''}`} aria-label="Game log">
      <button type="button" className="play-log-head" aria-expanded={open} onClick={toggle}>
        <span className="col-title">Log</span>
        <span className="play-log-count">{log.length}</span>
        <span className="play-log-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ol
          ref={list}
          className="play-log-list"
          onScroll={(e) => {
            const el = e.currentTarget;
            // Follow new lines only while you are at the bottom; scrolling up to read holds the view.
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {log.length === 0 && <li className="log-line log-empty">Moves will show up here.</li>}
          {log.map((e, i) => (
            <li key={i} className={logLineClass(e)}>{cleanText(e.text)}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
