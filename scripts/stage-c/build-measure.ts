/**
 * Step 4 Stage C (C0 ruling b2): does the Corp still build? Plays local deals and counts the Corp's moves by kind:
 * remotes opened, agendas installed (and into which kind of server), assets installed, ice installed (by turn 6),
 * credits and draws clicked, agendas left in HQ at the end, the winner. Compare corpCore on and off, planner on and
 * off (PLAN_OFF=corpCore, PLAN_OFF=turnPlanner.corp).
 *   DEALS=1001,1041 SHARD=0/4 npx vite-node scripts/stage-c/build-measure.ts > out.json
 */
import { GameAction, GameState, cardDef, findCardAnywhere } from '../../src/core';
import { applyPlanOff } from '../../src/ai/synergy';
import { withPricing } from '../../src/ai/pricing';
import { newDiagnostics } from '../../src/ai/diagnostics';
import { isCorpMain } from '../../src/ai/corp/lines';
import { serverHold } from '../../src/ai/corp/hold';
import { deals, playDeal } from '../stage-a/harness';
import { HeuristicCorpAI } from '../../src/ai/corpAI';

applyPlanOff(process.env.PLAN_OFF ?? '');
const [shard, of] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const list = deals().filter((_, i) => i % of === shard);

type Tally = Record<string, number>;

/** Whether a remote that holds existed (hold owner), else whether ice was in HQ, else neither. */
function heldSplit(s: GameState): string {
  const holds = Object.values(s.corp.servers).some(v => v.isRemote && v.ice.length > 0 && !v.root.some(c => ['agenda', 'asset'].includes(cardDef(c).type_code)) && serverHold(s, v.id, { when: 'runnerTurn' }).holds);
  if (holds) return 'holdingServer';
  return s.corp.hq.some(c => cardDef(c).type_code === 'ice') ? 'iceInHq' : 'neither';
}
const sum: Tally = {};
const inc = (t: Tally, k: string, n = 1) => (t[k] = (t[k] ?? 0) + n);
const times: number[] = [];
const games: { deal: number; winner: string | null; turns: number; t: Tally }[] = [];

for (const deal of list) {
  const t: Tally = {};
  const first: { hq?: number; rd?: number } = {};
  let lastCorp: GameState | null = null;
  const diag = newDiagnostics();
  const end = withPricing({ diagnostics: diag }, () => playDeal(deal, {
    // CORP=rollout: the planner's rollout Corp (no look-ahead, no counted questions: CorpContext.counted false)
    ...(process.env.CORP === 'rollout' ? { corp: () => new HeuristicCorpAI({ synergy: true, planner: false }) } : {}),
    decision: d => {
      const s = d.state;
      const a = d.action as GameAction | null;
      if (d.kind !== 'action' || !a || !isCorpMain(s)) return;
      lastCorp = s;
      // Early ice (C1): the Corp turn on which HQ and R&D first have ice, as the Corp's decisions see the board
      for (const id of ['hq', 'rd'] as const) if (s.corp.servers[id].ice.length && first[id] === undefined) first[id] = s.turnNumber;
      inc(t, 'decisions');
      inc(t, `ms`, d.ms);
      times.push(d.ms);
      if (a.type === 'GAIN_CREDIT') inc(t, 'credit');
      if (a.type === 'DRAW_CARD') inc(t, 'draw');
      if (a.type === 'ADVANCE_CARD') inc(t, 'advance');
      if (a.type === 'SCORE_AGENDA') inc(t, 'score');
      if (a.type === 'PLAY_OPERATION_OR_EVENT') inc(t, 'operation');
      if (a.type === 'USE_ABILITY') inc(t, 'ability');
      if (a.type === 'INSTALL_CARD') {
        const card = findCardAnywhere(s, a.cardInstanceId);
        const kind = card ? cardDef(card).type_code : '?';
        const target = a.asNewRemote ? null : s.corp.servers[a.targetServerId ?? ''];
        if (a.asNewRemote) inc(t, 'newRemote');
        inc(t, `install:${kind}`);
        if (kind === 'ice' && s.turnNumber <= 6) inc(t, 'iceByT6');
        if (kind === 'agenda') inc(t, target?.ice.length ? 'agendaIced' : 'agendaBare');
        if (kind === 'ice' && target && !target.isRemote) inc(t, 'iceCentral');
        if (kind === 'ice' && s.turnNumber <= 6) inc(t, target && !target.isRemote ? 'iceCentralByT6' : 'iceRemoteByT6');
      }
    },
  }));
  // Never iced: counted as the game's last turn + 1
  for (const id of ['hq', 'rd'] as const) {
    inc(t, `firstIce:${id}`, first[id] ?? end.turnNumber + 1);
    if (first[id] === undefined) inc(t, `neverIced:${id}`);
  }
  inc(t, 'q5RolloutDecisions', diag.scoreInTwo.rolloutDecisions);
  inc(t, 'q5RolloutTaken', diag.scoreInTwo.rolloutTaken);
  const agendasInHq = end.corp.hq.filter(c => cardDef(c).type_code === 'agenda').length;
  // c0-rulings 03:58Z: agendas left in HQ by the board at the Corp's last main-phase decision
  if (lastCorp && agendasInHq) inc(t, `agendasLeft:${heldSplit(lastCorp)}`, agendasInHq);
  inc(t, 'agendasInHqAtEnd', agendasInHq);
  inc(t, 'agendasStolen', end.runner.scoreArea.filter(c => cardDef(c).type_code === 'agenda').length);
  if (!t['install:agenda']) inc(t, 'gamesNoAgendaInstalled');
  inc(t, 'corpPoints', end.corp.score);
  inc(t, 'runnerPoints', end.runner.score);
  const winner = (end as GameState & { winner?: string | null }).winner ?? null;
  inc(t, winner === 'corp' ? 'corpWin' : winner === 'runner' ? 'runnerWin' : 'noWin');
  for (const [k, v] of Object.entries(t)) inc(sum, k, v);
  games.push({ deal, winner, turns: end.turnNumber, t });
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ games: games.length, sum, p95: times[Math.floor(0.95 * (times.length - 1))] ?? 0, times, perGame: games }));
