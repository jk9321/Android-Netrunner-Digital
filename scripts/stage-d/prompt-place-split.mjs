// Item 6 step 1, design-answer.md section 2 point 2: the changed top-level install-prompt decisions split by what
// changed and by prompt kind, with continuation counts, self-play and human apart.
//   node scripts/stage-d/prompt-place-split.mjs <all.jsonl or dirs...>        (arms read from the lines)
// Better/worse: the continuation (4 turns or game end, GameRunner, the arm's Corp or base Corp against the base Runner)
// is valued Corp win 100, Runner win -100, else (Corp points gained - Runner points gained); arm vs base on that value.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => walk(join(p, f))) : /\.(txt|jsonl)$/.test(p) ? [p] : []);
const L = process.argv.slice(2).flatMap(walk).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
const inv = JSON.parse(readFileSync(new URL('./prompt-place-inventory.json', import.meta.url), 'utf8'));
const stepOf = new Map(inv.cards.flatMap(c => c.steps.map(s => [`${c.code}:${s.step}`, { ...s, from: c.from, title: c.title }])));
const TURN_END = new Set(['35045', '35038', '35071']); // Mercia (action_phase_ends); Ingatan, Off the Books (discard_phase_ends)
const kindOf = r => {
  if (r.inRun) return 'in a run';
  const code = r.key.split(':')[0];
  if (TURN_END.has(code)) return "at the turn's end";
  const s = stepOf.get(r.key);
  if (s?.opts?.ignoreCosts) return 'free of all costs';
  return s?.opts?.discount ? 'click free, cost discounted' : 'free of the click only (costs paid)';
};
const IP = L.filter(l => l.kind === 'ip');
const cont = new Map();
for (const c of L.filter(l => l.kind === 'cont')) (cont.get(`${c.src}#${c.i}`) ?? cont.set(`${c.src}#${c.i}`, {}).get(`${c.src}#${c.i}`))[c.arm] = c;
const val = c => (!c || c.error ? null : c.winner === 'corp' ? 100 : c.winner === 'runner' ? -100 : c.d[0] - c.d[1]);
const isDecline = p => p === 'decline' || /^option to-hand/.test(p ?? '');
const what = (b, a) => (isDecline(b) && !isDecline(a) ? 'today declines, arm installs' : !isDecline(b) && isDecline(a) ? 'today installs, arm declines' : 'both install (another card or server)');
const who = r => (r.src.startsWith('deal:') ? 'self' : 'human');
const arms = [...new Set(IP.flatMap(r => Object.keys(r.picks)))].filter(a => a !== 'base');
for (const a of arms) {
  const ch = IP.filter(r => r.picks[a] !== undefined && r.picks[a] !== r.picks.base);
  console.log(`\n### ${a}: ${ch.length} changed top-level install-prompt decisions`);
  for (const [title, by] of [['by what changed', r => what(r.picks.base, r.picks[a])], ['by prompt kind', kindOf], ['by kind and what changed', r => `${kindOf(r)} / ${what(r.picks.base, r.picks[a])}`]]) {
    console.log(`${title}:`);
    const rows = {};
    for (const r of ch) {
      const k = by(r);
      const row = (rows[k] ??= { self: { n: 0, b: 0, w: 0, s: 0, nc: 0 }, human: { n: 0, b: 0, w: 0, s: 0, nc: 0 }, keys: {} });
      const g = row[who(r)];
      g.n++;
      row.keys[r.key] = (row.keys[r.key] ?? 0) + 1;
      const c = cont.get(`${r.src}#${r.i}`) ?? {};
      const vb = val(c.base), va = val(c[a]);
      if (vb === null || va === null) g.nc++;
      else if (va > vb) g.b++;
      else if (va < vb) g.w++;
      else g.s++;
    }
    const fmt = g => `${g.n} (better ${g.b}, worse ${g.w}, same ${g.s}${g.nc ? `, no cont ${g.nc}` : ''})`;
    for (const [k, row] of Object.entries(rows).sort((x, y) => (y[1].self.n + y[1].human.n) - (x[1].self.n + x[1].human.n)))
      console.log(`   ${k}: self ${fmt(row.self)}; human ${fmt(row.human)}; ${Object.entries(row.keys).sort((x, y) => y[1] - x[1]).map(([k2, n]) => `${k2} ${n}`).join(', ')}`);
  }
}
