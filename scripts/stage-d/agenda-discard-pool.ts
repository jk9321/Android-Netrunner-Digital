/**
 * Stage D item 7, Q2: the Corp cards of the batch's deck pool (scripts/nsg-sample-decks.ts ALL_DECKS, the decks the g1
 * base plays) whose text reads Archives or takes cards from HQ, with the decks that hold them. Reads card data only.
 *   npx vite-node scripts/stage-d/agenda-discard-pool.ts
 */
import { ALL_CARDS } from '../../src/core/cards';
import { ALL_DECKS } from '../nsg-sample-decks';

const re = /Archives|from HQ|in HQ|discard phase|hand size/i;
const hits = new Map<string, { title: string; type: string; text: string; decks: string[] }>();
for (const d of ALL_DECKS.filter(x => x.side === 'corp')) {
  const codes = [d.identity, ...Object.keys(d.cards ?? {})] as string[]; // titles
  for (const code of codes) {
    const def = (ALL_CARDS as { title: string; type_code: string; stripped_text?: string; side_code: string }[]).find(c => c.title === code);
    const text = def?.stripped_text ?? '';
    if (!def || !re.test(text)) continue;
    const h = hits.get(code) ?? { title: def.title, type: def.type_code, text, decks: [] };
    h.decks.push(d.name);
    hits.set(code, h);
  }
}
for (const [code, h] of [...hits].sort((a, b) => b[1].decks.length - a[1].decks.length)) console.log(JSON.stringify({ code, ...h }));
