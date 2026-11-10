// Prints the Corp loss breakdown from scripts/corp-losses.ts shards (see corp-losses.sh).
//   node scripts/corp-losses-sum.mjs out/*.json [--base base/*.json]
// --base: another batch on the same deals (say the switch off); prints the paired per-deal
// difference first (paired-summary.mjs). The base can be shard files or a saved deals file.
// DEALS_OUT=file saves this batch's per-deal results (seed, decks, winner, alarm kinds) for later pairing.
import { writeFileSync } from 'node:fs';
import { printLossSummary } from './loss-summary.mjs';
import { printOpeningAudit, printValueAudit } from './opening-summary.mjs';
import { printSearchAudit } from './search-audit-sum.mjs';
import { printPaired, readGames, splitArgs } from './paired-summary.mjs';
import { printStage0b } from './stage0b-sum.mjs';

const { files, base } = splitArgs(process.argv.slice(2));
const games = readGames(files);
if (process.env.DEALS_OUT) {
  const deals = games.map(g => ({ seed: g.seed, corpDeck: g.corpDeck, runnerDeck: g.runnerDeck, winner: g.winner, ...(g.crashed ? { crashed: true } : {}), ...(g.oracleIceSkipped ? { oracleIceSkipped: true } : {}), ...(g.alarms?.length ? { alarms: g.alarms.map(a => ({ kind: a.kind })) } : {}) }));
  writeFileSync(process.env.DEALS_OUT, JSON.stringify(deals) + '\n');
}
if (base.length) {
  printPaired(games, readGames(base));
  console.log('');
}
printLossSummary(games);
// ORACLE_ICE batches: deals whose R&D held no ice played without the free ice, so the arm is a lower bound
const iced = games.filter(g => g.oracleIce);
if (iced.length) console.log(`ORACLE_ICE ${iced[0].oracleIce}: skipped (no ice in R&D): ${iced.filter(g => g.oracleIceSkipped).length} of ${iced.length}`);

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

// Phase 2 O: the opening audit and the card value audit (scripts/opening-audit.ts), last so the batch log's fields stay put
if (games.some(g => g.opening)) {
  printOpeningAudit(games);
  printValueAudit(games);
}

// Spec-search S1: the Corp planner's continuations (batch token +audit.search), after the opening audit
printSearchAudit(games);

// Corp redesign stage 0b (spec-stage0b.md): turn labels, first score, steals by server, the instruments' counts
printStage0b(games);
