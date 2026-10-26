import type { GameState } from '../net/protocol';

export interface IncomingAttacker {
  id: string;
  name: string;
  /** Printed power as the engine reports it (may be "*" or missing for odd cards). */
  power: number | null;
  blocked: boolean;
  /** Attacking one of your planeswalkers or battles rather than you. */
  atPermanentId: string | null;
  commander: boolean;
  controllerName: string | null;
}

export interface IncomingThreat {
  id: string;
  name: string;
  who: string;
  text: string | null;
  /** The stack item targets you directly (otherwise one of your permanents). */
  targetsYou: boolean;
  targetCardIds: string[];
}

export interface Incoming {
  attackers: IncomingAttacker[];
  /** Combat damage the unblocked attackers would deal to you, at their current power. */
  unblockedDamage: number;
  threats: IncomingThreat[];
}

const toNumber = (s: string | null): number | null => {
  if (s == null) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * What is about to hit you, read only from the state the engine sent: opponents' creatures attacking you
 * (or your planeswalkers), and opponents' spells and abilities on the stack that target you or your permanents.
 * It is a heads-up, not a rules calculation: trample, prevention and pump spells can change the real numbers.
 */
export function incoming(game: GameState): Incoming {
  const you = game.youId;
  const me = game.players.find((p) => p.id === you);
  const mine = new Set(me?.battlefield ?? []);
  const names = new Map(game.players.map((p) => [p.id, p.name]));

  const attackers: IncomingAttacker[] = [];
  for (const a of game.combat) {
    const atYou = a.defenderId === you;
    const atMine = a.defenderId != null && mine.has(a.defenderId);
    if (!atYou && !atMine) continue;
    const card = game.cards[a.attackerId];
    attackers.push({
      id: a.attackerId,
      name: card?.name ?? 'A creature',
      power: toNumber(card?.power ?? null),
      blocked: a.blockerIds.length > 0,
      atPermanentId: atYou ? null : a.defenderId,
      commander: !!card?.commander,
      controllerName: card ? names.get(card.controllerId) ?? null : null,
    });
  }
  const unblockedDamage = attackers
    .filter((a) => !a.blocked && a.atPermanentId == null)
    .reduce((sum, a) => sum + Math.max(0, a.power ?? 0), 0);

  const threats: IncomingThreat[] = [];
  for (const item of game.stack) {
    if (item.activatorId === you) continue;
    const targetsYou = item.targetIds.includes(you);
    const targetCardIds = item.targetIds.filter((id) => mine.has(id));
    if (!targetsYou && targetCardIds.length === 0) continue;
    const source = item.sourceCardId ? game.cards[item.sourceCardId] : undefined;
    threats.push({
      id: item.id,
      name: source?.name ?? 'A spell',
      who: (item.activatorId && names.get(item.activatorId)) || 'An opponent',
      text: item.text,
      targetsYou,
      targetCardIds,
    });
  }
  return { attackers, unblockedDamage, threats };
}
