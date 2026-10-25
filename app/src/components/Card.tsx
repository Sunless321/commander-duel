import { useState, type ReactNode } from 'react';
import type { CardDto } from '../net/protocol';
import '../styles/card.css';

export interface CardProps {
  card: CardDto | undefined;
  size: 'hand' | 'field' | 'stack';
  glow: boolean;
  selectable: boolean;
  chosen: boolean;
  onClick?: () => void;
  /** Draw a tapped card straight (previews and close-up views, so nobody has to tilt their head). */
  upright?: boolean;
}

export function Card({ card, size, glow, selectable, chosen, onClick, upright }: CardProps) {
  // Tracked per url (no reset effect, which could undo a load that fired before it ran).
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const url = card?.imageUrl ?? null;

  const showBack = !card || card.hidden;
  const classes = [
    'card',
    size,
    glow && 'glow',
    selectable && 'selectable',
    chosen && 'chosen',
    card?.tapped && !upright && 'tapped',
    showBack && 'card-back',
  ]
    .filter(Boolean)
    .join(' ');

  // A clickable card is a real button, so it can be played from the keyboard too.
  const root = (children: ReactNode, name: string | null) =>
    onClick ? (
      <button type="button" className={classes} onClick={onClick} aria-label={name ?? 'Face-down card'} title={name ?? undefined}>
        {children}
      </button>
    ) : (
      <div className={classes} title={name ?? undefined}>{children}</div>
    );

  if (showBack || !card) return root(null, null);

  const pt = card.power != null && card.toughness != null ? `${card.power}/${card.toughness}` : null;
  // The text frame is always drawn, so a card is never blank while its image downloads or if it never arrives;
  // the image fades in over it once loaded.
  return root(
    <>
      <span className="card-text">
        <span className="card-text-head">
          <span className="card-name">{card.name ?? 'Unknown card'}</span>
          {card.manaCost && <span className="card-cost">{card.manaCost}</span>}
        </span>
        <span className="card-type">{card.typeLine}</span>
        {pt && <span className="card-pt">{pt}</span>}
      </span>
      {url && brokenUrl !== url && (
        <img
          key={url}
          className={loadedUrl === url ? 'loaded' : undefined}
          src={'card://img?u=' + encodeURIComponent(url)}
          alt=""
          draggable={false}
          onLoad={() => setLoadedUrl(url)}
          onError={() => setBrokenUrl(url)}
        />
      )}
    </>,
    card.name,
  );
}
