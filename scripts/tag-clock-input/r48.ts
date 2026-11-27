/**
 * F114 + F110 phase B bar 8 (brief tag-clock-input rev 2): report-48 move 42, F114's board
 * (tests/fixtures/placement-wiring/report-48-42.json, T4, the Corp at 4 credits and 3 clicks). On the merge base
 * (ARM_BASE) and on the branch's own src: the 1st, 2nd and 3rd tag's price in both views (tagsWorth with a count, the
 * n-th less the (n-1)-th, read in that side's decision), the per-turn input, and the Corp's pick with the planner's top
 * line values (Ping on a new remote against GAIN_CREDIT, and the margin).
 *   npx vite-node scripts/tag-clock-input/r48.ts -- ARM_BASE=<sha>
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { loadTree, makeTree } from '../corp-owed/trees';
import { MERGE_BASE } from './trees';

const PLAN: [string, string, string] = [
  'ai/turnPlanner.ts',
  `    if (side === 'corp' && plan().replyContenders && ai.reply && sampledReply()) best = contenders(scored, side, synergy) ?? best;\n`,
  `    if (side === 'corp' && plan().replyContenders && ai.reply && sampledReply()) best = contenders(scored, side, synergy) ?? best;\n    (globalThis as any).__r48Plan?.(side, scored.map(x => [x.action, x.value]), best?.action, best?.value);\n`,
];
const root = resolve('node_modules/.cache/tag-clock-input-r48');
const board: GameState = JSON.parse(readFileSync('tests/fixtures/placement-wiring/report-48-42.json', 'utf8'));
const short = (a: any) => (a ? [a.type, a.cardInstanceId, a.targetServerId, a.asNewRemote ? 'new' : ''].filter(Boolean).join(' ') : String(a));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

async function main() {
  const out: Record<string, any> = {};
  for (const [name, ref] of [['base', MERGE_BASE], ['branch', undefined]] as const) {
    const t: any = await loadTree(name, makeTree(join(root, name), { ref, patches: [PLAN] }));
    const inDecision = <X>(s: GameState, side: 'corp' | 'runner', f: () => X): X => t.pricing.asSide(side, () => t.hv.inDecision(s, side, f));
    const row: any = { tags: board.runner.tags, cc: board.corp.credits, ck: board.corp.clicks, rc: board.runner.credits };
    for (const viewer of ['corp', 'runner'] as const) {
      t.clear();
      const s = structuredClone(board);
      const worth = [0, 1, 2, 3].map(n => (n === 0 ? 0 : inDecision(s, viewer, () => t.ev.tagsWorth(s, viewer, n))));
      row[`${viewer} tag prices`] = [1, 2, 3].map(n => r3(worth[n] - worth[n - 1]));
      const tagged = { ...structuredClone(board), runner: { ...structuredClone(board.runner), tags: 1 } };
      row[`${viewer} perTurn (tagged copy)`] = r3(inDecision(tagged, viewer, () => t.ev.tagLossPerTurn(tagged, viewer, 0)));
    }
    t.clear();
    const plans: any[] = [];
    (globalThis as any).__r48Plan = (side: string, scored: [unknown, number][], best: unknown, value: number) =>
      plans.push({ side, scored: scored.map(([a, v]) => [short(a), r3(v)]).sort((x, y) => (y[1] as number) - (x[1] as number)), best: short(best), value: r3(value) });
    const s = structuredClone(board);
    row.pick = short(t.ai.createAgent('corp', 'normal').chooseAction(s));
    (globalThis as any).__r48Plan = undefined;
    const top = plans.find(p => p.side === 'corp');
    row.lines = top?.scored.slice(0, 6);
    const ping = top?.scored.find((x: any) => x[0].startsWith('INSTALL_CARD inst-47') && x[0].includes('new'));
    const credit = top?.scored.find((x: any) => x[0] === 'GAIN_CREDIT');
    row.margin = ping && credit ? { ping: ping[1], credit: credit[1], pingLessCredit: r3(ping[1] - credit[1]) } : null;
    out[name] = row;
  }
  console.log(JSON.stringify(out, null, 1));
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
