// Sums scripts/deck-outs.ts output (JSON lines): decked games against the rest.
//   node scripts/deck-outs-sum.mjs out/*.json
import { readFileSync } from 'node:fs';

const games = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const decked = games.filter(g => /decked/.test(g.reason ?? ''));
const rest = games.filter(g => !/decked/.test(g.reason ?? ''));
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '0.0') + '%';
const mean = (xs, f) => (xs.length ? (xs.reduce((n, x) => n + f(x), 0) / xs.length).toFixed(2) : '-');
console.log(`${games.length} games, Corp decked in ${decked.length} (${pct(decked.length, games.length)})`);

const by = (key, label) => {
  const m = new Map();
  for (const g of games) {
    const k = key(g);
    const e = m.get(k) ?? { n: 0, d: 0 };
    e.n++;
    if (/decked/.test(g.reason ?? '')) e.d++;
    m.set(k, e);
  }
  console.log(`\nDecked by ${label}:`);
  for (const [k, e] of [...m].sort((a, b) => b[1].d - a[1].d)) if (e.d) console.log(`  ${k}: ${e.d} of ${e.n} (${pct(e.d, e.n)})`);
};
by(g => `${g.corpDeck} (${g.deckSize} cards)`, 'Corp deck');
by(g => g.runnerDeck, 'Runner deck');

const rows = [
  ['Corp turns', g => g.corp.turns],
  ['Corp click draws a game', g => g.corp.draws],
  ['  share of Corp clicks', g => g.corp.draws / Math.max(1, g.corp.clicks)],
  ['Corp click draws with R&D at 10 or less', g => g.corp.lateDraws],
  ['Corp credit clicks a game', g => g.corp.credits],
  ['Corp turns started with an agenda in HQ', g => g.corp.agendaTurns],
  ['  share of Corp turns', g => g.corp.agendaTurns / Math.max(1, g.corp.turns)],
  ['most agendas in HQ at once', g => g.corp.maxHqAgendas],
  ['agendas in HQ at the end', g => g.corp.endHqAgendas],
  ['agendas installed at the end', g => g.corp.endInstalledAgendas],
  ['Corp credits at the end', g => g.corp.endCredits],
  ['Corp last 3 turns: draws', g => g.corp.last3.draws],
  ['Corp last 3 turns: credit clicks', g => g.corp.last3.credits],
  ['Corp last 3 turns: advances', g => g.corp.last3.advance],
  ['Corp last 3 turns: installs', g => g.corp.last3.install],
  ['Corp score', g => g.corpScore],
  ['Runner score', g => g.runnerScore],
  ['Runner runs a turn', g => g.runner.runs / Math.max(1, g.runner.turns)],
  ['Runner last 3 turns: runs', g => g.runner.last3.runs],
  ['Runner last 3 turns: credit clicks', g => g.runner.last3.credits],
  ['Runner last 3 turns: draws', g => g.runner.last3.draws],
  ['Runner credits at the end', g => g.runner.endCredits],
  ['Runner Stack empty at the end', g => (g.runner.endStack === 0 ? 1 : 0)],
  ['Runner grip at the end', g => g.runner.endGrip],
];
console.log(`\n${'(means)'.padEnd(44)}${'decked'.padStart(8)}${'other'.padStart(8)}`);
for (const [label, f] of rows) console.log(`  ${label.padEnd(42)}${mean(decked, f).padStart(8)}${mean(rest, f).padStart(8)}`);
// Same-length games only: how a decked game differs from a long game the Corp didn't deck in
const long = rest.filter(g => g.turns >= Math.min(...decked.map(d => d.turns)));
console.log(`\nOther games at least as long as the shortest decked one (${long.length}):`);
for (const [label, f] of rows) console.log(`  ${label.padEnd(42)}${mean(long, f).padStart(8)}`);
console.log('\nDecked deals (seed turns score C-R, HQ agendas at end, Runner last-3 runs / credit clicks / bank):');
for (const g of decked.slice(0, 80))
  console.log(`  ${g.seed} T${g.turns} ${g.corpScore}-${g.runnerScore} hq${g.corp.endHqAgendas} runs${g.runner.last3.runs} cc${g.runner.last3.credits} bank ${g.runner.last3.bank.join('/')} stack${g.runner.endStack} | ${g.corpDeck} vs ${g.runnerDeck}`);
