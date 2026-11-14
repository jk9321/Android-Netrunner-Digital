/**
 * Step 4 Stage A tables 1, 3, 4, 5, 6 and 7 (brief-stage-a.md), read on the recorded states of scripts/stage-a/harness.ts
 * with the three hand-value caches cleared before every decision. Each Corp decision is probed after it is made; the
 * probes only read (the caches are cleared again before the next decision), so play here is table 8's play.
 *
 *   SHARD=0/4 npx vite-node scripts/stage-a/tables.ts > tables-0.json
 *   node scripts/stage-a/tables-sum.mjs tables-*.json --out /mnt/project-files/netrunner-ai/audit-fixes/stage-a
 *
 * Old counts come from scripts/stage-a/reference.ts (frozen copies from beta 92f5c96); the owners from src/ai/corp/.
 */
import { CardInstance, GameAction, GameState, cardDef, executeAction, isLegalAction } from '../../src/core';
import { ScoredAction } from '../../src/ai/agent';
import { asSide, plan } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { moneyPick } from '../../src/ai/incomeLine';
import { scoreNowPlan } from '../../src/ai/winNow';
import { moneyOpGain, moneyTarget, rezReserve, unrezzedIceCost } from '../../src/ai/corpAI';
import { econValue } from '../../src/ai/cardValues';
import { assetPartner, centralIce, iceRedirect } from '../../src/ai/countedScore';
import { runnerBudget, serverHold } from '../../src/ai/corp/hold';
import { lineFloor, rezMoney } from '../../src/ai/corp/rezMoney';
import { centralStake, reachablePoints, runLoss, stake } from '../../src/ai/corp/pools';
import { HeldLine, heldLaterStep, isCorpMain } from '../../src/ai/corp/lines';
import { place, placementAction } from '../../src/ai/corp/placement';
import * as ref from './reference';
import { Decision, clearCaches, forEachRecorded } from './harness';

const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
const isAgenda = (c: CardInstance | undefined) => typeOf(c) === 'agenda';
const same = (a: number | null, b: number | null) => (a === null && b === null) || (a !== null && b !== null && (a === b || Math.abs(a - b) < 1e-9));
const where = (d: Decision) => `${d.src} #${d.i} T${d.turn}`;

const out = {
  hold: { checks: 0, agree: 0, disagree: [] as string[], stopChecks: 0, stopAgree: 0, stopDisagree: [] as string[], cross: { states: 0, agree: 0, kinds: {} as Record<string, number>, examples: [] as string[] } },
  rez: { checks: 0, agree: 0, disagree: [] as string[], sumAgree: 0, states: 0, keepBelow: [] as { at: string; keep: number; sum: number; budget: number; staked: number }[], dist: {} as Record<string, { n: number; abs: number; signed: number; worst: number; worstAt: string }>, examples: [] as string[] },
  below: { games: {} as Record<string, { moves: number; below: number; crossing: number }> },
  pools: { runChecks: 0, lossAgree: 0, pointsAgree: 0, stakeLoss: 0, stakePoints: 0, disagree: [] as string[], centralChecks: 0, centralAgree: 0, centralStakeAgree: 0, archivesFaceUp: 0, examples: [] as string[] },
  place: { installs: 0, agree: 0, byType: {} as Record<string, { n: number; agree: number }>, byReason: {} as Record<string, number>, disagree: [] as string[], prompts: 0, promptsDiffer: 0, promptExamples: [] as string[] },
  pairs: { reached: 0, counts: {} as Record<string, number>, played: {} as Record<string, number> },
};

function dist(name: string, value: number, keep: number, at: string) {
  const row = (out.rez.dist[name] ??= { n: 0, abs: 0, signed: 0, worst: 0, worstAt: '' });
  row.n++;
  row.abs += Math.abs(value - keep);
  row.signed += value - keep;
  if (Math.abs(value - keep) > Math.abs(row.worst)) {
    row.worst = value - keep;
    row.worstAt = at;
  }
}

// ------------------------------------------------------------------------------------------------ table 1, hold
function holdTable(d: Decision) {
  const s = d.state;
  for (const v of Object.values(s.corp.servers)) {
    for (const credits of [s.corp.credits, s.corp.credits + Math.max(0, s.corp.clicks - 1), Infinity, 0]) {
      const old = ref.holdCost(s, v.ice, credits);
      const h = serverHold(s, v.id, { when: 'runnerTurn', corpCredits: credits });
      const now = h.holds ? h.rezCost : null;
      out.hold.checks++;
      if (same(old, now)) out.hold.agree++;
      else if (out.hold.disagree.length < 50) out.hold.disagree.push(`${where(d)} ${v.id} credits ${credits}: holdCost ${old}, serverHold ${now}`);
    }
  }
  const run = s.activeRun;
  if (d.kind !== 'rez' || !run || run.icePosition === null || s.priority?.step !== 'approach_ice') return;
  const ice = s.corp.servers[run.server]?.ice[run.icePosition];
  if (!ice) return;
  for (const [withIce, further] of [[true, true], [false, true], [true, false]] as const) {
    const old = ref.stopCost(s, withIce ? ice : null, further);
    const h = serverHold(s, run.server, { when: 'thisRun', mustRez: withIce ? [ice.instanceId] : [], further });
    out.hold.stopChecks++;
    if ((h.holds ? h.rezCost : Infinity) === old) out.hold.stopAgree++;
    else if (out.hold.stopDisagree.length < 50) out.hold.stopDisagree.push(`${where(d)} ${run.server} ice ${withIce} further ${further}: stopCost ${old}, serverHold ${h.rezCost}`);
  }
  // The two old counts against each other on the same server: does the Corp keep the Runner out?
  const server = s.corp.servers[run.server];
  const nextTurn = ref.holdCost(s, server.ice, s.corp.credits) !== null;
  const thisRun = Math.min(ref.stopCost(s, ice, true), ref.stopCost(s, null, true)) < Infinity;
  out.hold.cross.states++;
  if (nextTurn === thisRun) out.hold.cross.agree++;
  else {
    const budget = ref.runnerBudget(s);
    const passed = run.icePosition < server.ice.length - 1;
    const kind = `${nextTurn ? 'holdCost holds, stopCost not' : 'stopCost holds, holdCost not'}; budget ${budget > s.runner.credits ? 'next turn higher' : budget < s.runner.credits ? 'next turn lower' : 'same'}${passed ? '; ice already passed this run' : ''}`;
    out.hold.cross.kinds[kind] = (out.hold.cross.kinds[kind] ?? 0) + 1;
    if (out.hold.cross.examples.length < 30) out.hold.cross.examples.push(`${where(d)} ${run.server} pos ${run.icePosition}/${server.ice.length}: runner credits ${s.runner.credits}, budget ${budget}; ${kind}`);
  }
}

// --------------------------------------------------------------------------------------------- table 3, rez money
function rezTable(d: Decision) {
  const s = d.state;
  if (!isCorpMain(s)) return;
  const ids = ['', ...s.corp.hq.filter(isAgenda).map(c => c.instanceId), ...Object.values(s.corp.servers).flatMap(v => v.root.filter(isAgenda).map(c => c.instanceId))];
  for (const id of ids) {
    const old = ref.afterLineFloor(s, id);
    const now = lineFloor(s, id);
    const sum = Object.values(rezMoney(s, { without: [id] }).byServer).reduce((a, b) => a + b, 0);
    out.rez.checks++;
    if (old === now) out.rez.agree++;
    else if (out.rez.disagree.length < 50) out.rez.disagree.push(`${where(d)} agenda '${id}': afterLineFloor ${old}, lineFloor ${now}`);
    if (old === sum) out.rez.sumAgree++;
  }
  const money = rezMoney(s);
  const sum = Object.values(money.byServer).reduce((a, b) => a + b, 0);
  out.rez.states++;
  if (money.keep < sum) out.rez.keepBelow.push({ at: where(d), keep: money.keep, sum, budget: runnerBudget(s), staked: Object.keys(money.byServer).length });
  const at = where(d);
  asSide('corp', () => {
    decisionContext(s, 'corp');
    const wide = plan().rezMoney;
    dist('rezReserve (and reservePenalty, which reads it)', rezReserve(s, wide), money.keep, at);
    dist('moneyTarget', moneyTarget(s), money.keep, at);
    dist("pacing gate's and cast-while-able's (unrezzedIceCost)", unrezzedIceCost(s), money.keep, at);
    const agendas = s.corp.hq.filter(isAgenda);
    const floor = agendas.length ? Math.min(...agendas.map(x => ref.afterLineFloor(s, x.instanceId))) : ref.afterLineFloor(s, '');
    dist("scoringShort's floor", floor, money.keep, at);
    if (agendas.length) dist("reservedForAgenda's floor (its horizon less this)", floor, money.keep, at);
  });
  if (out.rez.examples.length < 400) out.rez.examples.push(`${at}\tcredits ${s.corp.credits}\tkeep ${money.keep}\tbyServer ${JSON.stringify(money.byServer)}\tunholdable ${money.unholdable.join(',') || '-'}\trunner budget ${runnerBudget(s)}`);
}

// ------------------------------------------------------------------------------------------- table 4, below keep
function belowTable(d: Decision) {
  const s = d.state;
  if (!d.src.startsWith('deal:') || d.kind !== 'action' || !isCorpMain(s) || !d.action || !isLegalAction(s, d.action)) return;
  const keep = rezMoney(s).keep;
  const after = executeAction(s, d.action).corp.credits;
  const g = (out.below.games[d.src] ??= { moves: 0, below: 0, crossing: 0 });
  g.moves++;
  if (after < keep) g.below++;
  if (after < keep && s.corp.credits >= keep) g.crossing++;
}

// ----------------------------------------------------------------------------------------------- table 5, pools
function poolsTable(d: Decision) {
  const s = d.state;
  const run = s.activeRun;
  if (run && s.corp.servers[run.server]) {
    const oldLoss = ref.runLoss(s);
    const oldPoints = ref.reachablePoints(s);
    const st = stake(s, run.server);
    out.pools.runChecks++;
    if (oldLoss === runLoss(s)) out.pools.lossAgree++;
    if (oldPoints === reachablePoints(s)) out.pools.pointsAgree++;
    if (Math.abs(oldLoss - st.loss) < 1e-9) out.pools.stakeLoss++;
    else if (out.pools.disagree.length < 50) out.pools.disagree.push(`${where(d)} ${run.server}: runLoss ${oldLoss}, stake.loss ${st.loss}`);
    if (oldPoints === st.points) out.pools.stakePoints++;
    else if (out.pools.disagree.length < 50) out.pools.disagree.push(`${where(d)} ${run.server}: reachablePoints ${oldPoints}, stake.points ${st.points}`);
    if (run.server === 'archives' && s.corp.archives.faceUp.some(isAgenda)) out.pools.archivesFaceUp++;
  }
  if (!isCorpMain(s)) return;
  for (const ice of [{ instanceId: '' }, ...s.corp.hq.filter(c => typeOf(c) === 'ice')]) {
    const old = ref.centralStake(s, ice.instanceId);
    const now = centralStake(s, ice.instanceId);
    const viaStake = { hq: stake(s, 'hq', { leaving: ice.instanceId, accesses: 1 }).loss, rd: stake(s, 'rd', { accesses: 1 }).loss };
    out.pools.centralChecks++;
    if (old.hq === now.hq && old.rd === now.rd) out.pools.centralAgree++;
    if (Math.abs(old.hq - viaStake.hq) < 1e-9 && Math.abs(old.rd - viaStake.rd) < 1e-9) out.pools.centralStakeAgree++;
    else if (out.pools.disagree.length < 50) out.pools.disagree.push(`${where(d)} leaving ${ice.instanceId}: centralStake ${JSON.stringify(old)}, stake ${JSON.stringify(viaStake)}`);
  }
  if (out.pools.examples.length < 300 && d.kind === 'action') {
    const st = (id: string) => stake(s, id, { accesses: 1 });
    out.pools.examples.push(`${where(d)}\tHQ ${JSON.stringify(st('hq'))}\tR&D ${JSON.stringify(st('rd'))}\trunner score ${s.runner.score}\tHQ cards ${s.corp.hq.length}\tR&D cards ${s.corp.rd.length}`);
  }
}

// ---------------------------------------------------------------------------------- tables 6 and 7, the ranking
interface Watch {
  ranked: ScoredAction[] | null;
  planned: GameAction | null | undefined;
}
const watch = new WeakMap<object, Watch>();

function arm(agent: object) {
  const w: Watch = { ranked: null, planned: undefined };
  watch.set(agent, w);
  const a = agent as { rankMainActions?: (s: GameState, legal?: GameAction[]) => ScoredAction[]; plan?: (s: GameState, r: ScoredAction[]) => GameAction | null; __watched?: boolean };
  if (!a.rankMainActions || a.__watched) return;
  a.__watched = true;
  const rank = a.rankMainActions.bind(agent);
  const planner = a.plan!.bind(agent);
  a.rankMainActions = (s, legal) => {
    const r = rank(s, legal);
    const cur = watch.get(agent);
    if (cur && !cur.ranked) cur.ranked = r;
    return r;
  };
  a.plan = (s, r) => {
    const p = planner(s, r);
    const cur = watch.get(agent);
    if (cur) cur.planned = p;
    return p;
  };
}

type Install = GameAction & { cardInstanceId: string; targetServerId?: string; asNewRemote?: boolean };
const dest = (a: Install) => (a.asNewRemote ? 'new' : a.targetServerId ?? 'new');

/** The eight intent lines of spec 1.3, by what the action is. */
function intent(s: GameState, a: GameAction): number | null {
  const card = 'cardInstanceId' in a && a.cardInstanceId ? [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice])].find(c => c.instanceId === a.cardInstanceId) : undefined;
  switch (a.type) {
    case 'TRASH_RESOURCE':
      return 1;
    case 'PLAY_OPERATION_OR_EVENT':
      if (card?.cardCode === '35081') return 1; // Petty Cash, playable only as the turn's first action
      return card && moneyOpGain(card.cardCode) !== undefined ? 5 : 6;
    case 'INSTALL_CARD': {
      const i = a as Install;
      if (typeOf(card) === 'ice') return i.asNewRemote ? 4 : 2;
      if (typeOf(card) === 'agenda') return 3;
      if (typeOf(card) === 'asset' && econValue(card!.cardCode, s) !== undefined) return 5;
      return 6;
    }
    case 'ADVANCE_CARD':
      return isAgenda(card) ? 3 : 6;
    case 'USE_ABILITY':
      return 5;
    case 'PURGE_VIRUS_COUNTERS':
      return 7;
    case 'DRAW_CARD':
    case 'GAIN_CREDIT':
      return 8;
    case 'END_TURN':
    case 'START_TURN':
    case 'SCORE_AGENDA':
      return null;
    default:
      return 6;
  }
}

function rankingTables(d: Decision) {
  const s = d.state;
  const w = watch.get(d.agent);
  if (d.kind !== 'action' || !w?.ranked || !d.action || !isCorpMain(s)) return;
  const held0 = (d.before?.heldLine ?? null) as HeldLine | null;
  const score = asSide('corp', () => (decisionContext(s, 'corp'), scoreNowPlan(s)));
  const later = !!heldLaterStep(s, held0);
  const ranked = w.ranked;
  const planned = w.planned ?? null;
  const money = !score && !later && s.turnStep?.kind !== 'corp_turn_start' ? asSide('corp', () => moneyPick(s, planned ?? ranked[0]?.action)) : null;
  let chosen: GameAction | undefined = money ?? planned ?? (ranked[0]?.score > -Infinity ? ranked[0].action : undefined);
  if (plan().tagFirst && ranked[0]?.action.type === 'TRASH_RESOURCE' && ranked[0].tagFirst) chosen = ranked[0].action;
  if (!chosen) return;
  // Table 6: an install the ranking or the planner proposed, against where the played install went
  if (chosen.type === 'INSTALL_CARD' && !money) {
    const c = chosen as Install;
    const card = s.corp.hq.find(x => x.instanceId === c.cardInstanceId);
    if (card) {
      const p = asSide('corp', () => (decisionContext(s, 'corp'), place(s, card, { from: chosen!, held: held0, scoreNow: score })));
      const played = d.action as Install;
      let agree: boolean;
      let expect: string;
      if (!p.length) {
        agree = !(played.type === 'INSTALL_CARD' && played.cardInstanceId === card.instanceId);
        expect = 'a counted line takes the click';
      } else {
        const want = placementAction(card, p[0]);
        agree = played.type === 'INSTALL_CARD' && played.cardInstanceId === want.cardInstanceId && dest(played) === want.server;
        expect = `${want.cardInstanceId} to ${want.server} (${p[0].reason})`;
        out.place.byReason[p[0].reason] = (out.place.byReason[p[0].reason] ?? 0) + 1;
      }
      const t = typeOf(card) ?? '?';
      const row = (out.place.byType[t] ??= { n: 0, agree: 0 });
      row.n++;
      out.place.installs++;
      if (agree) {
        row.agree++;
        out.place.agree++;
      } else if (out.place.disagree.length < 100) out.place.disagree.push(`${where(d)} ${cardDef(card).title}: proposed ${dest(c)}, place ${expect}, played ${JSON.stringify(played)}`);
    }
  }
  // Table 7: the played line against every other line with a legal move
  if (score || later || money) return;
  const playedLine = intent(s, chosen);
  if (playedLine === null) return;
  out.pairs.reached++;
  out.pairs.played[playedLine] = (out.pairs.played[playedLine] ?? 0) + 1;
  const avail = new Set(ranked.map(r => intent(s, r.action)).filter((x): x is number => x !== null));
  for (const other of avail) if (other !== playedLine) out.pairs.counts[`${playedLine}>${other}`] = (out.pairs.counts[`${playedLine}>${other}`] ?? 0) + 1;
}

// ------------------------------------------------------------------------- table 6, for information: the prompts
function promptTable(d: Decision) {
  const s = d.state;
  const prompt = s.pendingPrompts[0];
  const a = d.action as { type: string; choice?: { kind?: string; optionId?: string } } | null;
  if (d.kind !== 'action' || !prompt || prompt.kind !== 'effect_choice' || !prompt.source.data?.install || !a || a.type !== 'RESOLVE_PROMPT') return;
  const cardId = String(prompt.source.data.cardId ?? '');
  const card = s.corp.hq.find(c => c.instanceId === cardId);
  const target = a.choice?.optionId;
  if (!card || !target) return;
  out.place.prompts++;
  // The rewriters on a main-phase install to the prompt's target (they skip prompts today: isCorpMain)
  const view: GameState = { ...s, pendingPrompts: [] };
  const install = (target === 'new' || target === 'new-remote' ? { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: cardId, asNewRemote: true } : { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: cardId, targetServerId: target }) as GameAction;
  const moved = asSide('corp', () => centralIce(view, install) ?? iceRedirect(view, install) ?? assetPartner(view, install));
  if (moved) {
    out.place.promptsDiffer++;
    if (out.place.promptExamples.length < 30) out.place.promptExamples.push(`${where(d)} ${cardDef(card).title}: prompt ${target}, the rewriters ${dest(moved as Install)}`);
  }
}

forEachRecorded({
  arm: agent => arm(agent),
  decision: d => {
    for (const f of [holdTable, rezTable, belowTable, poolsTable, rankingTables, promptTable]) {
      try {
        f(d);
      } catch (e) {
        console.error(`${f.name} at ${where(d)}: ${(e as Error).message}`);
      }
    }
    clearCaches();
  },
});
console.log(JSON.stringify(out));
