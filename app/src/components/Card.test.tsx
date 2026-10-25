import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { CardDto } from '../net/protocol';
import { Card } from './Card';

const base: CardDto = {
  id: 'c1', name: 'Sol Ring', ownerId: 'p1', controllerId: 'p1', zone: 'Battlefield', tapped: false, sick: false,
  hidden: false, imageUrl: 'https://api.scryfall.com/cards/named?exact=Sol+Ring&format=image', manaCost: '{1}',
  typeLine: 'Artifact', text: null, power: null, toughness: null, damage: 0, counters: {}, attachedToId: null,
  commander: false,
};
const html = (card: CardDto | undefined, extra: Partial<Parameters<typeof Card>[0]> = {}) =>
  renderToStaticMarkup(<Card card={card} size="field" glow={false} selectable={false} chosen={false} {...extra} />);

test('Card hidden renders back, no name', () => {
  const out = html({ ...base, hidden: true, name: null, imageUrl: null });
  expect(out).toContain('card-back');
  expect(out).not.toContain('Sol Ring');
  expect(html(undefined)).toContain('card-back');
});

test('Card glow adds class', () => {
  expect(html(base, { glow: true })).toMatch(/class="[^"]*\bglow\b/);
  expect(html(base)).not.toMatch(/\bglow\b/);
});

test('Card selectable, chosen, tapped classes and size', () => {
  const out = html(base, { selectable: true, chosen: true, size: 'hand' });
  expect(out).toMatch(/\bselectable\b/);
  expect(out).toMatch(/\bchosen\b/);
  expect(out).toMatch(/\bhand\b/);
  expect(html({ ...base, tapped: true })).toMatch(/\btapped\b/);
});

test('a card with an image still draws its text frame underneath, so it is never blank while loading', () => {
  const out = html(base);
  expect(out).toContain('card-text');
  expect(out).toContain('Sol Ring');
  // not shown until it has loaded
  expect(out).not.toMatch(/<img[^>]*class="loaded"/);
});

test('upright draws a tapped card straight', () => {
  expect(html({ ...base, tapped: true }, { upright: true })).not.toMatch(/\btapped\b/);
});

test('Card with image uses card:// url; without image shows text frame', () => {
  expect(html(base)).toContain('src="card://img?u=' + encodeURIComponent(base.imageUrl!).replace(/&/g, '&amp;'));
  const out = html({ ...base, imageUrl: null, name: 'Grizzly Bears', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: '2', toughness: '2' });
  expect(out).toContain('Grizzly Bears');
  expect(out).toContain('{1}{G}');
  expect(out).toContain('Creature — Bear');
  expect(out).toContain('2/2');
  expect(out).not.toContain('<img');
});
