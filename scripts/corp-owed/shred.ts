/**
 * Owed count 4 (row 115, brief /mnt/project-files/netrunner-ai/owed-counts/brief.md item 4): the decision of the pin
 * tests/runAnswers.test.ts "past 70 sets of cards" traced on its own board (deal 1601 T12's Ballista "end", Shred's
 * reveal with root 30070, 30042, 30058 (X = 3) and nine cards in HQ), under the pin's 8 RNG states, by the Normal Corp
 * (the test's corpMove: a fresh agent's chooseAction on a copy, caches cleared). A scratch tree of this checkout's src
 * with hooks only (each calls a global the script sets): runAnswer's answers, their walk verdicts, runLoss and prices;
 * runPrice's parts (scoreOutcome, freeRezSaving, rigMove, hqChanceLoss); hqChanceLoss's own reading beside the exact
 * expectation over every set of X cards (all 84), and the mean of the 3-card losses the test's own reveals take.
 * HQ=<codes> and ROOT=<codes> replace the board's (the pin beside it, "the expected loss decides", is ROOT the same and
 * HQ=30045,30045,30045,30045).
 *
 *   npx vite-node scripts/corp-owed/shred.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../../src/core';
import { Patch, loadTree, makeTree, rootOf } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const G = globalThis as any;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const HOOKS: Patch[] = [
  [
    'ai/prompts.ts',
    `  const priced = outs.map((o, k) => runPrice(state, prompt, o.action, o.after, memory, synergy) - (verdicts[k] === 'in' ? loss : 0));\n`,
    `  const priced = outs.map((o, k) => runPrice(state, prompt, o.action, o.after, memory, synergy) - (verdicts[k] === 'in' ? loss : 0));\n  (globalThis as any).__owRun?.({ loss, answers: outs.map(o => o.action), verdicts, priced });\n`,
  ],
  [
    'ai/prompts.ts',
    `    return scoreOutcome(state, board, 'corp', memory, synergy) + freeRezSaving(state, after) - rigMove(state, board);\n  }`,
    `    const __p = { kind: 'other', score: scoreOutcome(state, board, 'corp', memory, synergy), free: freeRezSaving(state, after), rig: rigMove(state, board) };\n    (globalThis as any).__owPrice?.(action, __p);\n    return __p.score + __p.free - __p.rig;\n  }`,
  ],
  [
    'ai/prompts.ts',
    `  return scoreOutcome(state, board, 'corp', memory, synergy) + freeRezSaving(state, after) - hqChanceLoss(state, gone.length);\n}`,
    `  const __p = { kind: 'shredTrash', score: scoreOutcome(state, board, 'corp', memory, synergy), free: freeRezSaving(state, after), hq: hqChanceLoss(state, gone.length), gone: gone.map(c => c.cardCode) };\n  (globalThis as any).__owPrice?.(action, __p);\n  return __p.score + __p.free - __p.hq;\n}`,
  ],
  [
    'ai/prompts.ts',
    `  if (sets.length <= 70) return sets.reduce((n, ids) => n + without(new Set(ids)), 0) / sets.length;\n`,
    `  if ((globalThis as any).__owExact) {
    const all: string[][] = [];
    const every = (from: number, chosen: string[]) => {
      if (chosen.length === x) return void all.push(chosen);
      for (let i = from; i < hq.length; i++) every(i + 1, [...chosen, hq[i].instanceId]);
    };
    every(0, []);
    const single = hq.map(c => ({ code: c.cardCode, loss: without(new Set([c.instanceId])) }));
    (globalThis as any).__owExact({ x, hq: hq.length, sets: all.length, capped: sets.length > 70, full, exact: all.reduce((n, ids) => n + without(new Set(ids)), 0) / all.length, singleMean: single.reduce((n, s) => n + s.loss, 0) / single.length, single, bySet: (ids: string[]) => without(new Set(ids)) });
  }
  if (sets.length <= 70) return sets.reduce((n, ids) => n + without(new Set(ids)), 0) / sets.length;\n`,
  ],
];

async function main() {
  const t = await loadTree('shred', makeTree(join(rootOf('shred', 0), 'tree'), { patches: HOOKS }));
  const gsMod: any = await import(/* @vite-ignore */ join(rootOf('shred', 0), 'tree/src/core/engine/gameState.ts'));
  const ROOT = (process.env.ROOT ?? '30070,30042,30058').split(',');
  const HQ = (process.env.HQ ?? '30045,30061,30064,30075,30048,30057,30065,30054,30041').split(',');
  const s: GameState = JSON.parse(readFileSync('tests/fixtures/run-answers/deal-1601-t12-30062.json', 'utf8'));
  s.id = `${s.id}:${ROOT}:${HQ}`;
  s.runner.score = 0;
  s.corp.servers[s.activeRun!.server].root = ROOT.map(c => gsMod.createCardInstance(s, c));
  s.corp.hq = HQ.map(c => gsMod.createCardInstance(s, c));
  const p = t.core.activePrompt(s)!;
  const e: GameState = t.core.executeAction(s, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId: 'end' } });
  const q = t.core.activePrompt(e)!;
  const title = (c: string) => t.core.getCardDefinition(c).title;
  console.log(`# Shred past 70 sets: root ${ROOT.map(title).join(', ')}; HQ ${HQ.map(title).join(', ')}; prompt ${(q as any).source?.cardCode}\n`);
  console.log(`Board: T${e.turnNumber}, Corp ${e.corp.credits} credits, score ${e.corp.score}; Runner ${e.runner.credits} credits, score ${e.runner.score}; server ${e.activeRun!.server}\n`);
  console.log(`| state | cards the reveal takes | answer | runLoss | verdicts (trash, no) | priced (trash, no) | trash: score, free, hqChanceLoss | no: score, free, rig | hqChanceLoss exact over all sets | x * single mean | this reveal's own loss |`);
  console.log(`|---|---|---|---:|---|---|---|---|---:|---:|---:|`);
  let exactOnce: any = null;
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const b = structuredClone(e);
    b.rng = { ...b.rng, state: (k * 2654435761) >>> 0 };
    const a = t.core.executeAction(structuredClone(b), { type: 'RESOLVE_PROMPT', player: 'corp', promptId: q.id, choice: { kind: 'effect_choice', optionId: 'trash' } });
    const goneIds = b.corp.hq.filter((c: any) => !a.corp.hq.some((h: any) => h.instanceId === c.instanceId)).map((c: any) => c.instanceId);
    const gone = b.corp.hq.filter((c: any) => goneIds.includes(c.instanceId)).map((c: any) => title(c.cardCode));
    let run: any = null;
    const prices: any[] = [];
    let exact: any = null;
    G.__owRun = (x: any) => (run = x);
    G.__owPrice = (action: any, x: any) => prices.push({ opt: action.choice?.optionId, ...x });
    G.__owExact = (x: any) => (exact = { ...x, own: x.bySet(goneIds) });
    t.clear();
    const agent = t.ai.createAgent('corp', 'normal');
    const move = agent.chooseAction(structuredClone(b));
    G.__owRun = G.__owPrice = G.__owExact = undefined;
    exactOnce ??= exact;
    const ans = move.choice?.optionId ?? move.type;
    const opt = (o: string) => run?.answers.findIndex((x: any) => x.choice?.optionId === o);
    const tr = prices.find(x => x.opt === 'trash');
    const no = prices.find(x => x.opt === 'no');
    console.log(
      `| ${k} | ${gone.join(', ')} | ${ans} | ${run ? r3(run.loss) : '-'} | ${run ? `${run.verdicts[opt('trash')]}, ${run.verdicts[opt('no')]}` : 'not decided'} | ${run ? `${r3(run.priced[opt('trash')])}, ${r3(run.priced[opt('no')])}` : '-'} | ${tr ? `${r3(tr.score)}, ${r3(tr.free)}, ${r3(tr.hq)}` : '-'} | ${no ? `${r3(no.score)}, ${r3(no.free)}, ${r3(no.rig)}` : '-'} | ${exact ? r3(exact.exact) : '-'} | ${exact ? r3(exact.x * exact.singleMean) : '-'} | ${exact ? r3(exact.own) : '-'} |`
    );
  }
  if (exactOnce) {
    console.log(`\nhqChanceLoss: x = ${exactOnce.x}, ${exactOnce.hq} cards, ${exactOnce.sets} sets (capped: ${exactOnce.capped}); ownHandValue of the full hand ${r3(exactOnce.full)}`);
    console.log(`Each card alone (ownHandValue of HQ less HQ without it): ${exactOnce.single.map((s: any) => `${title(s.code)} ${r3(s.loss)}`).join('; ')}; mean ${r3(exactOnce.singleMean)}`);
  }
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
