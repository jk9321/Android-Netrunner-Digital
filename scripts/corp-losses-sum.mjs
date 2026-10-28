// Prints the Corp loss breakdown from scripts/corp-losses.ts shards (see corp-losses.sh).
import { readFileSync } from 'node:fs';
import { printLossSummary } from './loss-summary.mjs';

const games = process.argv.slice(2).flatMap(f => {
  const lines = readFileSync(f, 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
});
printLossSummary(games);

// Win rate for each deck, for the batch log
for (const side of ['corp', 'runner']) {
  const by = new Map();
  for (const g of games) {
    const d = by.get(g[`${side}Deck`]) ?? { n: 0, w: 0 };
    d.n++;
    if (g.winner === side) d.w++;
    by.set(g[`${side}Deck`], d);
  }
  console.log(`${side === 'corp' ? 'Corp' : 'Runner'} decks (win %):`);
  for (const [name, d] of [...by].sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n)) console.log(`  ${name}: ${((100 * d.w) / d.n).toFixed(1)}% of ${d.n}`);
}
