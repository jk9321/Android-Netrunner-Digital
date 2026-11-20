/**
 * Review fixes bundle P, trace T for class C (count step; scripts only): at one recorded board where `place` gives an
 * asset 'assetCover' into a waiting iced remote, the Corp's evaluate split into its terms after the asset's install at
 * the bare new remote (the candidate today) and at the waiting remote (the move the Corp makes). Plays the deal with
 * this checkout's src and a plain GameRunner (as the batch) up to the Corp main decision number `AT` (counted as
 * placement-wiring.ts counts Corp decisions). Reads the Corp's own board only (rule 10.2.2a).
 *   ARGS="DEAL=1001 AT=34 CARD=inst-10" npx vite-node scripts/review-fixes/placement-wiring-trace-c.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { GameRunner } from '../../src/ai/playout';
import { createAgent } from '../../src/ai';
import * as core from '../../src/core';
import { simulate } from '../../src/ai/prompts';
import { corpBoardValue, handAndClicks, sideStrength, tagsWorth } from '../../src/ai/evaluate';
import { sideCreditValue } from '../../src/ai/valueModel';
import { decisionContext } from '../../src/ai/handValues';
import { scoringRemote } from '../../src/ai/corp/lines';
import { dealState } from '../stage-a/harness';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const seed = Number(process.env.DEAL ?? 1001);
const AT = Number(process.env.AT ?? 34);
const g = new GameRunner(dealState(seed), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
let n = 0;
let s: core.GameState = g.state;
for (let k = 0; k < 4000; k++) {
  s = g.state;
  const side = core.actingSide(s);
  const w = s.priority;
  const window = s.pendingPrompts.length === 0 && !!w && w.holder !== s.activePlayer;
  const isDec = !!side && !s.winner && (window ? side === 'corp' && core.wantsStop(s, side, w!) && (w!.step === 'approach_ice' || w!.step === 'approach_server') : side === 'corp');
  if (isDec) {
    if (n === AT) break;
    n++;
  }
  if (!g.step()) break;
}
const card = process.env.CARD ?? 'inst-10';
const waiting = Object.values(s.corp.servers).filter(v => v.isRemote && v.ice.length && !v.root.length).map(v => v.id);
console.log(`deal ${seed} decision ${AT}: T${s.turnNumber} cr ${s.corp.credits} cl ${s.corp.clicks}; scoring remote ${scoringRemote(s)?.id}; waiting iced remotes ${waiting.join(',')}`);
decisionContext(s, 'corp');
const terms = (x: core.GameState) => ({
  credits: sideCreditValue(x, 'corp', 'corp'),
  handClicks: handAndClicks(x, 'corp', 'corp'),
  board: corpBoardValue(x, 'corp'),
  tags: tagsWorth(x, 'corp'),
  corp: sideStrength(x, 'corp', 'corp'),
  runner: sideStrength(x, 'runner', 'corp'),
});
const base = terms(s);
const at = (server: string) => ({ type: 'INSTALL_CARD', player: 'corp', cardInstanceId: card, ...(server === 'new' ? { asNewRemote: true } : { targetServerId: server }) }) as core.GameAction;
for (const to of ['new', ...waiting]) {
  const after = simulate(s, at(to));
  if (!after) {
    console.log(to, 'not legal');
    continue;
  }
  const t = terms(after);
  console.log(to, `scoring remote after: ${scoringRemote(after)?.id ?? 'none'}`, Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round((v - (base as any)[k]) * 100) / 100])));
}
