// Sums scripts/money-goals.ts output: node scripts/money-goals-sum.mjs goals*.jsonl
import { readFileSync } from 'node:fs';

const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
for (const who of ['jeff', 'ai']) {
  const R = rows.filter(r => r.who === who);
  const turns = R.flatMap(r => r.turns.filter(Boolean));
  const dist = [0, 0, 0, 0, 0];
  const pairs = {};
  const clicks = {};
  for (const t of turns) {
    const g = Object.keys(t.goals);
    dist[Math.min(4, g.length)]++;
    for (const [k, v] of Object.entries(t.goals)) clicks[k] = (clicks[k] ?? 0) + v;
    const s = [...g].sort();
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) pairs[`${s[i]}+${s[j]}`] = (pairs[`${s[i]}+${s[j]}`] ?? 0) + 1;
  }
  const n = turns.length;
  console.log(`== ${who}: ${R.length} games, ${n} Corp turns (T1-10)`);
  console.log(`  distinct goals per turn: 1 ${f((100 * dist[1]) / n, 0)}%, 2 ${f((100 * dist[2]) / n, 0)}%, 3+ ${f((100 * (dist[3] + dist[4])) / n, 0)}%; mean ${f(turns.reduce((a, t) => a + Object.keys(t.goals).length, 0) / n)}`);
  console.log(`  clicks per turn by goal: ${Object.entries(clicks).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f(v / n)}`).join(', ')}`);
  console.log(`  most common pairs (share of turns): ${Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${f((100 * v) / n, 0)}%`).join(', ')}`);
  const b = R.filter(r => r.broke).map(r => r.broke);
  if (b.length) {
    const sum = k => b.reduce((a, x) => a + x[k], 0);
    console.log(`  counted rule took a click inside a planner pair line (install + ice on that server): per game ${f(sum('pairLines') / b.length)} pair-line decisions; money ${f(sum('money') / b.length)}, ice redirect ${f(sum('redirect') / b.length)}, score line ${f(sum('score') / b.length)} (of ${f(sum('decisions') / b.length)} main decisions)`);
  }
}
