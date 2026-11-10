// Counted scoring (spec-counted-scoring.md; first stage 0b's): the per-game measures of scripts/score-ceiling-measure.ts, summed for the
// batch summary (corp-losses-sum.mjs prints this last, only for a batch whose games carry them).
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) : '-');
const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

export function printStage0b(games) {
  const measured = games.filter(g => g.stage0b && !g.stage0b.error);
  if (!measured.length) return;
  const errors = games.filter(g => g.stage0b?.error).length;
  const m = measured.map(g => g.stage0b);
  console.log(`\nCounted scoring measures (${measured.length} games; replay errors ${errors}; replays cut short ${m.filter(x => !x.replayed).length}):`);
  const turns = m.reduce((a, x) => a + x.corpTurns, 0);
  const shapes = ['score', 'kill', 'build', 'shore', 'money', 'mixed'];
  console.log(`  turn labels (% of ${turns} Corp turns): ${shapes.map(k => `${k} ${pct(m.reduce((a, x) => a + (x.labels[k] ?? 0), 0), turns)}`).join(', ')}`);
  const firsts = m.map(x => x.firstScore).filter(x => x !== null);
  console.log(`  first score: median Corp turn ${median(firsts)}, mean ${(firsts.reduce((a, b) => a + b, 0) / (firsts.length || 1)).toFixed(2)} (${firsts.length} games scored)`);
  const steals = {};
  for (const g of measured) for (const s of g.steals ?? []) steals[s.from] = (steals[s.from] ?? 0) + s.points;
  console.log(`  points stolen a game by server: ${Object.entries(steals).sort().map(([k, v]) => `${k} ${(v / measured.length).toFixed(2)}`).join(', ')}`);
  const sum = k => m.reduce((a, x) => a + x[k], 0);
  const two = k => m.reduce((a, x) => a + (x.two?.[k] ?? 0), 0) / m.length;
  console.log(`  per game: score-now found ${(sum('nowFound') / m.length).toFixed(2)}; two-turn lines begun ${two('begun').toFixed(2)}, steps over the Corp's pick ${two('steps').toFixed(2)}, spare clicks vetoed ${two('vetoed').toFixed(2)}, dropped ${two('dropped').toFixed(2)}, finished ${two('finished').toFixed(2)}`);
  const lines = m.flatMap(x => x.lines);
  if (lines.length) {
    const count = (k, v) => lines.filter(l => l[k] === v).length;
    console.log(`  two-turn lines: ${lines.length} (${(lines.length / m.length).toFixed(2)} a game; forms installed ${count('form', 'installed')}, install ${count('form', 'install')}, install+ice ${count('form', 'install+ice')})`);
    console.log(`    agenda: scored next turn ${count('end', 'scoredNext')}, scored later ${count('end', 'scoredLater')}, stolen ${count('end', 'stolen')}, trashed ${count('end', 'trashed')}, other ${count('end', 'other')}`);
  }
}
