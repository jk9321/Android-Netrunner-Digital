/**
 * Stage D item 1 follow-up 4, part 1 (design answer section 5, the hold questions against the fixed oracle): the kept
 * questions of a runner-money.ts run (its q lines, with the oracle's truth) asked again of this tree's count, on the
 * boards that run dumped (OUT_DIR: files/<shard>/<key>.json; the questions some arm flipped). Each answer is labelled
 * against the recorded truth as runner-money.ts's judge does (the holding set the oracle found, or the truth alone).
 * Prints one JSON line per question asked (`r`) and a summary (`sum`): labels of beta, of the step 1 arm named by ARM
 * (default part1) and of this tree; this tree's new false "holds" and false "does not hold" against beta, and where they
 * differ from the arm's.
 *
 *   DIR=/path/to/run/out npx vite-node scripts/stage-d/runner-money-rescore.ts > rescore.txt
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GameState } from '../../src/core';
import { HoldOptions, serverHold } from '../../src/ai/corp/hold';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';

const DIR = process.env.DIR ?? '.';
const ARM = process.env.ARM ?? 'part1';
interface Q { key: string; src: string; server: string; groups: string[]; beta: { holds: boolean }; arms: Record<string, { holds: boolean }>; oracle?: { truth: boolean | null; set: string[] | null; labels: Record<string, string> } }
const qs: Q[] = [];
for (const f of readdirSync(DIR).filter(f => f.endsWith('.txt'))) for (const l of readFileSync(join(DIR, f), 'utf8').split('\n')) if (l.includes('"kind":"q"')) qs.push(JSON.parse(l));
const boards = new Map<string, string>();
for (const d of readdirSync(join(DIR, 'files'))) for (const f of readdirSync(join(DIR, 'files', d))) boards.set(f.replace('.json', ''), join(DIR, 'files', d, f));

const same = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
const label = (h: { holds: boolean; rez: string[] | null }, o: NonNullable<Q['oracle']>): string => {
  if (h.holds && h.rez && o.truth && o.set && same(h.rez, o.set)) return 'agree';
  if (o.truth === null) return 'unknown';
  if (h.holds === o.truth) return h.holds ? 'agree, other set' : 'agree';
  return h.holds ? 'false holds' : 'false does not hold';
};
const tally = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
const sum = { questions: qs.length, asked: 0, noBoard: 0, beta: {} as Record<string, number>, arm: {} as Record<string, number>, branch: {} as Record<string, number>, newFalseHolds: [] as string[], newFalseNotHold: {} as Record<string, number>, notInArm: [] as string[], armOnly: [] as string[] };
for (const q of qs) {
  if (!q.oracle || !('labels' in q.oracle)) continue;
  tally(sum.beta, q.oracle.labels.beta);
  tally(sum.arm, q.oracle.labels[ARM] ?? 'none');
  const path = boards.get(q.key);
  if (!path) {
    sum.noBoard++;
    continue;
  }
  const f = JSON.parse(readFileSync(path, 'utf8')) as { server: string; opts: HoldOptions; state: GameState };
  const h = asSide('corp', () => (decisionContext(f.state, 'corp'), serverHold(f.state, f.server, f.opts)));
  sum.asked++;
  const l = label(h, q.oracle);
  tally(sum.branch, l);
  const b = q.oracle.labels.beta;
  const a = q.oracle.labels[ARM];
  const where = `${q.src} ${q.server} [${q.groups}] ${q.key}`;
  if (l === 'false holds' && b !== 'false holds') sum.newFalseHolds.push(where);
  if (l === 'false does not hold' && b !== 'false does not hold') {
    tally(sum.newFalseNotHold, `${q.src} ${q.server}`);
    if (a !== 'false does not hold') sum.notInArm.push(where);
  }
  if (a === 'false does not hold' && b !== 'false does not hold' && l !== 'false does not hold') sum.armOnly.push(where);
  console.log(JSON.stringify({ kind: 'r', key: q.key, src: q.src, server: q.server, groups: q.groups, holds: h.holds, label: l, beta: b, arm: a }));
}
console.log(JSON.stringify({ kind: 'sum', ...sum }));
