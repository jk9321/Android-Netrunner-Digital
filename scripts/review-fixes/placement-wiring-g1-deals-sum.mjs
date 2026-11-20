/**
 * Bundle P build: sums placement-wiring-g1-deals.ts (the g1's differing deals in lockstep, base against c1, c2, head).
 * A deal's difference belongs to the commit where it first appears (brief rev 3): the first of c1, c2, head to part
 * from the merge base at head's step, with the same moves there.
 *
 * A deal outside the class at the board and in the kept lines is re-run with LOG=<seed>:<step> (its playouts logged at the
 * parting step); put that output in the same dir under a name that sorts last (z-log.jsonl): its rows replace the first.
 *
 *   node scripts/review-fixes/placement-wiring-g1-deals-sum.mjs <dir of jsonl> > g1-deals.md
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const rows = readdirSync(dir)
  .filter(f => f.endsWith('.jsonl'))
  .sort()
  .flatMap(f => readFileSync(join(dir, f), 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const by = new Map();
for (const r of rows) (by.get(r.seed) ?? by.set(r.seed, {}).get(r.seed))[r.arm] = r;
const p = s => console.log(s);
const mv = a => (a ? `${a.type}${a.cardInstanceId ? ` ${a.cardInstanceId}` : ''}${a.targetServerId ? ` @${a.targetServerId}` : a.asNewRemote ? ' @new' : ''}${a.choice ? ` ${JSON.stringify(a.choice)}` : ''}` : '-');
const parts = r => r && !r.end && !r.stop;
const same = (x, y) => parts(x) && parts(y) && x.n === y.n && JSON.stringify(x.armMove) === JSON.stringify(y.armMove);
const tally = {};
const add = k => (tally[k] = (tally[k] ?? 0) + 1);

p(`## The g1's differing deals in lockstep (${by.size} deals)\n`);
p('Each deal played on the merge base and on each commit as the g1 plays it (GameRunner, each tree\'s own agents and caches), stopped at the first step where the move or an agent\'s kept memory differs.\n');
for (const [seed, a] of [...by.entries()].sort((x, y) => x[0] - y[0])) {
  const h = a.head;
  if (!parts(h)) {
    add('head does not part (a stop)');
    p(`- **deal ${seed}: head does not part from the merge base in lockstep (${JSON.stringify(h)}) (a stop)**`);
    continue;
  }
  const commit = same(a.c1, h) ? 'fix 1' : same(a.c2, h) ? 'fix 2' : 'fixes 3-4';
  let cls;
  if (h.side !== 'corp') cls = `NOT IN CLASS: the ${h.side} step parts first (runner memory ${h.runnerMemory})`;
  else if (commit === 'fix 1') cls = h.s && h.s.shortToday && !h.s.shortOnce ? 'fix 1, in the class at the board' : `fix 1, NOT IN CLASS at the board (${JSON.stringify(h.s)}): trace through the look-ahead`;
  else if (commit === 'fix 2') {
    const w = (h.covers ?? []).some(c => c.form === 'waiting');
    const at = h.coverArm === 'waiting' || h.coverBase === 'waiting';
    // a later pick of one (M7): a step of either kept line that is a waiting-form cover's install on its own board
    const later = [...(h.walkBase ?? []), ...(h.walkArm ?? [])].some(x => x.waiting);
    cls = at
      ? h.moved
        ? 'fix 2, in the class: a different move, one of them the waiting cover\'s install'
        : 'fix 2, in the class: the same install at the waiting remote, a different line after it'
      : later
        ? `fix 2, in the class: a kept line's later step is a waiting cover's install on its own board${w ? '' : ' (no waiting form at the decision board)'}`
        : h.firstLog && (h.firstLog.armW || h.firstLog.baseW)
          ? `fix 2, in the class through the look-ahead: the playouts first differ at a waiting cover's install (playout ${h.firstLog.p}, step ${h.firstLog.step}: ${mv(h.firstLog.base)} | ${mv(h.firstLog.arm)})`
          : `fix 2, NOT IN CLASS: ${w ? 'a waiting-form board, but no move or kept step is the cover\'s install' : 'no waiting-form placement on the board or in the kept lines'}`;
  } else cls = 'fixes 3-4: NOT EXPECTED';
  add(cls.replace(/ \(.*$/, '').replace(/: trace.*$/, ''));
  const lines = h.side === 'corp' ? `; base line ${h.lineBase?.line?.kind ?? '-'} ${h.lineBase?.line?.agenda ?? ''}${h.lineBase?.server ? ` @${h.lineBase.server}` : ''}, arm line ${h.lineArm?.line?.kind ?? '-'} ${h.lineArm?.line?.agenda ?? ''}; base plan ${(h.planBase ?? []).map(x => mv(x.action)).join(', ') || '-'} | arm plan ${(h.planArm ?? []).map(x => mv(x.action)).join(', ') || '-'}` : '';
  p(`- deal ${seed} step ${h.n} T${h.T} ${h.side}: base ${mv(h.base)} | head ${mv(h.armMove)} (moved ${h.moved}, corp memory ${h.corpMemory}, runner memory ${h.runnerMemory}); ${cls}; covers ${(h.covers ?? []).map(c => `${c.title} ${c.form} @${c.server}`).join(', ') || '-'}${lines}`);
}
p('\n| first parting | deals |');
p('|---|---|');
for (const [k, n] of Object.entries(tally).sort((x, y) => y[1] - x[1])) p(`| ${k} | ${n} |`);
