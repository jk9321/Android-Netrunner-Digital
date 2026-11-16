/**
 * Stage C time check: one local deal played with PLAN_OFF (e.g. +corpCore,+rolloutLines); the slowest Corp decisions
 * with their kind (main phase, prompt, rez window), turn, clicks and the move made.
 *   DEAL=2041 PLAN_OFF=+corpCore,+rolloutLines npx vite-node scripts/stage-c/slow-deal.ts
 */
import { writeFileSync } from 'node:fs';
import { GameAction, GameState, activePrompt, cardDef, findCardAnywhere } from '../../src/core';
import { applyPlanOff } from '../../src/ai/synergy';
import { isCorpMain } from '../../src/ai/corp/lines';
import { playDeal } from '../stage-a/harness';

applyPlanOff(process.env.PLAN_OFF ?? '');
const rows: { ms: number; text: string }[] = [];
const name = (s: GameState, a: GameAction | null) => {
  if (!a) return 'null';
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}`;
};
const end = playDeal(Number(process.env.DEAL ?? 2041), {
  decision: d => {
    const s = d.state;
    const p = activePrompt(s);
    const kind = d.kind === 'rez' ? 'rez window' : p ? `prompt ${p.kind} ${'source' in p ? `${p.source.cardCode} ${p.source.step ?? ''}` : ''}` : isCorpMain(s) ? 'main' : 'other';
    // SAVE=<dir>: the state of every decision slower than a minute, for profiling it alone
    if (process.env.SAVE && d.ms > 60_000) writeFileSync(`${process.env.SAVE}/slow-${process.env.DEAL}-t${s.turnNumber}-c${s.corp.clicks}-${d.i}.json`, JSON.stringify(s));
    rows.push({ ms: d.ms, text: `T${s.turnNumber} c${s.corp.clicks} $${s.corp.credits} ${kind} -> ${name(s, d.action as GameAction | null)}` });
  },
});
rows.sort((a, b) => b.ms - a.ms);
const total = rows.reduce((n, r) => n + r.ms, 0);
console.log(`deal ${process.env.DEAL} turns ${end.turnNumber} decisions ${rows.length} total ${(total / 1000).toFixed(0)} s, corp identity ${cardDef(end.corp.identity).title}`);
for (const r of rows.slice(0, 15)) console.log(`${r.ms.toFixed(0).padStart(7)} ms  ${r.text}`);
