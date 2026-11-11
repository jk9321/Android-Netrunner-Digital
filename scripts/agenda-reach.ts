/**
 * Step 4 G1 check (spec-step4-placement.md): agendas in the batch decks whose advancement requirement a two-turn line
 * from HQ does not reach. scoreInTwo: install + up to 2 advances this turn (3 clicks), the rest next turn (at most 3
 * clicks, 5.2.6f) and scored (1.17.3a): 5 from an install into an iced remote, 4 with an ice installed in front.
 *
 *   npx vite-node scripts/agenda-reach.ts
 */
import { findCardByTitle } from '../src/data/deckImport';
import { ALL_DECKS } from './nsg-sample-decks';

const seen = new Map<string, { cost: number; decks: number }>();
for (const d of ALL_DECKS.filter(x => x.side === 'corp'))
  for (const title of Object.keys(d.cards)) {
    const def = findCardByTitle(title);
    if (def?.type_code !== 'agenda') continue;
    const e = seen.get(def.title) ?? { cost: def.advancement_cost ?? 0, decks: 0 };
    e.decks++;
    seen.set(def.title, e);
  }
const rows = [...seen.entries()].sort((a, b) => b[1].cost - a[1].cost);
for (const [title, e] of rows.filter(([, e]) => e.cost >= 5)) console.log(`${title}: ${e.cost} to advance, in ${e.decks} deck(s): ${e.cost > 5 ? 'no two-turn line' : 'only into a remote already iced'}`);
console.log(`${rows.length} agenda titles; ${rows.filter(([, e]) => e.cost > 5).length} need more than two turns`);
