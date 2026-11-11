/**
 * Remote steals look (AI Coordinator, 2026-11-11; read-only, decides whether money or placement is specced next). Plays
 * the game-0 deals with the shipped AI (Normal v Normal, beta 5715b08 behaviour: plannerSkip off) and records every
 * agenda the Runner steals from a remote (rule 7.1: accessed, 7.2.1 stolen), classified by how it got there:
 *  A  the Corp held a two-turn line on it (corpAI heldLine names it) at the start of the Runner's turn of the steal:
 *     the count said the server holds; the Runner's actual turn is compared with runnerBudget (countedScore.ts);
 *  B  no held line then, and the Corp advanced it (or installed it while the count had no line for it);
 *  C  never advanced, no line: a bare install.
 * Per steal: points, counters lost, the Corp's credits at the install, the ice on the server (rezzed of total), and the
 * money case at the Runner's turn start (ice in HQ, the Corp's credits, the cheapest such ice's install + rez).
 * One JSON line per deal on stdout; scripts/remote-steals-sum.mjs sums them.
 *
 *   SEEDS=1001,1011 npx vite-node scripts/remote-steals-look.ts
 */
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, rezCostOf } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { HeldLine, runnerBudget, scoreInTwo } from '../src/ai/countedScore';
import { iceCreditNeed } from '../src/ai/runs';
import { valueLoops } from '../src/ai/valueModel';
import { tuning } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

(tuning.plan as Record<string, unknown>).plannerSkip = false;
(tuning.plan as Record<string, unknown>).threatHqKey = false; // planner-speed P2 work in progress: off, as on 5715b08
(tuning.plan as Record<string, unknown>).threatCacheCap = false;
(tuning.plan as Record<string, unknown>).threatRdKey = 0;
(tuning.plan as Record<string, unknown>).threatLeanKey = false;
(tuning.plan as Record<string, unknown>).workCap5 = process.env.CAP5 === '1';
(tuning.plan as Record<string, unknown>).workCap10 = process.env.CAP10 === '1';
(tuning.plan as Record<string, unknown>).threatNoAveraging = false;
(tuning.plan as Record<string, unknown>).threatRdPool = false;

const title = (c: CardInstance) => cardDef(c).title;
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
const isIce = (c: CardInstance) => cardDef(c).type_code === 'ice';
const BLOCKED = 1e6;

interface AgendaRec {
  id: string;
  title: string;
  installTurn: number;
  installCredits: number;
  installLine: boolean;
  /** scoreInTwo at the install decision: a line for this agenda, for another, or none */
  countAtInstall: 'this' | 'other' | 'none';
  advances: { turn: number; line: boolean }[];
}

interface Steal {
  turn: number;
  agenda: string;
  points: number;
  counters: number;
  server: string;
  ice: number;
  rezzed: number;
  cls: 'A' | 'B' | 'C';
  installTurn: number;
  installCredits: number;
  installLine: boolean;
  countAtInstall: string;
  advances: number;
  advancesOnLine: number;
  hqIce: number;
  corpCreditsAtRunnerStart: number;
  cheapestHqIce: number | null;
  money: 'no ice in HQ' | 'could not afford' | 'could afford';
  // The Runner's turn (class A reads these)
  budget: number;
  creditsAtStart: number;
  creditsAtRun: number;
  creditsAfter: number;
  clicksAtRun: number;
  clicksAfter: number;
  needStart: number | 'BLOCK';
  needAtRun: number | 'BLOCK';
  gains: Record<string, number>;
  installedThisTurn: string[];
  runsBefore: string[];
  why?: string;
}

const need = (s: GameState, serverId: string): number => {
  let n = 0;
  for (const c of s.corp.servers[serverId]?.ice ?? []) if (c.isRezzed) n += iceCreditNeed(s, c);
  return n;
};
const show = (n: number) => (n >= BLOCKED ? 'BLOCK' : Math.round(n * 10) / 10);

function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  const start = createInitialGameState(deckGameSetup(seed, c, r));
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  const heldOf = () => (corp as unknown as { heldLine: HeldLine | null }).heldLine;
  const agendas = new Map<string, AgendaRec>();
  const steals: Steal[] = [];

  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = (s: GameState) => {
    const a = choose(s);
    const id = (a as { cardInstanceId?: string }).cardInstanceId;
    const held = heldOf();
    const onLine = (x: string) => !!held && held.game === s.id && held.line.agendaId === x;
    if (a.type === 'INSTALL_CARD' && id) {
      const card = s.corp.hq.find(x => x.instanceId === id);
      const target = (a as { targetServerId?: string }).targetServerId;
      if (card && isAgenda(card) && (!target || target.startsWith('remote'))) {
        const line = asSide('corp', () => (decisionContext(s, 'corp'), scoreInTwo(s)));
        agendas.set(id, { id, title: title(card), installTurn: s.turnNumber, installCredits: s.corp.credits, installLine: onLine(id), countAtInstall: line ? (line.agendaId === id ? 'this' : 'other') : 'none', advances: [] });
      }
    }
    if (a.type === 'ADVANCE_CARD' && id && agendas.has(id)) agendas.get(id)!.advances.push({ turn: s.turnNumber, line: onLine(id) });
    return a;
  };
  let lastRunner: GameAction | null = null;
  const chooseR = runner.chooseAction.bind(runner);
  runner.chooseAction = (s: GameState) => (lastRunner = chooseR(s));

  // The Runner's turn as it goes
  let turn: { start: GameState; budget: number; corpHeld: HeldLine | null; gains: Record<string, number>; installed: string[]; runs: string[] } | null = null;
  let run: { at: GameState; server: string } | null = null;
  let prev: GameState = start;
  const game = new GameRunner(start, { corp, runner });
  const label = (a: GameAction | null, s: GameState): string => {
    if (!a) return 'other';
    const id = (a as { cardInstanceId?: string }).cardInstanceId;
    const all = [...s.runner.grip, ...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources, s.runner.identity];
    const card = id ? all.find(x => x.instanceId === id) : undefined;
    if (s.activeRun) return `during run (${s.activeRun.server})`;
    return card ? `${a.type} ${title(card)}` : a.type;
  };
  const step = (s: GameState) => {
    // Runner turn start
    if (s.activePlayer === 'runner' && prev.activePlayer !== 'runner') {
      turn = { start: s, budget: runnerBudget(s), corpHeld: heldOf() ? { ...heldOf()! } : null, gains: {}, installed: [], runs: [] };
    }
    if (s.activePlayer !== 'runner') turn = s.activePlayer === 'corp' ? null : turn;
    if (turn && s.activePlayer === 'runner') {
      const d = s.runner.credits - prev.runner.credits;
      if (d > 0) {
        const k = label(lastRunner, prev);
        turn.gains[k] = (turn.gains[k] ?? 0) + d;
      }
      const before = new Set([...prev.runner.rig.programs, ...prev.runner.rig.hardware, ...prev.runner.rig.resources].map(x => x.instanceId));
      for (const x of [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources]) if (!before.has(x.instanceId)) turn.installed.push(title(x));
      if (s.activeRun && !prev.activeRun) {
        run = { at: s, server: s.activeRun.server };
        turn.runs.push(s.activeRun.server);
      }
    }
    // Steals from a remote
    const had = new Set(prev.runner.scoreArea.map(x => x.instanceId));
    for (const x of s.runner.scoreArea) {
      if (had.has(x.instanceId) || !isAgenda(x)) continue;
      const from = Object.values(prev.corp.servers).find(v => v.isRemote && v.root.some(y => y.instanceId === x.instanceId));
      if (!from) continue;
      const was = from.root.find(y => y.instanceId === x.instanceId)!;
      const rec = agendas.get(x.instanceId);
      const t = turn as typeof turn;
      const held = t?.corpHeld;
      const onLine = !!held && held.line.agendaId === x.instanceId;
      const advanced = (rec?.advances.length ?? 0) > 0 || was.advancementCounters > 0;
      const cls: Steal['cls'] = onLine ? 'A' : advanced || rec?.countAtInstall === 'this' ? 'B' : 'C';
      const ts = t?.start ?? prev;
      const hqIce = ts.corp.hq.filter(isIce);
      const installCost = (ts.corp.servers[from.id]?.ice.length ?? 0);
      const cheapest = hqIce.length ? Math.min(...hqIce.map(i => rezCostOf(ts, i) + installCost)) : null;
      const ra = run && run.server === from.id ? run.at : prev;
      // need with the ice as rezzed at the steal, the rig at the turn start / at the run's start
      const iceNow = from.ice;
      const withIce = (b: GameState): GameState => ({ ...b, corp: { ...b.corp, servers: { ...b.corp.servers, [from.id]: { ...b.corp.servers[from.id], ice: iceNow } } } });
      const ns = t ? need(withIce(ts), from.id) : 0;
      const nr = need(withIce(ra), from.id);
      const st: Steal = {
        turn: s.turnNumber, agenda: title(x), points: cardDef(x).agenda_points ?? 0, counters: was.advancementCounters, server: from.id,
        ice: from.ice.length, rezzed: from.ice.filter(i => i.isRezzed).length, cls,
        installTurn: rec?.installTurn ?? -1, installCredits: rec?.installCredits ?? -1, installLine: !!rec?.installLine, countAtInstall: rec?.countAtInstall ?? '?',
        advances: rec?.advances.length ?? 0, advancesOnLine: rec?.advances.filter(v => v.line).length ?? 0,
        hqIce: hqIce.length, corpCreditsAtRunnerStart: ts.corp.credits, cheapestHqIce: cheapest,
        money: !hqIce.length ? 'no ice in HQ' : cheapest! > ts.corp.credits ? 'could not afford' : 'could afford',
        budget: t?.budget ?? -1, creditsAtStart: ts.runner.credits, creditsAtRun: ra.runner.credits, creditsAfter: s.runner.credits,
        clicksAtRun: ra.runner.clicks, clicksAfter: s.runner.clicks,
        needStart: show(ns) as number | 'BLOCK', needAtRun: show(nr) as number | 'BLOCK',
        gains: { ...(t?.gains ?? {}) }, installedThisTurn: [...(t?.installed ?? [])], runsBefore: (t?.runs ?? []).slice(0, -1),
      };
      if (cls === 'A') {
        const spent = ra.runner.credits - s.runner.credits;
        if (nr < ns) st.why = 'rig changed that turn (breaker installed)';
        else if (t && t.budget >= ns) st.why = 'budget covered the need at turn start (line held anyway)';
        else if (ra.runner.credits > t!.budget) st.why = 'money beyond runnerMoney before the run';
        else if (spent < nr) st.why = ra.runner.clicks - s.runner.clicks > 0 ? 'paid less than iceCreditNeed (clicks spent in the run)' : 'paid less than iceCreditNeed';
        else st.why = 'other';
      }
      steals.push(st);
    }
    if (!s.activeRun) run = null;
    prev = s;
  };
  for (let i = 0; i < 6000; i++) {
    step(game.state);
    if (!game.step()) break;
  }
  step(game.state);
  return { seed, corp: c.name, runner: r.name, winner: game.state.winner ?? null, steals };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) console.log(JSON.stringify(playDeal(seed)));
