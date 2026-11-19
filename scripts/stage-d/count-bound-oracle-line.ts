/**
 * The count bound item, step 2 (brief-2.md), Part F: the line the oracle plays. hold-oracle.ts answers only how far
 * the Runner gets; this script makes a copy of it at run time (under node_modules/.cache, the repository's file
 * unchanged) that records, per searched position, the Runner's best move and the Corp's move, then replays that line
 * from the oracle's start board. It reads the boards count-bound-oracle.ts saved (BOARDS=<jsonl of `fb` lines>).
 *
 *   BOARDS=boards.jsonl npx vite-node scripts/stage-d/count-bound-oracle-line.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

async function main() {
  const src = readFileSync('scripts/stage-d/hold-oracle.ts', 'utf8');
  const patches: [string, string][] = [
    ["from '../../src/core';", `from '${resolve('src/core')}';`],
    ['function keyOf(', 'export const picks = new Map<string, GameAction>();\nexport function keyOf('],
    ['      if (v > best) best = v;\n', '      if (v > best) {\n        best = v;\n        picks.set(keyOf(s, k, false), a);\n      }\n'],
    ['        worst = Math.min(worst, v);\n', '        if (v < worst) picks.set(keyOf(s, k, false), a);\n        worst = Math.min(worst, v);\n'],
    ['        if (rez) {\n          const v = step(rez);\n', '        if (rez) {\n          picks.set(keyOf(s, k, false), rez);\n          const v = step(rez);\n'],
    ['    if (!pass) return k;\n', '    if (!pass) return k;\n    picks.set(keyOf(s, k, false), pass);\n'],
  ];
  let text = src;
  for (const [a, b] of patches) {
    if (text.split(a).length !== 2) throw new Error(`patch does not match once: ${a}`);
    text = text.replace(a, () => b);
  }
  const dir = resolve('node_modules/.cache/cb-oracle-line');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hold-oracle-line.ts'), text);
  const o = await import(/* @vite-ignore */ join(dir, 'hold-oracle-line.ts'));
  const core = await import(/* @vite-ignore */ resolve('src/core/index.ts'));
  const name = (s: any, id?: string) => (id ? core.findCardAnywhere(s, id)?.cardCode ?? id : '');
  for (const l of readFileSync(process.env.BOARDS!, 'utf8').split('\n').filter(x => x.startsWith('{'))) {
    const b = JSON.parse(l);
    if (b.kind !== 'fb') continue;
    o.picks.clear();
    const ask = { when: 'runnerTurn', targets: [b.server], rez: new Set<string>(b.rez), corpCredits: b.credits, cap: Number(process.env.CAP ?? 400000), retries: true, jackOut: !!b.jackOut };
    const ans = o.oracle(b.state, ask);
    const start = o.oracleStart(b.state, ask);
    const line: string[] = [];
    if (ans.reached && 'state' in start) {
      let s = start.state;
      for (let j = 0; j < 400; j++) {
        const a = o.picks.get(o.keyOf(s, 0, false));
        if (!a) break;
        const who = core.actingSide(s);
        const card = 'cardInstanceId' in a ? ` ${name(s, a.cardInstanceId)}` : '';
        const extra = a.type === 'INITIATE_RUN' ? ` ${a.targetServerId}` : a.type === 'RESOLVE_PROMPT' ? ` ${JSON.stringify(a.answer ?? a).slice(0, 60)}` : a.type === 'BREAK_SUBROUTINE' ? ` sub ${a.subroutineIndex}` : '';
        if (a.type !== 'PASS' || who === 'runner') line.push(`${who}: ${a.type}${card}${extra} [R ${s.runner.credits}c ${s.runner.clicks}k]`);
        s = core.executeAction(s, a);
        if (s.activeRun && (s.activeRun.phase === 'access' || s.activeRun.breached)) {
          line.push(`breach of ${s.activeRun.server} [R ${s.runner.credits}c]`);
          break;
        }
      }
    }
    console.log(JSON.stringify({ kind: 'line', src: b.src, i: b.i, qid: b.qid, mask: b.mask, jackOut: !!b.jackOut, reached: ans.reached, work: ans.work, line }));
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
