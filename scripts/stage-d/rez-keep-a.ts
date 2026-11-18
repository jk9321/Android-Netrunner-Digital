/**
 * Stage D item 3 step 1a, part A (brief section 2 A): the toll rez that spends the money kept for the rest of the turn.
 *
 * At every Corp rez window on approached ice (the 56 local deals played by this tree's Normal AIs, and the 36 human games
 * replayed move for move with a fresh Normal Corp asked at each window, as scripts/stage-a/harness.ts), one JSON line:
 *  - the rule that answers it (rez-keep-lib ruleOf: match point, R2, R3s/R3t, R4s/R4t, the priced rez), the agent's pick;
 *  - the window's facts (windowOf): rez cost, the Corp's and Runner's credits, whether the rez is part of a set that stops
 *    the run (stopsWithFurther), the Runner's least toll and its credits after paying through, its clicks left;
 *  - keepRest: rezMoney's keep on the rest of THIS turn (restOfTurn: its clicks left, its credits after paying through)
 *    without the run's own server, and keepNext: rezMoney(state).keep ('runnerTurn': the Runner's NEXT turn);
 *  - short: the rez leaves the Corp below keepRest (credits - rezCost < keepRest), and wasEnough: it had keepRest before;
 *  - the rest of the Runner's turn after the window: every run, its server, the Corp's credits at its start, whether it
 *    breached, the points stolen, the root cards trashed, the ice on that server left unrezzed at its end.
 * The arm (ARM, on by default): a rez of the approached ice that does not stop the run (not stopsWithFurther) and is short
 * is not made: chooseRez is asked again without that ice (in an approach-ice window: no rez). Each deal is played twice,
 * base then arm, and the arm's changed windows are listed with that turn's runs in both games and both results. In the
 * human games the continuation is the recorded one; the recorded move at the window is kept beside the AI's.
 *
 * One JSON line per record on stdout (kind 'window', 'deal'); sum with rez-keep-a-sum.mjs.
 *   SHARD=0/64 npx vite-node scripts/stage-d/rez-keep-a.ts > a-0.txt     (DEALS=, HUMAN= as the harness)
 */
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, actingSide, createInitialGameState, executeAction, wantsStop } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner, rezCandidates } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { clearCaches, dealState, deals, humanFiles } from '../stage-a/harness';
import { Window, keepRest, restOfTurn, ruleOf, windowOf } from './rez-keep-lib';

interface RunRec {
  server: string;
  corpStart: number;
  runnerStart: number;
  breached: boolean;
  points: number;
  trashed: number;
  unrezzedLeft: number;
  rezzedOnRun: number;
}

interface WindowRec {
  kind: 'window';
  src: string;
  who: 'self' | 'person-runner' | 'person-corp';
  turn: number;
  rule: string;
  pick: 'rez' | 'pass';
  w: Window;
  keepRest: number;
  restBy: Record<string, number>;
  keepNext: number;
  short: boolean;
  wasEnough: boolean;
  /** The arm passes this rez (a toll rez that is short). */
  arm: boolean;
  /** The stop direction (reported only): a rez that stops the run and leaves less than keepRest. */
  stopShort: boolean;
  recorded?: 'rez' | 'pass';
  /** The runs after this window in the same Runner turn (this run's own end included as the first). */
  rest: RunRec[];
  ms: number;
}

const ARM = process.env.ARM !== '0';
const out = (o: unknown) => console.log(JSON.stringify(o));

/** The counts at one approach-ice window, before the agent's pick is known. */
function facts(state: GameState, ice: CardInstance) {
  const t = performance.now();
  const w = windowOf(state, ice);
  const { rule } = ruleOf(state, ice);
  const rest = keepRest(restOfTurn(state, w.runnerAfter, state.corp.credits - w.rezCost), w.server);
  const keepNext = rezMoney(state).keep;
  const short = w.corp - w.rezCost < rest.keep;
  return { w, rule, keepRest: rest.keep, restBy: rest.byServer, keepNext, short, wasEnough: w.corp >= rest.keep, ms: performance.now() - t };
}

const approachedIce = (state: GameState): CardInstance | undefined => {
  const run = state.activeRun;
  if (!run || run.icePosition === null || state.priority?.step !== 'approach_ice') return undefined;
  const ice = state.corp.servers[run.server]?.ice[run.icePosition];
  return ice && !ice.isRezzed ? ice : undefined;
};

const rezzes = (a: GameAction | null, ice: CardInstance) => !!a && a.type === 'REZ_CARD' && (a as { cardInstanceId?: string }).cardInstanceId === ice.instanceId;

/** Watches the Runner's runs state by state and hands each finished run to the windows still open this turn. */
class RunWatch {
  open: WindowRec[] = [];
  private run: RunRec | null = null;
  private start: GameState | null = null;
  constructor(private done: (w: WindowRec) => void) {}
  step(prev: GameState, next: GameState) {
    if (prev.activeRun && !this.run) this.begin(prev);
    if (!prev.activeRun && next.activeRun) this.begin(next);
    if (this.run && next.activeRun?.breached) this.run.breached = true;
    if (this.run && prev.activeRun && !next.activeRun) this.end(next);
    if (next.activePlayer !== 'runner' || next.winner || next.turnNumber !== prev.turnNumber) this.flush();
  }
  private begin(s: GameState) {
    const id = s.activeRun!.server;
    this.start = s;
    this.run = { server: id, corpStart: s.corp.credits, runnerStart: s.runner.credits, breached: !!s.activeRun!.breached, points: 0, trashed: 0, unrezzedLeft: 0, rezzedOnRun: 0 };
  }
  private end(s: GameState) {
    const r = this.run!;
    const before = this.start!.corp.servers[r.server];
    const after = s.corp.servers[r.server];
    r.points = s.runner.score - this.start!.runner.score;
    r.trashed = Math.max(0, (before?.root.length ?? 0) - (after?.root.length ?? 0));
    r.unrezzedLeft = after ? after.ice.filter(c => !c.isRezzed).length : 0;
    r.rezzedOnRun = after && before ? after.ice.filter(c => c.isRezzed).length - before.ice.filter(c => c.isRezzed).length : 0;
    for (const w of this.open) w.rest.push({ ...r });
    this.run = null;
    this.start = null;
  }
  flush() {
    for (const w of this.open) this.done(w);
    this.open = [];
    this.run = null;
  }
}

/** A Normal Corp whose rez window the arm may change; every window is recorded in `seen`. */
function corpAgent(src: string, who: WindowRec['who'], arm: boolean, watch: RunWatch): Agent {
  const inner = createAgent('corp', 'normal');
  return new Proxy(inner, {
    get(target, prop, recv) {
      if (prop === 'chooseAction')
        return (s: GameState) => {
          clearCaches();
          return target.chooseAction(s);
        };
      if (prop === 'chooseRez')
        return (s: GameState, cards: CardInstance[]) => {
          clearCaches();
          const ice = approachedIce(s);
          let a = target.chooseRez?.(s, cards) ?? null;
          if (!ice) return a;
          const f = facts(s, ice);
          const isRez = rezzes(a, ice);
          const armFires = isRez && !f.w.stopsWithFurther && f.short && f.keepRest > 0;
          const rec: WindowRec = { kind: 'window', src, who, turn: s.turnNumber, rule: f.rule, pick: isRez ? 'rez' : 'pass', w: f.w, keepRest: f.keepRest, restBy: f.restBy, keepNext: f.keepNext, short: f.short, wasEnough: f.wasEnough, arm: armFires, stopShort: isRez && f.w.stopsWithFurther && f.short && f.keepRest > 0, rest: [], ms: Math.round(f.ms) };
          watch.open.push(rec);
          if (arm && armFires) {
            clearCaches();
            a = target.chooseRez?.(s, cards.filter(c => c.instanceId !== ice.instanceId)) ?? null;
          }
          return a;
        };
      return Reflect.get(target, prop, recv);
    },
  });
}

function runnerAgent(): Agent {
  const inner = createAgent('runner', 'normal');
  return new Proxy(inner, {
    get(target, prop, recv) {
      if (prop === 'chooseAction')
        return (s: GameState) => {
          clearCaches();
          return target.chooseAction(s);
        };
      if (prop === 'chooseOffTurn')
        return (s: GameState) => {
          clearCaches();
          return target.chooseOffTurn?.(s) ?? null;
        };
      return Reflect.get(target, prop, recv);
    },
  });
}

/** One local deal, played by a Normal Corp with or without the arm; its windows and the end. */
function play(seed: number, arm: boolean): { windows: WindowRec[]; end: GameState } {
  valueLoops.clear();
  const windows: WindowRec[] = [];
  const watch = new RunWatch(w => windows.push(w));
  const game = new GameRunner(dealState(seed), { corp: corpAgent(`deal:${seed}`, 'self', arm, watch), runner: runnerAgent() });
  let prev = game.state;
  for (let n = 0; n < 4000 && game.step(); n++) {
    watch.step(prev, game.state);
    prev = game.state;
  }
  watch.flush();
  return { windows, end: game.state };
}

const result = (s: GameState) => ({ winner: s.winner ?? null, turn: s.turnNumber, corp: s.corp.score, runner: s.runner.score });

function deal(seed: number) {
  const base = play(seed, false);
  for (const w of base.windows) out(w);
  if (!ARM) return out({ kind: 'deal', src: `deal:${seed}`, base: result(base.end) });
  const fired = base.windows.filter(w => w.arm);
  if (!fired.length) return out({ kind: 'deal', src: `deal:${seed}`, base: result(base.end), arm: result(base.end), same: true, fired: 0 });
  const armed = play(seed, true);
  // The arm's changed windows in its own game, each with the base game's same turn (the same play up to the first)
  const changed = armed.windows.filter(w => w.arm).map(w => ({ turn: w.turn, rule: w.rule, w: w.w, keepRest: w.keepRest, restBy: w.restBy, armRest: w.rest, baseRest: base.windows.find(b => b.turn === w.turn && b.w.ice === w.w.ice)?.rest ?? null }));
  out({ kind: 'deal', src: `deal:${seed}`, base: result(base.end), arm: result(armed.end), same: false, fired: fired.length, changed });
}

/** One human game replayed: a fresh Normal Corp asked at each approach-ice window; the recorded move kept beside it. */
function human(file: string) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const src = `human:${file.split('/').pop()}`;
  if (!report.moves?.length) return;
  const who: WindowRec['who'] = report.config.ai === 'corp' ? 'person-runner' : 'person-corp';
  valueLoops.clear();
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const watch = new RunWatch(w => out(w));
  for (const move of report.moves as GameAction[]) {
    const window = s.priority;
    const ice = approachedIce(s);
    let asked: WindowRec | undefined;
    if (ice && actingSide(s) === 'corp' && !s.winner && s.pendingPrompts.length === 0 && window?.holder === 'corp' && s.activePlayer === 'runner' && wantsStop({ ...s, stops: { corp: 'ai', runner: 'ai' } }, 'corp', window)) {
      try {
        corpAgent(src, who, false, watch).chooseRez!(s, rezCandidates(s, 'approach_ice'));
        asked = watch.open[watch.open.length - 1];
      } catch (e) {
        console.error(`${src}: ${(e as Error).message}`);
      }
    }
    if (asked && ice) asked.recorded = rezzes(move, ice) ? 'rez' : 'pass';
    let next: GameState;
    try {
      next = executeAction(s, move);
    } catch {
      break;
    }
    watch.step(s, next);
    s = next;
  }
  watch.flush();
}

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const sources: (() => void)[] = [...deals().map(seed => () => deal(seed)), ...humanFiles().map(f => () => human(f))];
sources.forEach((run, k) => {
  if (k % shards !== shard) return;
  try {
    run();
  } catch (e) {
    console.error(`source ${k}: ${(e as Error).stack}`);
  }
});
