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

// Identities (Jeff, 2026-10-29): how often each uses its ability, per game, and its win rate
if (games[0]?.identity) {
  console.log('Identities (per game: prompts taken/offered by step, abilities used, log lines naming it; win %):');
  for (const side of ['corp', 'runner']) {
    const by = new Map();
    for (const g of games) {
      const u = g.identity[side];
      const d = by.get(u.title) ?? { n: 0, w: 0, turns: 0, abilities: 0, logs: 0, faceUp: 0, prompts: {} };
      d.n++;
      if (g.winner === side) d.w++;
      d.turns += u.turns;
      d.abilities += u.abilities;
      d.logs += u.logs;
      d.faceUp += u.faceUpAgendas ?? 0;
      for (const [step, p] of Object.entries(u.prompts)) {
        const q = (d.prompts[step] ??= { offered: 0, taken: 0 });
        q.offered += p.offered;
        q.taken += p.taken;
      }
      by.set(u.title, d);
    }
    for (const [title, d] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
      const per = x => (x / d.n).toFixed(2);
      const prompts = Object.entries(d.prompts).map(([step, p]) => `${step} ${per(p.taken)}/${per(p.offered)}`).join(', ');
      console.log(`  ${side} ${title}: ${((100 * d.w) / d.n).toFixed(1)}% of ${d.n}; own turns ${per(d.turns)}; abilities ${per(d.abilities)}; logs ${per(d.logs)}${prompts ? `; prompts ${prompts}` : ''}${d.faceUp ? `; agendas faceup ${per(d.faceUp)}` : ''}`);
    }
  }
}

// BANGUN's faceup agendas (Jeff, 2026-10-29): by ice on the server when installed, what became of them
const faceUp = games.flatMap(g => (g.identity?.corp.faceUp ?? []).map(f => ({ ...f, flatline: g.reason === 'flatline' && g.winner === 'corp', won: g.winner === 'corp' })));
if (faceUp.length) {
  console.log('BANGUN faceup agendas (by ice when installed: stolen / scored / still out / gone; games won by flatline, won):');
  for (const [label, test] of [['no ice', f => f.ice === 0], ['1 ice', f => f.ice === 1], ['2+ ice', f => f.ice >= 2], ['no ice, grip <= 2', f => f.ice === 0 && f.grip <= 2], ['no ice, tag punisher held', f => f.ice === 0 && f.punishers > 0]]) {
    const set = faceUp.filter(test);
    if (!set.length) continue;
    const pc = k => ((100 * set.filter(f => f.outcome === k).length) / set.length).toFixed(0);
    const pg = fn => ((100 * set.filter(fn).length) / set.length).toFixed(0);
    console.log(`  ${label}: ${set.length}; stolen ${pc('stolen')}%, scored ${pc('scored')}%, out ${pc('out')}%, gone ${pc('gone')}%; flatline wins ${pg(f => f.flatline)}%, wins ${pg(f => f.won)}%`);
  }
}

// The two weakest Corp decks on their own (Jeff, 2026-10-29: weakest decks first)
const corpRates = new Map();
for (const g of games) {
  const d = corpRates.get(g.corpDeck) ?? { n: 0, w: 0 };
  d.n++;
  if (g.winner === 'corp') d.w++;
  corpRates.set(g.corpDeck, d);
}
for (const [name] of [...corpRates].sort((a, b) => a[1].w / a[1].n - b[1].w / b[1].n).slice(0, 2)) {
  console.log(`\n=== Weak Corp deck: ${name} ===`);
  printLossSummary(games.filter(g => g.corpDeck === name));
}
