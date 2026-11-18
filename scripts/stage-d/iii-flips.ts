// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// design (iii)'s answer on every runnerTurn flip of comparison 44200015527, joined with the
// fixed oracle's re-score (44222705598, ai-runner-money 9a8c66b). Run with src/ai/corp/hold.ts = design (iii).
//   DUMPS=<44200015527 out/files> RESCORE=<44222705598 out dir> npx vite-node scripts/stage-d/iii-flips.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../../src/core';
import { serverHold } from '../../src/ai/corp/hold';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { clearCaches } from '../stage-a/harness';

const rescore = new Map<string, { after: { truth: boolean | null; label: string }; count: { holds: boolean }; old: { holds: boolean }; rig: string[]; ice: string[]; ansel: boolean; src: string; turn: number; server: string }>();
for (const f of readdirSync(process.env.RESCORE!).filter(f => f.endsWith('.txt')))
  for (const l of readFileSync(join(process.env.RESCORE!, f), 'utf8').split('\n')) if (l.startsWith('{')) { const d = JSON.parse(l); rescore.set(d.key, d); }
const ROW53 = ['Side Hustle', '“Knickknack” O’Brian', 'Coalescence'];
const tally: Record<string, number> = {};
const out: string[] = [];
for (const dir of readdirSync(process.env.DUMPS!)) {
  for (const f of readdirSync(join(process.env.DUMPS!, dir))) {
    const j = JSON.parse(readFileSync(join(process.env.DUMPS!, dir, f), 'utf8'));
    if (!j.line.flip || j.opts.when !== 'runnerTurn') continue;
    const key = f.replace('.json', '');
    const r = rescore.get(key);
    const opts = { ...j.opts, corpCredits: j.opts.corpCredits === null ? Infinity : j.opts.corpCredits };
    clearCaches();
    const s = structuredClone(j.state) as GameState;
    const h = asSide('corp', () => (decisionContext(s, 'corp'), serverHold(s, j.server, opts)));
    let label: string;
    if (!h.holds) label = 'iii: does not hold (as beta)';
    else if (!r) label = 'iii holds: not re-scored';
    else if (r.after.truth === true) label = 'iii holds: right';
    else if (r.after.truth === null) label = 'iii holds: unknown';
    else label = j.line.rig.some((c: string) => ROW53.includes(c)) ? 'iii holds: false, row 53 card on the rig' : 'iii holds: false, other';
    tally[label] = (tally[label] ?? 0) + 1;
    if (label.includes('false') || label.includes('unknown')) out.push(`${label} | ${j.line.src} T${j.line.turn} ${j.server} ${j.line.ice.join(', ')} | ${j.line.rig.join(', ')} | ${key}`);
  }
}
console.log(JSON.stringify(tally, null, 1));
const pos = new Map<string, number>();
for (const o of out) { const k = o.split(' | ').slice(0, 3).join(' | '); pos.set(k, (pos.get(k) ?? 0) + 1); }
for (const [k, n] of [...pos.entries()].sort((a, b) => b[1] - a[1])) console.log(n, k);
for (const o of out.filter(o => o.includes('other'))) console.log('OTHER', o);
