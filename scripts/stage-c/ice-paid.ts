/**
 * Stage C8 (AI Coordinator 2026-11-15 22:19Z): does the ice paid test hold the first ice back? At every Corp main-phase
 * decision of Corp turns 1 to 3, the ice candidates of the order (a fresh Normal Corp on a copy of the state): how
 * many there are, how many fail `icePaidAt` (install plus rez would leave less than keep) and so sort behind, by
 * destination, with the Corp's credits and keep; and what the Corp then played (line 7 with a behind ice for a bare
 * central in HQ is counted). Observation only: the deal's own agents decide, as in the batch.
 *
 *   SHARD=k/n npx vite-node scripts/stage-c/ice-paid.ts -- batch   the g3 batch's 663 deals (corp-losses seeds), turns 1 to 3
 *   SHARD=k/n npx vite-node scripts/stage-c/ice-paid.ts            the recorded decisions: the 56 local deals and the human games
 *   node scripts/stage-c/ice-paid-sum.mjs <dir>
 */
import { cardDef, GameAction, GameState } from '../../src/core';
import { createAgent } from '../../src/ai';
import { HeuristicCorpAI } from '../../src/ai/corpAI';
import type { RankedCandidate } from '../../src/ai/corp/candidates';
import { isCorpMain } from '../../src/ai/corp/lines';
import { icePaidAt } from '../../src/ai/corp/placement';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { GameRunner } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';
import { DEFAULT_DEALS, clearCaches, dealState, forEachRecorded } from '../stage-a/harness';

const mode = process.argv.slice(2).filter(a => a !== '--')[0] ?? (process.env.ARGS ?? '').trim();
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const MAX_TURN = 3;

const destOf = (a: GameAction): string => {
  const t = (a as { targetServerId?: string; asNewRemote?: boolean }).targetServerId;
  if (!t || (a as { asNewRemote?: boolean }).asNewRemote) return 'new';
  return t === 'hq' || t === 'rd' || t === 'archives' ? t : 'remote';
};
const moveOf = (s: GameState, a: GameAction | null) => {
  if (!a) return 'none';
  const id = (a as { cardInstanceId?: string }).cardInstanceId;
  const c = id ? s.corp.hq.find(x => x.instanceId === id) : undefined;
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${a.type === 'INSTALL_CARD' ? '@' + destOf(a) : ''}`;
};

function look(src: string, s: GameState, chosen: GameAction | null) {
  if (s.turnNumber > MAX_TURN || !isCorpMain(s)) return;
  const copy = structuredClone(s);
  clearCaches();
  const ranked = new HeuristicCorpAI({}).rankMainActions(copy) as RankedCandidate[];
  const keep = rezMoney(copy).keep;
  const ice = ranked.flatMap(r => {
    if (r.action.type !== 'INSTALL_CARD') return [];
    const card = copy.corp.hq.find(c => c.instanceId === (r.action as { cardInstanceId: string }).cardInstanceId);
    if (!card || cardDef(card).type_code !== 'ice') return [];
    const dest = destOf(r.action);
    const server = dest === 'new' ? null : copy.corp.servers[(r.action as { targetServerId: string }).targetServerId];
    const install = server ? server.ice.length : 0;
    return [{ title: cardDef(card).title, dest, line: r.line, behind: r.behind, paid: icePaidAt(copy, card, install, keep), bare: server ? server.ice.length === 0 : true, cost: cardDef(card).cost ?? 0 }];
  });
  const iceInHq = copy.corp.hq.filter(c => cardDef(c).type_code === 'ice').length;
  const t = chosen?.type;
  const line7 = t === 'DRAW_CARD' || t === 'GAIN_CREDIT';
  const behindBareCentral = ice.some(x => x.behind && !x.paid && x.bare && (x.dest === 'hq' || x.dest === 'rd'));
  const passedBareCentral = ice.some(x => !x.behind && x.bare && (x.dest === 'hq' || x.dest === 'rd'));
  console.log(JSON.stringify({ src, T: s.turnNumber, clicks: s.corp.clicks, credits: s.corp.credits, keep, iceInHq, ice, chosen: moveOf(s, chosen), line7, behindBareCentral, passedBareCentral }));
}

if (mode === 'batch') {
  // The g3 batch's deals: games 0 to 2 of every pairing, seeded 10 apart (corp-losses.ts)
  const seeds: number[] = [];
  for (let p = 0; p < 221; p++) for (let g = 0; g < 3; g++) seeds.push(1000 + p * 10 + g + 1);
  seeds.forEach((seed, k) => {
    if (k % shards !== shard) return;
    valueLoops.clear();
    const game = new GameRunner(dealState(seed), { corp: createAgent('corp', 'normal', {}), runner: createAgent('runner', 'normal', {}) });
    for (;;) {
      const s = game.state;
      if (s.turnNumber > MAX_TURN) break;
      const corpMain = isCorpMain(s);
      if (!game.step()) break;
      if (corpMain) look(`batch:${seed}`, s, game.last);
    }
  });
} else {
  // Recorded decisions: the local deals (stopped after turn 3) and the human games
  DEFAULT_DEALS.forEach((seed, k) => {
    if (k % shards !== shard) return;
    const game = new GameRunner(dealState(seed), { corp: createAgent('corp', 'normal', {}), runner: createAgent('runner', 'normal', {}) });
    for (;;) {
      const s = game.state;
      if (s.turnNumber > MAX_TURN) break;
      const corpMain = isCorpMain(s);
      if (!game.step()) break;
      if (corpMain) look(`deal:${seed}`, s, game.last);
    }
  });
  process.env.DEALS = 'none';
  forEachRecorded({ decision: d => d.kind === 'action' && d.src.startsWith('human') && look(d.src, d.state, d.action) });
}
