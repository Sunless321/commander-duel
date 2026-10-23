import { useState } from 'react';

/** Concede with an in-page confirmation step. */
export function ConcedeButton({ onConcede }: { onConcede: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return <button type="button" className="btn concede" onClick={() => setAsking(true)}>Concede</button>;
  }
  return (
    <div className="concede-confirm" role="group" aria-label="Confirm concede">
      <span>Concede this game?</span>
      <button type="button" className="btn primary" onClick={() => { setAsking(false); onConcede(); }}>Yes</button>
      <button type="button" className="btn" onClick={() => setAsking(false)}>No</button>
    </div>
  );
}
