// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// Found-list row 21's 30 dumped states (brief followup2-trash 5): the boards where the hold walk said "does not hold"
// and the engine oracle says the Corp holds (Tatu-Bola inside Lycian, report-36 R&D), as ai-script 44098196814 (and its
// re-run 44108430740) dumped them. Each is asked again on this tree with the Corp's own credits and unlimited, and so is
// the oracle (every set of the server's unrezzed ice). Read the dumps from the ai-batch-results branch:
//   git fetch origin ai-batch-results && git show FETCH_HEAD:scripts/44098196814.tar.gz | tar -xz -C <dir>
//   DIRS=<dir>/out/files,<dir2>/out/files TREE=branch npx vite-node scripts/stage-d/row21-states.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../../src/core';
import { serverHold } from '../../src/ai/corp/hold';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { clearCaches } from '../stage-a/harness';
import { oracleGetsIn } from './hold-oracle';

interface Dump {
  line: { src: string; turn: number; label: string; ice: string[]; oracle: { holds: boolean; set: string[] | null } };
  server: string;
  opts: { when: 'runnerTurn' | 'thisRun'; corpCredits: number | null };
  state: GameState;
}
const ask = (d: Dump, corpCredits: number | undefined) => {
  clearCaches();
  const st = structuredClone(d.state);
  return asSide('corp', () => (decisionContext(st, 'corp'), serverHold(st, d.server, { when: d.opts.when, corpCredits })));
};
// The oracle's truth: some set of the server's unrezzed ice the Corp can pay for holds (retries on, as hold-baseline).
// The dump's `corpCredits: null` reached the oracle as unlimited (hold-oracle: anything but undefined is a budget), so
// both budgets are asked of both: the Corp's own credits, and unlimited
const truth = (d: Dump, corpCredits: number | undefined) => {
  const ids = (d.state.corp.servers[d.server]?.ice ?? []).filter(c => !c.isRezzed).map(c => c.instanceId);
  let unknown = false;
  for (let m = 0; m < 1 << ids.length; m++) {
    const a = oracleGetsIn(structuredClone(d.state), d.server, d.opts.when, ids.filter((_, i) => m & (1 << i)), corpCredits, undefined, true).answer;
    if (a === 'holds') return 'holds';
    if (a !== 'getsIn') unknown = true;
  }
  return unknown ? 'unknown' : 'getsIn';
};
let n = 0, agree = 0;
for (const dir of (process.env.DIRS ?? '').split(',').filter(Boolean))
  for (const shard of readdirSync(dir))
    for (const f of readdirSync(join(dir, shard))) {
      const d = JSON.parse(readFileSync(join(dir, shard, f), 'utf8')) as Dump;
      const ice = d.line.ice.join('|');
      if (d.line.label !== 'false does not hold' || !ice.includes('Tatu-Bola') || !ice.includes('Lycian')) continue;
      n++;
      const own = ask(d, undefined).holds, unlimited = ask(d, Infinity).holds;
      const ownTruth = truth(d, undefined), unlimitedTruth = truth(d, Infinity);
      const ok = own === (ownTruth === 'holds') && unlimited === (unlimitedTruth === 'holds');
      if (ok) agree++;
      console.log(JSON.stringify({ tree: process.env.TREE, src: d.line.src, turn: d.line.turn, server: d.server, file: f, corp: d.state.corp.credits, own, ownTruth, unlimited, unlimitedTruth, ok }));
    }
console.log(`${process.env.TREE}: ${agree} of ${n} agree with the oracle (the Corp's own credits and unlimited)`);
