import { expect, test } from 'vitest';
import type { CardDto, GameState, PlayerDto } from '../net/protocol';
import { incoming } from './incoming';

const card = (id: string, ownerId: string, over: Partial<CardDto> = {}): CardDto => ({
  id, name: `Card ${id}`, ownerId, controllerId: ownerId, zone: 'Battlefield', tapped: false, sick: false, hidden: false,
  imageUrl: null, manaCost: null, typeLine: 'Creature', text: null, power: '2', toughness: '2', damage: 0,
  counters: {}, attachedToId: null, commander: false, ...over,
});

const player = (id: string, name: string, you: boolean, over: Partial<PlayerDto> = {}): PlayerDto => ({
  id, name, you, life: 40, poison: 0, commanderDamage: {}, manaPool: {}, hand: [], handCount: 0, libraryCount: 90,
  graveyard: [], exile: [], command: [], battlefield: [], visibleLibrary: [], visibleHand: [], ...over,
});

function game(edit: (g: GameState) => void = () => {}): GameState {
  const g: GameState = {
    turn: 4, phase: 'COMBAT_DECLARE_BLOCKERS', activePlayerId: 'p2', priorityPlayerId: 'p1', youId: 'p1',
    players: [
      player('p1', 'You', true, { battlefield: ['c1', 'c9'] }),
      player('p2', 'Bot 1', false, { battlefield: ['c2', 'c3', 'c4'] }),
      player('p3', 'Bot 2', false, { battlefield: ['c5'] }),
    ],
    cards: {
      c1: card('c1', 'p1'),
      c9: card('c9', 'p1', { name: 'Your Walker', typeLine: 'Legendary Planeswalker', power: null, toughness: null }),
      c2: card('c2', 'p2', { name: 'Bear', power: '2' }),
      c3: card('c3', 'p2', { name: 'Giant', power: '5' }),
      c4: card('c4', 'p2', { name: 'Commander', power: '4', commander: true }),
      c5: card('c5', 'p3', { name: 'Elsewhere', power: '6' }),
    },
    stack: [],
    combat: [],
  };
  edit(g);
  return g;
}

test('nothing incoming on a quiet board', () => {
  expect(incoming(game())).toEqual({ attackers: [], unblockedDamage: 0, threats: [] });
});

test('sums unblocked attackers at you; blocked ones, ones at your planeswalker and attacks on others do not count', () => {
  const r = incoming(game((g) => {
    g.combat = [
      { attackerId: 'c2', defenderId: 'p1', blockerIds: [] },
      { attackerId: 'c3', defenderId: 'p1', blockerIds: ['c1'] },
      { attackerId: 'c4', defenderId: 'c9', blockerIds: [] },
      { attackerId: 'c5', defenderId: 'p2', blockerIds: [] },
    ];
  }));
  expect(r.unblockedDamage).toBe(2);
  expect(r.attackers.map((a) => [a.name, a.blocked, a.atPermanentId, a.commander])).toEqual([
    ['Bear', false, null, false],
    ['Giant', true, null, false],
    ['Commander', false, 'c9', true],
  ]);
  expect(r.attackers[0].controllerName).toBe('Bot 1');
});

test("an attacker with non-numeric power adds nothing and doesn't break the sum", () => {
  const r = incoming(game((g) => {
    g.cards.c2.power = '*';
    g.combat = [{ attackerId: 'c2', defenderId: 'p1', blockerIds: [] }, { attackerId: 'c3', defenderId: 'p1', blockerIds: [] }];
  }));
  expect(r.unblockedDamage).toBe(5);
  expect(r.attackers[0].power).toBeNull();
});

test("opponents' stack items targeting you or your permanents are threats; yours and others' are not", () => {
  const r = incoming(game((g) => {
    g.cards.c20 = card('c20', 'p2', { name: 'Lightning Bolt', zone: 'Stack', typeLine: 'Instant' });
    g.cards.c21 = card('c21', 'p3', { name: 'Murder', zone: 'Stack', typeLine: 'Instant' });
    g.cards.c22 = card('c22', 'p1', { name: 'My Shock', zone: 'Stack', typeLine: 'Instant' });
    g.cards.c23 = card('c23', 'p3', { name: 'Their Fight', zone: 'Stack', typeLine: 'Sorcery' });
    g.stack = [
      { id: 's1', text: 'Lightning Bolt deals 3 damage to any target.', sourceCardId: 'c20', activatorId: 'p2', targetIds: ['p1'] },
      { id: 's2', text: 'Destroy target creature.', sourceCardId: 'c21', activatorId: 'p3', targetIds: ['c1'] },
      { id: 's3', text: 'Shock', sourceCardId: 'c22', activatorId: 'p1', targetIds: ['p1'] },
      { id: 's4', text: 'Fight', sourceCardId: 'c23', activatorId: 'p3', targetIds: ['c2'] },
    ];
  }));
  expect(r.threats).toEqual([
    { id: 's1', name: 'Lightning Bolt', who: 'Bot 1', text: 'Lightning Bolt deals 3 damage to any target.', targetsYou: true, targetCardIds: [] },
    { id: 's2', name: 'Murder', who: 'Bot 2', text: 'Destroy target creature.', targetsYou: false, targetCardIds: ['c1'] },
  ]);
});
