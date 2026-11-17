/**
 * Stage D item 1 follow-up 3, step 1 (followup3-run-answers/brief.md section 2; found-list row 13): the Corp's prompt
 * answers during a run whose options differ in whether the run goes on ("trash 1 installed program or end the run" on
 * Ballista; the Corp's reveal under Shred; every "X or end the run"), against the answer the hold walk assumes.
 * Scripts only: nothing under src/ is changed; the arm is a wrapper around the Corp agent.
 *
 * Sources: the 56 local deals (seeds 1001 + 40k, played by Normal v Normal with the harness's cache clearing) and every
 * human game in tests/fixtures/human-games/ (the recorded moves replayed; a fresh Normal agent of the side asked at each
 * prompt during a run). DEALS= / HUMAN= pick as in scripts/stage-a/harness.ts; SHARD=k/n takes every n-th source.
 *
 * At each prompt during a run (either side), every legal answer is simulated and its chain settled: later prompts of the
 * same run answered by the Corp's best keep-out answer (the arm, recursively, depth 2) and by the Runner's answerPrompt.
 * Each answer is then judged by the hold owner: run over and not successful = out; breached or no ice left = in;
 * otherwise serverHold(when 'thisRun') from where the run stands (`out` when it holds). The walk counts from the approach
 * of an ice, so the script adapts the state it asks on, as the build's hold entry would have to: the subroutines already
 * resolved in the encounter under way are marked broken; in the Movement Phase the walk starts at the next ice inward;
 * an unrezzed approached ice is asked both rezzed (mustRez) and not. The family: the answers differ in whether the run
 * goes on (after the chain); "separating": they differ in whether the Runner gets in.
 *
 * Per decision (JSON line, kind 'dec'): the options and their judgements, the answer given (the agent's), the walk's
 * answer (arm), the cause when they disagree: (i) the chain (with the chain settled, today's score would prefer the walk's
 * answer) or (ii) the score (it prefers the given answer either way); what followed in the game (breach, steal, game end).
 * Deals are played a second time with the arm Corp (kind 'arm'): each changed decision and what followed it. Per source a
 * kind 'src' line: counts, hold asks, time. Sum with run-answers-sum.mjs.
 *
 * ARGS: TREE=<40-char sha> runs the src/ of that commit (fetched, `git archive`d into .ra-tree/<sha>/): the walk of an
 * unmerged branch (ai-hold-trash) with this script. NOARM=1 skips the arm's second play of the deals.
 *   DEALS=1601 HUMAN=none npx vite-node scripts/stage-d/run-answers.ts
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState, Prompt, SideCode } from '../../src/core';
import type { Agent } from '../../src/ai/agent';

const ARGS = `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`;
const treeSha = /TREE=([0-9a-f]{40})/.exec(ARGS)?.[1];
const NOARM = /NOARM=1/.test(ARGS);

function treeRoot(): string {
  if (!treeSha) return resolve('.');
  const dir = resolve('.ra-tree', treeSha);
  if (existsSync(join(dir, 'src', 'core', 'index.ts'))) return dir;
  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  for (let k = 0; ; k++) {
    try {
      execSync(`git cat-file -e ${treeSha}^{commit}`, { stdio: 'ignore' });
      break;
    } catch {
      if (k >= 10) throw new Error(`run-answers: could not fetch ${treeSha}`);
      try {
        execSync(`git fetch -q --depth=1 origin ${treeSha}`, { stdio: 'ignore' });
      } catch {
        sleep(500 + Math.floor(Math.random() * 1500));
      }
    }
  }
  // Four processes share a runner's checkout: each extracts into its own temporary folder, then renames
  const tmp = `${dir}.${process.pid}`;
  mkdirSync(tmp, { recursive: true });
  execSync(`git archive ${treeSha} src | tar -x -C ${tmp}`);
  try {
    execSync(`mv ${tmp} ${dir}`, { stdio: 'ignore' });
  } catch {
    execSync(`rm -rf ${tmp}`);
  }
  return dir;
}

/**
 * PROBE=1: a copy of the tree with one counter in the fallback of answerPrompt (every Corp call during a run, at the top
 * and inside the planner's reply and playouts, and its options): what the family answer would be asked, for the time
 * count (brief 3.6). The copy is the only change; play is the tree's.
 */
function probeRoot(root: string): string {
  const dir = resolve('.ra-tree', `probe-${process.pid}`);
  execSync(`rm -rf ${dir} && mkdir -p ${dir} && cp -r ${join(root, 'src')} ${dir}/src`);
  const file = join(dir, 'src', 'ai', 'prompts.ts');
  const text = readFileSync(file, 'utf8');
  const from = '  const options = answers(state, side, synergy);\n';
  if (text.split(from).length !== 2) throw new Error('run-answers: the probe does not match once');
  const to = `${from}  if (side === 'corp' && state.activeRun) { const g = globalThis as unknown as { __raCalls?: number; __raOpts?: number }; g.__raCalls = (g.__raCalls ?? 0) + 1; g.__raOpts = (g.__raOpts ?? 0) + options.length; }\n`;
  writeFileSync(file, text.replace(from, to));
  return dir;
}
const PROBE = /PROBE=1/.test(ARGS);
const R = PROBE ? probeRoot(treeRoot()) : treeRoot();
const G = globalThis as unknown as { __raCalls?: number; __raOpts?: number };
const probeNow = () => ({ calls: G.__raCalls ?? 0, opts: G.__raOpts ?? 0 });
const m = (p: string) => import(/* @vite-ignore */ join(R, 'src', p));
const core = await m('core/index.ts');
const ai = await m('ai/index.ts');
const prompts = await m('ai/prompts.ts');
const holdM = await m('ai/corp/hold.ts');
const pools = await m('ai/corp/pools.ts');
const planner = await m('ai/turnPlanner.ts');
const decks = await m('data/decks.ts');
const testDecks = await m('data/testDecks/nsgSamples.ts');
const hv = await m('ai/handValues.ts');
const ev = await m('ai/effectValues.ts');
const vm = await m('ai/valueModel.ts');

const { activePrompt, actingSide, createInitialGameState, executeAction, getLegalActions } = core;
const clearCaches = () => {
  hv.clearHandCaches();
  ev.clearDamageThreats();
};

// ---- the judgement --------------------------------------------------------------------------------------------------

type Out = 'in' | 'out' | 'unknown';
let holdAsks = 0;

/** Whether the Runner gets in on the run under way at `s` (a settled state: no prompt left, or the chain cut). */
function judge(s: GameState, server: string): Out {
  if (s.winner) return s.winner === 'runner' ? 'in' : 'out';
  const run = s.activeRun;
  if (!run) {
    const last = s.runsThisTurn[s.runsThisTurn.length - 1];
    return last?.server === server && last.successful ? 'in' : 'out';
  }
  if (run.server !== server) return 'unknown';
  if (activePrompt(s) && (activePrompt(s) as Prompt).side === 'corp') return 'unknown';
  if (run.breached || run.isSuccessful || run.phase === 'access' || run.phase === 'approach_server') return 'in';
  const sv = s.corp.servers[server];
  if (!sv) return 'out';
  let view = s;
  let from: number;
  let approached: string | undefined;
  if (run.phase === 'movement') {
    from = (run.icePosition ?? 0) - 1;
    if (run.icePosition === null) from = -1;
  } else if (run.phase === 'encounter_ice' && run.encounter) {
    from = run.icePosition ?? -1;
    const at = run.encounter.resolvingIndex;
    if (at !== null && at > 0) {
      view = structuredClone(s);
      const e = view.activeRun!.encounter!;
      e.broken = e.broken.map((b: boolean, i: number) => b || i < at);
    }
  } else {
    // initiation or approach: from the approached ice (initiation: the outermost)
    from = run.icePosition ?? sv.ice.length - 1;
    const ice = sv.ice[from];
    if (ice && !ice.isRezzed) approached = ice.instanceId;
  }
  if (process.env.RA_DEBUG) console.error("judge", run.phase, run.icePosition, from, sv.ice.map(c => c.cardCode + (c.isRezzed ? "*" : "")).join(","), s.runner.credits, s.runner.clicks);
  if (from < 0) return 'in';
  const ask = (mustRez?: string[]) => {
    holdAsks++;
    return holdM.serverHold(view, server, { when: 'thisRun', from, mustRez }).holds as boolean;
  };
  const holds = ask() || (approached !== undefined && ask([approached]));
  return holds ? 'out' : 'in';
}

const isPrompt = (a: GameAction) => a.type === 'RESOLVE_PROMPT';
const options = (s: GameState, side: SideCode): GameAction[] => (getLegalActions(s, side) as GameAction[]).filter(isPrompt).slice(0, 200);
const label = (s: GameState, a: GameAction): string => {
  if (a.type !== 'RESOLVE_PROMPT') return a.type;
  const c = a.choice as Record<string, unknown>;
  if (c.kind === 'effect_choice') return String(c.optionId);
  if (c.kind === 'effect_cards') return `cards:${((c.cardInstanceIds as string[]) ?? []).map(id => core.cardDef(core.findCardAnywhere(s, id)!).title).join('+') || 'none'}`;
  return JSON.stringify(c).slice(0, 60);
};
const same = (a: GameAction | null, b: GameAction | null) => JSON.stringify(a) === JSON.stringify(b);

/** The chain after an answer: later prompts of the same run, the Corp's by `corpPick`, the Runner's by answerPrompt. */
function settle(s: GameState, corpPick: (s: GameState) => GameAction, depth = 8): GameState {
  let cur = s;
  for (let d = 0; d < depth; d++) {
    const p = activePrompt(cur) as Prompt | undefined;
    if (!p || cur.winner || !cur.activeRun) break;
    const a = p.side === 'corp' ? corpPick(cur) : prompts.answerPrompt(cur, 'runner', undefined, true);
    const nx = prompts.simulate(cur, a);
    if (!nx) break;
    cur = nx;
  }
  return cur;
}

interface Opt {
  action: GameAction;
  id: string;
  after: GameState;
  /** Chain settled by the Corp's keep-out answers. */
  best: GameState;
  goesOn: boolean;
  out: Out;
}

const today = (s: GameState) => prompts.answerPrompt(s, 'corp', undefined, true) as GameAction;

/** Every answer of `side`'s prompt, settled and judged. */
function judgeOptions(s: GameState, side: SideCode, depth: number): Opt[] {
  const server = s.activeRun!.server;
  const out: Opt[] = [];
  for (const action of options(s, side)) {
    const after = prompts.simulate(s, action);
    if (!after) continue;
    const best = settle(after, x => (depth > 0 ? armPick(x, depth - 1).action : today(x)));
    // The run goes on unless it is over without a breach (a breach finished inside the chain is the run going on)
    const lastRun = best.runsThisTurn[best.runsThisTurn.length - 1];
    const goesOn = best.winner ? best.winner === 'runner' : !!best.activeRun || !!lastRun?.successful;
    out.push({ action, id: label(s, action), after, best, goesOn, out: judge(best, server) });
  }
  return out;
}

/**
 * The arm: the Corp's answer after which the walk says the Runner does not get in, when exactly that separates the
 * options (several such: today's score among them, as the fallback scores: one step, scoreOutcome + freeRezSaving);
 * otherwise today's answer.
 */
function armPick(s: GameState, depth = 2): { action: GameAction; sep: boolean; opts?: Opt[]; asks?: number; ms?: number } {
  const p = activePrompt(s) as Prompt | undefined;
  if (!p || p.side !== 'corp' || !s.activeRun) return { action: today(s), sep: false };
  const opts = judgeOptions(s, 'corp', depth);
  const outs = opts.filter(o => o.out === 'out');
  if (outs.length === 0 || !opts.some(o => o.out === 'in')) return { action: today(s), sep: false, opts };
  const score = (o: Opt) => prompts.scoreOutcome(s, o.after, 'corp', undefined, true) + prompts.freeRezSaving(s, o.after);
  const pick = outs.reduce((a, b) => (score(b) > score(a) ? b : a));
  return { action: pick.action, sep: true, opts };
}

/** armPick at the top: its hold asks and time recorded on the answer. */
function armTop(s: GameState) {
  const a0 = holdAsks;
  const t = performance.now();
  const a = armPick(planner.corpDecisionView(s));
  return { ...a, asks: holdAsks - a0, ms: performance.now() - t };
}

// ---- per decision ---------------------------------------------------------------------------------------------------

interface Watch {
  rec: Record<string, unknown>;
  turn: number;
  server: string;
  score: number;
}

/** A prompt during a run: record it if its answers differ in whether the run goes on. */
function inspect(src: string, i: number, s: GameState, side: SideCode, given: GameAction, ms: number, arm?: { action: GameAction; sep: boolean; opts?: Opt[]; asks?: number; ms?: number }): Record<string, unknown> | null {
  const p = activePrompt(s) as Prompt;
  const t = performance.now() - (arm?.ms ?? 0);
  const asks0 = holdAsks - (arm?.asks ?? 0);
  const a = side === 'corp' ? (arm ?? armPick(s)) : undefined;
  const opts = a?.opts ?? judgeOptions(s, side, 2);
  const judgeMs = performance.now() - t;
  const family = new Set(opts.map(o => o.goesOn)).size > 1;
  const separating = opts.some(o => o.out === 'in') && opts.some(o => o.out === 'out');
  if (!family && !separating) return null;
  const g = opts.find(o => same(o.action, given));
  const gid = g?.id ?? label(s, given);
  const rec: Record<string, unknown> = {
    kind: 'dec',
    src,
    i,
    side,
    turn: s.turnNumber,
    server: s.activeRun!.server,
    card: 'source' in p ? `${p.source.cardCode}:${core.cardDef(core.findCardAnywhere(s, p.source.instanceId) ?? { cardCode: p.source.cardCode }).title ?? ''}` : p.kind,
    step: 'source' in p ? p.source.step : undefined,
    shred: !!s.activeRun!.shredArmed,
    family,
    separating,
    options: opts.map(o => ({ id: o.id, goesOn: o.goesOn, out: o.out, pending: !!activePrompt(o.after) && !!o.after.activeRun })),
    given: gid,
    givenOut: g?.out ?? 'unknown',
    ms: Math.round(ms),
    judgeMs: Math.round(judgeMs),
    holdAsks: holdAsks - asks0,
  };
  if (side === 'corp' && a) {
    const w = opts.find(o => same(o.action, a.action));
    rec.walk = a.sep ? w?.id : null;
    rec.disagree = a.sep && g?.out === 'in';
    if (a.sep) {
      // Variant (reported, not the arm): today's one-step score, less the Corp's run loss (pools.ts runLoss, the owner
      // rez.ts's LEO answer reads) for an answer after which the walk lets the Runner in
      const loss = pools.runLoss(s) as number;
      const priced = (o: Opt) => prompts.scoreOutcome(s, o.after, 'corp', undefined, true) + prompts.freeRezSaving(s, o.after) - (o.out === 'in' ? loss : 0);
      const pv = opts.filter(o => o.out !== 'unknown').reduce((x, y) => (priced(y) > priced(x) ? y : x));
      rec.priced = pv.id;
      rec.pricedOut = pv.out;
      rec.runLoss = Math.round(loss * 10) / 10;
    }
    if (rec.disagree && g && w) {
      // The cause: today's one-step score, and the same score with each chain settled
      const one = (o: Opt) => prompts.scoreOutcome(s, o.after, 'corp', undefined, true) + prompts.freeRezSaving(s, o.after);
      const full = (o: Opt) => prompts.scoreOutcome(s, o.best, 'corp', undefined, true) + prompts.freeRezSaving(s, o.best);
      rec.score = { given: [one(g), full(g)].map(x => Math.round(x * 10) / 10), walk: [one(w), full(w)].map(x => Math.round(x * 10) / 10) };
      rec.cause = full(w) > full(g) ? 'i-chain' : 'ii-score';
      rec.walkPending = !!activePrompt(w.after) && !!w.after.activeRun;
    }
  } else {
    // The Runner's side, reported only: did it end a run it could get through, or go on into one it cannot
    rec.endsWhereIn = g?.out === 'out' && opts.some(o => o.out === 'in');
    rec.goesOnWhereOut = g?.out === 'in' ? false : g?.goesOn === true && opts.every(o => o.out !== 'in');
  }
  return rec;
}

function track(watches: Watch[], s: GameState, prev: GameState) {
  for (const w of [...watches]) {
    const f = (w.rec.followed ??= { breach: false, steal: false, end: null }) as { breach: boolean; steal: boolean; end: string | null };
    const run = s.activeRun;
    if (run && run.server === w.server && (run.breached || run.isSuccessful)) f.breach = true;
    if (s.runner.score > w.score) f.steal = true;
    if (s.winner) f.end = s.winner;
    const prevRun = prev.activeRun;
    if (s.winner || s.turnNumber !== w.turn || (!run && prevRun)) {
      if (!run && prevRun) {
        const last = s.runsThisTurn[s.runsThisTurn.length - 1];
        if (last?.server === w.server && last.successful) f.breach = true;
      }
      watches.splice(watches.indexOf(w), 1);
      console.log(JSON.stringify(w.rec));
    }
  }
}

// ---- sources --------------------------------------------------------------------------------------------------------

const ALL_DECKS = [...decks.STARTER_DECKS, ...testDecks.NSG_SAMPLE_DECKS];
const DEFAULT_DEALS = Array.from({ length: 56 }, (_, k) => 1001 + 40 * k);
function dealState(seed: number): GameState {
  const corpDecks = ALL_DECKS.filter((d: { side: string }) => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter((d: { side: string }) => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  return createInitialGameState(decks.deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length]));
}
const envList = (k: string) => (process.env[k] ?? '').split(',').filter(Boolean);
const dealList = envList('DEALS').includes('none') ? [] : envList('DEALS').length ? envList('DEALS').map(Number) : DEFAULT_DEALS;
const humanList = (() => {
  const want = envList('HUMAN');
  if (want.includes('none')) return [];
  const dir = 'tests/fixtures/human-games';
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .filter(f => !want.length || want.some(w => f.startsWith(w)))
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
    .map(f => join(dir, f));
})();

/** One deal played out; `armed`: the Corp answers family prompts with the arm. */
function playDeal(seed: number, armed: boolean) {
  vm.valueLoops?.clear();
  const src = `deal:${seed}`;
  const corpInner: Agent = ai.createAgent('corp', 'normal');
  const runnerInner: Agent = ai.createAgent('runner', 'normal');
  const counter = { corp: 0, runner: 0, prompts: 0, family: 0, sep: 0, disagree: 0, changed: 0 };
  const watches: Watch[] = [];
  const asks0 = holdAsks;
  let armMs = 0;
  let corpMs = 0;
  let agentCalls = 0;
  let agentOpts = 0;
  const t0 = performance.now();
  const corp: Agent = {
    side: 'corp',
    chooseAction(state: GameState) {
      clearCaches();
      const i = counter.corp++;
      const p = activePrompt(state) as Prompt | undefined;
      const inRun = !!p && p.side === 'corp' && !!state.activeRun;
      const t = performance.now();
      const q0 = probeNow();
      const given = corpInner.chooseAction(state);
      const ms = performance.now() - t;
      corpMs += ms;
      agentCalls += probeNow().calls - q0.calls;
      agentOpts += probeNow().opts - q0.opts;
      if (!inRun) return given;
      counter.prompts++;
      const a = armTop(state);
      armMs += a.ms;
      const chosen = armed && a.sep && core.isLegalAction(state, a.action) ? a.action : given;
      if (!armed) {
        const rec = inspect(src, i, state, 'corp', given, ms, a);
        if (rec) {
          counter.family++;
          if (rec.separating) counter.sep++;
          if (rec.disagree) counter.disagree++;
          watches.push({ rec, turn: state.turnNumber, server: state.activeRun!.server, score: state.runner.score });
        }
      } else if (!same(chosen, given)) {
        counter.changed++;
        const rec = { kind: 'arm', src, i, turn: state.turnNumber, server: state.activeRun!.server, card: 'source' in p! ? p!.source.cardCode : '', given: label(state, given), arm: label(state, chosen), options: a.opts?.map(o => ({ id: o.id, out: o.out })) };
        watches.push({ rec, turn: state.turnNumber, server: state.activeRun!.server, score: state.runner.score });
      }
      return chosen;
    },
    chooseRez(state: GameState, cards: unknown[]) {
      clearCaches();
      counter.corp++;
      const t = performance.now();
      const q0 = probeNow();
      const r = corpInner.chooseRez?.(state, cards as never) ?? null;
      agentCalls += probeNow().calls - q0.calls;
      agentOpts += probeNow().opts - q0.opts;
      corpMs += performance.now() - t;
      return r;
    },
  } as Agent;
  const runner: Agent = {
    side: 'runner',
    chooseAction(state: GameState) {
      clearCaches();
      const i = counter.runner++;
      const p = activePrompt(state) as Prompt | undefined;
      const t = performance.now();
      const q0 = probeNow();
      const given = runnerInner.chooseAction(state);
      const ms = performance.now() - t;
      agentCalls += probeNow().calls - q0.calls;
      agentOpts += probeNow().opts - q0.opts;
      if (!armed && p && p.side === 'runner' && state.activeRun) {
        const rec = inspect(src, i, state, 'runner', given, ms);
        if (rec) watches.push({ rec, turn: state.turnNumber, server: state.activeRun!.server, score: state.runner.score });
      }
      return given;
    },
    chooseOffTurn(state: GameState) {
      clearCaches();
      return runnerInner.chooseOffTurn?.(state) ?? null;
    },
  } as Agent;
  const game = new ai.GameRunner(dealState(seed), { corp, runner });
  for (let n = 0; n < 4000; n++) {
    const prev = game.state;
    if (!game.step()) break;
    track(watches, game.state, prev);
  }
  for (const w of watches) console.log(JSON.stringify(w.rec));
  const s = game.state;
  console.log(JSON.stringify({ kind: 'src', src, play: armed ? 'arm' : 'base', winner: s.winner ?? null, turns: s.turnNumber, score: [s.corp.score, s.runner.score], ...counter, holdAsks: holdAsks - asks0, armMs: Math.round(armMs), corpMs: Math.round(corpMs), probeCalls: agentCalls, probeOpts: agentOpts, ms: Math.round(performance.now() - t0) }));
}

/** One human game's recorded moves; at each prompt during a run a fresh Normal agent of that side is asked. */
function replayHuman(file: string) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const src = `human:${file.split('/').pop()}`;
  if (!report.moves?.length) return;
  vm.valueLoops?.clear();
  let s: GameState = createInitialGameState(decks.deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const counter = { corp: 0, runner: 0, prompts: 0, family: 0, sep: 0, disagree: 0, changed: 0 };
  const watches: Watch[] = [];
  const asks0 = holdAsks;
  let armMs = 0;
  const t0 = performance.now();
  for (const move of report.moves as GameAction[]) {
    const side = actingSide(s) as SideCode | null;
    const p = activePrompt(s) as Prompt | undefined;
    if (side && !s.winner && p && p.side === side && s.activeRun && move.player === side) {
      clearCaches();
      const i = counter[side]++;
      try {
        const agent: Agent = ai.createAgent(side, 'normal');
        const t = performance.now();
        const given = agent.chooseAction(s);
        const ms = performance.now() - t;
        let a;
        if (side === 'corp') {
          counter.prompts++;
          a = armTop(s);
          armMs += a.ms;
        }
        const rec = inspect(src, i, s, side, given, ms, a);
        if (rec) {
          rec.recorded = label(s, move);
          rec.recordedIsGiven = same(move, given);
          if (side === 'corp') {
            counter.family++;
            if (rec.separating) counter.sep++;
            if (rec.disagree) counter.disagree++;
            if (a && a.sep && !same(a.action, given)) counter.changed++;
          }
          watches.push({ rec, turn: s.turnNumber, server: s.activeRun.server, score: s.runner.score });
        }
      } catch (e) {
        console.error(`${src} #${i}: ${(e as Error).message}`);
      }
    }
    const prev = s;
    try {
      s = executeAction(s, move);
    } catch {
      break;
    }
    track(watches, s, prev);
  }
  for (const w of watches) console.log(JSON.stringify(w.rec));
  console.log(JSON.stringify({ kind: 'src', src, play: 'human', winner: s.winner ?? null, turns: s.turnNumber, ...counter, holdAsks: holdAsks - asks0, armMs: Math.round(armMs), ms: Math.round(performance.now() - t0) }));
}

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const sources: (() => void)[] = [
  ...dealList.map(seed => () => playDeal(seed, false)),
  ...(NOARM ? [] : dealList.map(seed => () => playDeal(seed, true))),
  ...humanList.map(f => () => replayHuman(f)),
];
console.error(`run-answers: tree ${treeSha ?? 'here'}, ${sources.length} sources, shard ${shard}/${shards}`);
sources.forEach((run, k) => {
  if (k % shards === shard) run();
});
