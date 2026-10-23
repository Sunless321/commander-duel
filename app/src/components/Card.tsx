import { useEffect, useState, type ReactNode } from 'react';
import type { CardDto } from '../net/protocol';
import '../styles/card.css';

export interface CardProps {
  card: CardDto | undefined;
  size: 'hand' | 'field' | 'stack';
  glow: boolean;
  selectable: boolean;
  chosen: boolean;
  onClick?: () => void;
}

export function Card({ card, size, glow, selectable, chosen, onClick }: CardProps) {
  const [broken, setBroken] = useState(false);
  const url = card?.imageUrl ?? null;
  useEffect(() => setBroken(false), [url]);

  const showBack = !card || card.hidden;
  const classes = [
    'card',
    size,
    glow && 'glow',
    selectable && 'selectable',
    chosen && 'chosen',
    card?.tapped && 'tapped',
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
  return root(
    url && !broken ? (
      <img
        src={'card://img?u=' + encodeURIComponent(url)}
        alt={card.name ?? ''}
        draggable={false}
        onError={() => setBroken(true)}
      />
    ) : (
      <span className="card-text">
        <span className="card-text-head">
          <span className="card-name">{card.name}</span>
          {card.manaCost && <span className="card-cost">{card.manaCost}</span>}
        </span>
        <span className="card-type">{card.typeLine}</span>
        {pt && <span className="card-pt">{pt}</span>}
      </span>
    ),
    card.name,
  );
}
