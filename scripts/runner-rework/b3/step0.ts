/**
 * B3 step 0 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b3-prompt-view.md rev 2), parts 0.2 to 0.5, on the
 * g1 base (45716865309, 221 deals) and the NRDB g1 base (45721175528, 110 deals) at beta 12ee4b4's src (beta 8005562 has
 * the same src). Measurement only: no src change, nothing decided. Notes: runner-rework/b3/step0.md.
 *
 * The source tree (trees.ts) plays each deal by a plain GameRunner, Normal v Normal, and is never asked or cleared
 * mid-game. Every question is asked of the arm trees on a structuredClone of the board, with a fresh agent given a copy
 * of the source Runner's memory (HIDDEN-READ: the measuring script reads that memory; no agent reads another's).
 *
 * Lines (JSON, one per record; sums in step0-sum.mjs):
 *  'pc'  per game: every Runner prompt the deciding Runner answers, counted by kind | source:step | promptAnswer's branch
 *        (given, view, real:named, real:illegal) | in a run or not                                                     (0.2)
 *  'p'   a real-state answer: today's answer, the honest view's answer on a scratch view (the dealt view, with MuslihaT's
 *        top card put back on top of the view's stack: the in-place class), whether it is legal on the real state and
 *        differs from today's, the classes of the cards the prompt names (shown: a stack card a search lists, a card
 *        installed from a hidden zone; inPlace: MuslihaT's top card; named: facedown Corp cards), and the view answer on 12
 *        deals of the same knowledge (guessRunnerView samples 4096..4107, the same in-place step)                     (0.2)
 *  'hp'  a host prompt (installRunnerChoice: data.cardId + options all ice) answered by the deciding Runner, per arm: each
 *        host's board term (the installed copy's counterWorth) and try-each score on the real state and on the view, the
 *        pick; the hosts' public facts (rezzed, known, what each hosts)                                              (0.3)
 *  'ia'  a deciding-Runner main-phase board with a legal trojan install on ice, per arm: the ranking's first action and
 *        the best trojan install (its host, rank, score), and the decision's pick (planner); `moves` when the arms'
 *        first place or pick differ (the install-or-hold boards, finding 4)                                          (0.3)
 *  'rh'  a reply Runner's host choice (the Corp's look-ahead; the first main-phase decision of each Corp turn re-asked on
 *        the today tree with recording hooks, B3REC; at most REPLY_MAX per decision), re-answered per arm: a host prompt's
 *        pick, or a ranking's first action and best trojan install                                                   (0.3)
 *  'po'  played on (0.4): from every deciding-Runner board where an arm's pick differs from today's (host prompts, and
 *        install boards whose first place or pick differ), each arm's own agents (both sides, the arm's tree) play three
 *        Runner turns from the board, on seeds k = 0..K-1 (k > 0: R&D and the stack reshuffled and the rng reseeded,
 *        both arms alike, HIDDEN-READ by the script), with the measures with a direction: per run through a trojan's host,
 *        the subroutines the trojan broke (more is better), the credits paid to get through (less), whether it got in
 *  'g'   per game: whether the source game matches the batch record (winner, cr, sc), ms
 *  'tm'  per game: ms per arm and caller kind (0.5): deciding prompt, deciding action (chooseAction on 'ia' boards), reply
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/b3/step0.ts
 *   ARGS="POOL=batch DEALS=1581 PLAYON=1" npx vite-node scripts/runner-rework/b3/step0.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../../src/core';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';
import { Tree, loadTree } from '../facts-trees';
import { Arm, makeB3Trees } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const LIMIT = Number(process.env.LIMIT ?? 0);
const PLAYON = process.env.PLAYON !== '0';
const K = Number(process.env.K ?? 3);
const REPLY = process.env.REPLY !== '0';
const REPLY_MAX = Number(process.env.REPLY_MAX ?? 4);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/b3-step0', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r4 = (x: number | null | undefined) => (x === null || x === undefined ? null : Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x > 0 ? 'Inf' : '-Inf');
const key = (a: unknown) => JSON.stringify(a ?? null);
const MUSLIHAT = '35013';
const FIX_ARMS = (process.env.FIX_ARMS ?? 'in1,capA,capC').split(',') as Arm[]; // B3b: FIX_ARMS=capA,built reads the built tree
const TREE_ARMS: Arm[] = ['today', ...FIX_ARMS];

interface ArmTree {
  T: Tree;
  P: any; // ai/prompts.ts (HOSTLOG, B3REC)
  CV: any; // ai/counterValues.ts
  RR: any; // ai/runnerReply.ts
  TP: any; // ai/turnPlanner.ts
}
let A: Record<Arm, ArmTree>;
let S: Tree; // source
const def = (code: string) => S.core.getCardDefinition(code);
const title = (code: string) => def(code)?.title ?? code;
const allIce = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.ice);
const time = new Map<string, number>();
const addTime = (k: string, ms: number) => time.set(k, (time.get(k) ?? 0) + ms);

/** The active prompt if it is a host prompt of installRunnerChoice (its data names the card; every option is installed ice). */
function hostPrompt(s: GameState): any | null {
  const p: any = S.core.activePrompt(s);
  if (!p || p.side !== 'runner' || p.kind !== 'effect_choice') return null;
  const d = p.source?.data;
  if (!d || typeof d.cardId !== 'string' || !('discount' in d)) return null;
  const ice = new Set(allIce(s).map(c => c.instanceId));
  return p.options.length && p.options.every((o: any) => ice.has(o.id)) ? p : null;
}
const isTrojan = (code: string) => !!S.cards[code]?.runFacts?.trojan;
const trojanInstalls = (s: GameState, legal: GameAction[]) =>
  legal.filter((a: any) => a.type === 'INSTALL_CARD' && a.hostInstanceId && isTrojan(s.runner.grip.find(c => c.instanceId === a.cardInstanceId)?.cardCode ?? ''));

function runnerAgent(arm: Arm, memory: Map<string, string>, planner = true): any {
  const agent: any = A[arm].T.createAgent('runner', 'normal');
  if (!planner) agent.planner = false;
  agent.memory = new Map(memory);
  return agent;
}
const pickOf = (a: any) => (a?.type === 'RESOLVE_PROMPT' ? a.choice?.optionId ?? (a.choice?.cardInstanceIds ?? []).join(',') : a ? `${a.type}${a.cardInstanceId ? ':' + a.cardInstanceId : ''}${a.hostInstanceId ? '@' + a.hostInstanceId : ''}${a.targetServerId ? '>' + a.targetServerId : ''}` : null);

/** The honest view's scratch answer (0.2): the dealt view (sample k, or the decision's view), MuslihaT's top card kept on top. */
function honestAnswer(arm: Arm, s: GameState, memory: Map<string, string>, k: number | null): any {
  const { T, P, RR, TP } = A[arm];
  const p: any = T.core.activePrompt(s);
  let view: GameState = k === null ? TP.runnerDecisionView(s, memory) : T.pricing.withPricing({ decisionSeed: TP.decisionSeedFor(s, 'runner') }, () => RR.guessRunnerView(s, k, memory));
  if (p.source?.cardCode === MUSLIHAT && typeof p.source.data?.cardId === 'string') {
    const stack = [...view.runner.stack];
    const i = stack.findIndex(c => c.instanceId === p.source.data.cardId);
    if (i > 0) [stack[0], stack[i]] = [stack[i], stack[0]];
    view = { ...view, runner: { ...view.runner, stack } };
  }
  return P.answerPrompt(view, 'runner', memory, true);
}

/** 0.2: the branch promptAnswer takes (runnerAI.ts promptAnswer), and for a real-state answer the honest view's answer. */
function askPrompt(src: string, pool: string, s: GameState, played: GameAction | null, memory: Map<string, string>, counts: Map<string, number>) {
  const { T, RR } = A.today;
  const p: any = T.core.activePrompt(s);
  const agent = runnerAgent('today', memory);
  const label = `${p.kind} | ${p.source ? `${title(p.source.cardCode)}:${p.source.step}` : '-'}`;
  const t0 = performance.now();
  let branch = 'view';
  let named: string[] = [];
  T.synergy.asSide('runner', () => {
    T.handValues.decisionContext(s, 'runner');
    const view: GameState = agent.ownView(s);
    if (view === s) branch = 'given';
    else {
      const shown = JSON.stringify(p);
      const { ice, root, loose } = RR.runnerUnknownSlots(s, agent.memory);
      const has = (cards: { instanceId: string }[]) => cards.some(x => shown.includes(`"${x.instanceId}"`));
      named = [has(s.runner.stack) && 'stack', has(ice) && 'ice', has(root) && 'root', has(loose) && 'loose'].filter(Boolean) as string[];
      if (named.length) branch = 'real:named';
      else if (!T.core.isLegalAction(s, A.today.P.answerPrompt(view, 'runner', agent.memory, true))) branch = 'real:illegal';
    }
  });
  addTime('prompt:today', performance.now() - t0);
  const inRun = s.activeRun ? s.activeRun.phase ?? 'run' : 'no run';
  const ck = `${label} | ${branch} | ${s.activeRun ? 'in a run' : 'no run'}`;
  counts.set(ck, (counts.get(ck) ?? 0) + 1);
  if (!branch.startsWith('real')) return;
  // Classes of the cards the prompt names (step 0.2's table; the classes test of commit 2 reads view.ts instead)
  const ids = new Set<string>(JSON.stringify(p).match(/inst-\d+/g) ?? []);
  const classes: Record<string, number> = {};
  const add = (c: string) => (classes[c] = (classes[c] ?? 0) + 1);
  const cand = new Set<string>(p.kind === 'effect_cards' ? p.candidateIds : []);
  const table = new Set(allIce(s).concat(Object.values(s.corp.servers).flatMap(v => v.root)).map(c => c.instanceId));
  for (const id of ids) {
    if (s.runner.stack.some(c => c.instanceId === id)) add(p.source?.cardCode === MUSLIHAT ? 'inPlace' : cand.has(id) || p.source?.data?.cardId === id ? 'shown' : 'stack?');
    else if (table.has(id)) {
      const c = S.core.findCardAnywhere(s, id);
      if (c && !c.isRezzed && !c.faceUp && !c.runnerKnows) add('named');
    } else if (s.corp.hq.concat(s.corp.rd, s.corp.archives.faceDown).some(c => c.instanceId === id)) add(cand.has(id) ? 'shown(corp)' : 'named(corp)');
  }
  const today = played;
  const honest: Record<string, unknown> = {};
  for (const arm of ['today', 'capA'] as Arm[]) {
    const { T } = A[arm];
    const deals = new Map<string, number>();
    T.synergy.asSide('runner', () => {
      T.handValues.decisionContext(s, 'runner');
      const a = honestAnswer(arm, s, memory, null);
      for (let k = 4096; k < 4108; k++) {
        const b = honestAnswer(arm, s, memory, k);
        const kk = `${pickOf(b)}${T.core.isLegalAction(s, b) ? '' : ' (illegal)'}`;
        deals.set(kk, (deals.get(kk) ?? 0) + 1);
      }
      honest[arm] = { answer: pickOf(a), legal: T.core.isLegalAction(s, a), differs: pickOf(a) !== pickOf(today), deals: Object.fromEntries(deals) };
    });
  }
  out({ kind: 'p', src, pool, T: s.turnNumber, label, branch, named, inRun, classes, today: pickOf(today), honest });
}

/** 0.3: a host prompt answered by the deciding Runner, per arm. Returns the arms whose pick differs from today's. */
function askHost(src: string, pool: string, s: GameState, played: GameAction | null, memory: Map<string, string>): Arm[] {
  const p = hostPrompt(s)!;
  const cardId: string = p.source.data.cardId;
  const code = S.core.findCardAnywhere(s, cardId)?.cardCode ?? '?';
  const ice = allIce(s);
  const hosts = p.options.map((o: any) => {
    const h = ice.find(c => c.instanceId === o.id)!;
    const server = Object.values(s.corp.servers).find(v => v.ice.includes(h))!.id;
    const on = s.runner.rig.programs.filter(c => c.hostedOnId === o.id);
    return { id: o.id, server, rezzed: !!h.isRezzed, known: !!(h.isRezzed || h.runnerKnows), same: on.filter(c => c.cardCode === code).length, hosts: on.map(c => `${title(c.cardCode)}(${c.tokens?.virus ?? 0})`) };
  });
  const arms: Record<string, unknown> = {};
  const picks: Record<string, string | null> = {};
  for (const arm of ['today', ...FIX_ARMS] as Arm[]) {
    const { T, P, CV, TP } = A[arm];
    const t0 = performance.now();
    const agent = runnerAgent(arm, memory);
    let pick: string | null;
    try {
      pick = pickOf(T.synergy.asSide('runner', () => agent.chooseAction(structuredClone(s))));
    } catch (e) {
      pick = `threw ${(e as Error).message.slice(0, 60)}`;
    }
    addTime(`host:${arm}`, performance.now() - t0);
    picks[arm] = pick;
    const per: Record<string, unknown> = {};
    T.synergy.asSide('runner', () => {
      T.handValues.decisionContext(s, 'runner');
      const view: GameState = TP.runnerDecisionView(s, memory);
      for (const [name, b] of [['real', s], ['view', view]] as [string, GameState][]) {
        const scores = new Map<string, number>();
        P.HOSTLOG.on = (id: string, a: any, score: number) => id === p.id && a?.choice?.kind === 'effect_choice' && scores.set(a.choice.optionId, score);
        let answer: any;
        try {
          answer = P.answerPrompt(b, 'runner', memory, true);
        } finally {
          P.HOSTLOG.on = undefined;
        }
        per[name] = {
          pick: pickOf(answer),
          hosts: p.options.map((o: any) => {
            const after = P.simulate(b, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'effect_choice', optionId: o.id } });
            const card = after?.runner.rig.programs.find((c: any) => c.instanceId === cardId);
            return { id: o.id, cw: r4(card && isTrojan(code) ? CV.counterWorth(after, card, 'virus') : null), score: r4(scores.get(o.id) ?? null) };
          }),
        };
      }
    });
    arms[arm] = per;
  }
  const topTie = (arm: string) => {
    const hs = ((arms[arm] as any).real.hosts as any[]).map(h => (typeof h.score === 'number' ? h.score : -Infinity));
    const top = Math.max(...hs);
    return hs.filter(v => Math.abs(v - top) <= 1e-9).length;
  };
  const second = (pick: string | null) => {
    const h = hosts.find((x: any) => x.id === pick);
    return !!h && h.same > 0 && hosts.some((x: any) => x.id !== pick && x.same === 0);
  };
  out({
    kind: 'hp',
    src,
    pool,
    T: s.turnNumber,
    card: title(code),
    code,
    effect: title(p.source.cardCode),
    inRun: !!s.activeRun,
    hosts,
    played: pickOf(played),
    picks,
    second: Object.fromEntries(Object.entries(picks).map(([a, pk]) => [a, second(pk)])),
    tiedTop: Object.fromEntries(['today', ...FIX_ARMS].map(a => [a, topTie(a)])),
    arms,
  });
  return FIX_ARMS.filter(a => picks[a] !== picks.today);
}

/** 0.3: a deciding-Runner main-phase board with a legal trojan install, per arm. Returns the arms that move it. */
function askInstall(src: string, pool: string, s: GameState, played: GameAction | null, memory: Map<string, string>): Arm[] {
  const rows: Record<string, unknown> = {};
  const firsts: Record<string, string | null> = {};
  const picks: Record<string, string | null> = {};
  for (const arm of ['today', ...FIX_ARMS] as Arm[]) {
    const { T } = A[arm];
    const agent = runnerAgent(arm, memory);
    let ranked: any[] = [];
    T.synergy.asSide('runner', () => (ranked = agent.rankMainActions(structuredClone(s))));
    const ti = ranked.findIndex(r => r.action.type === 'INSTALL_CARD' && r.action.hostInstanceId && isTrojan(s.runner.grip.find(c => c.instanceId === r.action.cardInstanceId)?.cardCode ?? ''));
    const t0 = performance.now();
    let pick: string | null;
    try {
      pick = pickOf(T.synergy.asSide('runner', () => runnerAgent(arm, memory).chooseAction(structuredClone(s))));
    } catch (e) {
      pick = `threw ${(e as Error).message.slice(0, 60)}`;
    }
    addTime(`action:${arm}`, performance.now() - t0);
    firsts[arm] = ranked[0] ? pickOf(ranked[0].action) : null;
    picks[arm] = pick;
    const trojan = ti >= 0 ? ranked[ti] : null;
    rows[arm] = { first: firsts[arm], firstScore: r4(ranked[0]?.score), trojan: trojan ? { action: pickOf(trojan.action), rank: ti + 1, score: r4(trojan.score) } : null, of: ranked.length, pick };
  }
  const moves = FIX_ARMS.filter(a => firsts[a] !== firsts.today || picks[a] !== picks.today);
  const host = (id?: string) => allIce(s).find(c => c.instanceId === id);
  const ti = (picks.today ?? '').split('@')[1];
  out({ kind: 'ia', src, pool, T: s.turnNumber, clicks: s.runner.clicks, credits: s.runner.credits, played: pickOf(played), arms: rows, moves, pickedHostRezzed: ti ? !!host(ti)?.isRezzed : null });
  return moves;
}

/** 0.3: the reply Runner's host choices inside one Corp decision, recorded on the today tree and re-asked per arm. */
function askReply(src: string, pool: string, s: GameState) {
  const { T, P } = A.today;
  const recs: { what: 'prompt' | 'rank'; state: GameState; memory: Map<string, string> }[] = [];
  P.B3REC.prompt = (st: GameState, side: string, memory: any) => {
    if (side !== 'runner' || recs.length >= REPLY_MAX) return;
    const p: any = T.core.activePrompt(st);
    if (!p || p.kind !== 'effect_choice' || typeof p.source?.data?.cardId !== 'string' || !('discount' in p.source.data)) return;
    recs.push({ what: 'prompt', state: structuredClone(st), memory: new Map(memory ?? []) });
  };
  P.B3REC.rank = (st: GameState, ranked: any[], memory: any, planner: boolean) => {
    if (planner || recs.length >= REPLY_MAX) return;
    if (!ranked.some(r => r.action.type === 'INSTALL_CARD' && r.action.hostInstanceId && isTrojan(st.runner.grip.find(c => c.instanceId === r.action.cardInstanceId)?.cardCode ?? ''))) return;
    recs.push({ what: 'rank', state: structuredClone(st), memory: new Map(memory ?? []) });
  };
  const t0 = performance.now();
  try {
    T.createAgent('corp', 'normal').chooseAction(structuredClone(s));
  } catch {
    /* a Corp decision that throws is not this count's */
  } finally {
    P.B3REC.prompt = undefined;
    P.B3REC.rank = undefined;
  }
  addTime('replyCorp:today', performance.now() - t0);
  for (const r of recs) {
    const res: Record<string, unknown> = {};
    for (const arm of ['today', ...FIX_ARMS] as Arm[]) {
      const tt = performance.now();
      const agent = runnerAgent(arm, r.memory, false);
      const { T: Ta, P: Pa } = A[arm];
      Ta.synergy.asSide('runner', () => {
        if (r.what === 'prompt') res[arm] = pickOf(Pa.answerPrompt(r.state, 'runner', agent.memory, true));
        else {
          const ranked: any[] = agent.rankMainActions(r.state);
          const ti = ranked.findIndex(x => x.action.type === 'INSTALL_CARD' && x.action.hostInstanceId && isTrojan(r.state.runner.grip.find(c => c.instanceId === x.action.cardInstanceId)?.cardCode ?? ''));
          res[arm] = { first: pickOf(ranked[0]?.action), trojan: ti >= 0 ? { action: pickOf(ranked[ti].action), rank: ti + 1 } : null };
        }
      });
      addTime(`reply:${arm}`, performance.now() - tt);
    }
    const p: any = T.core.activePrompt(r.state);
    out({ kind: 'rh', src, pool, T: s.turnNumber, what: r.what, card: r.what === 'prompt' ? title(T.core.findCardAnywhere(r.state, p.source.data.cardId)?.cardCode ?? '?') : null, arms: res, moves: FIX_ARMS.filter(a => key(res[a]) !== key(res.today)) });
  }
}

function seedFor(k: number, base: number): number {
  let h = (2166136261 ^ base) >>> 0;
  h = Math.imul(h ^ (k * 0x9e3779b1), 16777619) >>> 0;
  return h;
}

/** 0.4: each arm's own agents play three Runner turns from `s0`, seed k; the measures with a direction. */
function playOn(arm: Arm, s0: GameState, k: number, memory: Map<string, string>) {
  const { T } = A[arm];
  const s: GameState = structuredClone(s0);
  if (k > 0) {
    // HIDDEN-READ (the measuring script): seed k reshuffles R&D and the stack and reseeds the game's rng, every arm alike
    const seed = seedFor(k, s.rng.seed);
    s.id = `${s.id}~${k}`;
    s.rng = T.core.createRng(seed);
    T.core.shuffleInPlace(s.rng, s.corp.rd);
    T.core.shuffleInPlace(s.rng, s.runner.stack);
  }
  T.clear();
  const g = new T.GameRunner(s, { runner: runnerAgent(arm, memory), corp: T.createAgent('corp', 'normal') });
  const runs: { server: string; host: boolean; broke: number; paid: number; inside: boolean }[] = [];
  let run: { server: string; host: boolean; broke: number; credits: number; inside: boolean } | null = null;
  let runnerTurns = 0;
  let installs = 0;
  const startTurn = s.turnNumber;
  const trojanHosts = (st: GameState) => new Set(st.runner.rig.programs.filter(c => c.hostedOnId && isTrojan(c.cardCode)).map(c => c.hostedOnId!));
  const virusOn = (st: GameState, server: string) => {
    const ice = new Set((st.corp.servers[server]?.ice ?? []).map(c => c.instanceId));
    return st.runner.rig.programs.filter(c => c.hostedOnId && ice.has(c.hostedOnId) && isTrojan(c.cardCode)).reduce((n, c) => n + (c.tokens?.virus ?? 0), 0);
  };
  let lastActive = s.activePlayer;
  for (let n = 0; n < 3000 && !g.state.winner; n++) {
    const before: GameState = g.state;
    if (!g.step()) break;
    const after: GameState = g.state;
    const a: any = g.last;
    if (a?.type === 'INSTALL_CARD' && a.hostInstanceId && isTrojan(before.runner.grip.find(c => c.instanceId === a.cardInstanceId)?.cardCode ?? '')) installs++;
    if (a?.type === 'RESOLVE_PROMPT' && hostPromptIn(T, before) && isTrojan(T.core.findCardAnywhere(before, (T.core.activePrompt(before) as any).source.data.cardId)?.cardCode ?? '')) installs++;
    if (!run && after.activeRun) {
      const server = after.activeRun.server;
      const hostIce = (after.corp.servers[server]?.ice ?? []).some(c => trojanHosts(after).has(c.instanceId));
      run = { server, host: hostIce, broke: 0, credits: before.runner.credits, inside: false };
    }
    if (run && after.activeRun) {
      run.broke += Math.max(0, virusOn(before, run.server) - virusOn(after, run.server));
      if (after.activeRun.isSuccessful) run.inside = true;
    }
    if (run && !after.activeRun) {
      run.broke += Math.max(0, virusOn(before, run.server) - virusOn(after, run.server));
      runs.push({ server: run.server, host: run.host, broke: run.broke, paid: run.credits - after.runner.credits, inside: run.inside || !!before.activeRun?.isSuccessful });
      run = null;
    }
    if (lastActive === 'runner' && after.activePlayer === 'corp') runnerTurns++;
    lastActive = after.activePlayer;
    if (runnerTurns >= 3) break;
  }
  const through = runs.filter(r => r.host);
  return { arm, k, turns: g.state.turnNumber - startTurn, runnerTurns, winner: g.state.winner ?? null, installs, runs: runs.length, hostRuns: through.length, broke: through.reduce((n, r) => n + r.broke, 0), paid: through.reduce((n, r) => n + r.paid, 0), inside: through.filter(r => r.inside).length, hosted: trojanHosts(g.state).size, byServer: runs.map(r => r.server) };
}
function hostPromptIn(T: Tree, s: GameState): boolean {
  const p: any = T.core.activePrompt(s);
  return !!p && p.side === 'runner' && p.kind === 'effect_choice' && typeof p.source?.data?.cardId === 'string' && 'discount' in p.source.data;
}

type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];

async function main() {
  const dirs = makeB3Trees(root, TREE_ARMS, shard);
  S = await loadTree('source', dirs.source);
  A = {} as Record<Arm, ArmTree>;
  for (const arm of TREE_ARMS) {
    const m = (p: string) => import(/* @vite-ignore */ join(dirs[arm], 'src', p));
    A[arm] = { T: await loadTree(arm, dirs[arm]), P: await m('ai/prompts.ts'), CV: await m('ai/counterValues.ts'), RR: await m('ai/runnerReply.ts'), TP: await m('ai/turnPlanner.ts') };
    if (!A[arm].P.HOSTLOG || !A[arm].P.B3REC) throw new Error(`${arm} tree: hooks missing`);
  }
  const sources: { pool: string; rec: Rec }[] = [];
  for (const pool of POOLS) {
    const run = pool === 'batch' ? '45716865309' : '45721175528';
    const recs: Rec[] = JSON.parse(readFileSync(`scripts/runner-rework/b3/deals-${run}.json`, 'utf8'));
    for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, rec: r });
  }
  let done = 0;
  for (const [i, { pool, rec }] of sources.entries()) {
    if (i % shards !== shard) continue;
    if (LIMIT && done >= LIMIT) break;
    done++;
    const t0 = performance.now();
    time.clear();
    S.clear();
    for (const arm of TREE_ARMS) A[arm].T.clear();
    const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
    const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
    if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found`);
    const trojanTitles = new Set(Object.keys(S.cards).filter(isTrojan).map(title));
    const trojanDeck = Object.keys(r.cards).some(t => trojanTitles.has(t));
    const src = `${pool}:${rec.seed}`;
    const ag = { corp: S.createAgent('corp', 'normal'), runner: S.createAgent('runner', 'normal') };
    const g = new S.GameRunner(S.core.createInitialGameState(S.decks.deckGameSetup(rec.seed, c, r)), ag);
    const cr: number[] = [];
    const sc: number[] = [];
    const counts = new Map<string, number>();
    let lastTurn = -1;
    let corpTurnAsked = -1;
    const boards: { what: string; s: GameState; memory: Map<string, string>; arms: Arm[] }[] = [];
    for (let n = 0; n < 4000; n++) {
      const s: GameState = g.state;
      if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
        cr.push(s.corp.credits);
        sc.push(s.corp.score);
        lastTurn = s.turnNumber;
      }
      // HIDDEN-READ: the source Runner's memory, read (never asked); every asked agent gets a copy
      const memory = new Map((ag.runner as any).memory ?? []) as Map<string, string>;
      const side = S.core.actingSide(s);
      const p: any = S.core.activePrompt(s);
      const runnerPrompt = side === 'runner' && p && p.side === 'runner' && s.pendingPrompts.length > 0;
      const runnerMain = side === 'runner' && !p && !s.priority?.holder && s.activePlayer === 'runner' && !s.activeRun;
      const corpMain = REPLY && trojanDeck && side === 'corp' && !p && s.activePlayer === 'corp' && !s.activeRun && corpTurnAsked !== s.turnNumber;
      if (!g.step()) break;
      const played = g.last ?? null;
      try {
        if (runnerPrompt) {
          askPrompt(src, pool, s, played, memory, counts);
          if (hostPrompt(s)) {
            const arms = askHost(src, pool, s, played, memory);
            if (arms.length) boards.push({ what: 'host', s, memory, arms });
          }
        } else if (runnerMain && trojanInstalls(s, S.core.getLegalActions(s, 'runner')).length) {
          const arms = askInstall(src, pool, s, played, memory);
          if (arms.length) boards.push({ what: 'install', s, memory, arms });
        } else if (corpMain) {
          corpTurnAsked = s.turnNumber;
          askReply(src, pool, s);
        }
      } catch (e) {
        out({ kind: 'err', src, T: s.turnNumber, e: (e as Error).message.slice(0, 160) });
      }
    }
    const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
    out({ kind: 'pc', src, pool, counts: Object.fromEntries(counts) });
    out({ kind: 'g', src, pool, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, trojanDeck, matchesBatch: matches, ...(matches ? {} : { winner: g.state.winner, recWinner: rec.winner }), boards: boards.length, ms: Math.round(performance.now() - t0) });
    if (PLAYON)
      for (const [j, b] of boards.entries()) {
        const res: unknown[] = [];
        for (const arm of ['today', ...b.arms] as Arm[])
          for (let k = 0; k < K; k++) {
            const tt = performance.now();
            try {
              res.push({ ...playOn(arm, b.s, k, b.memory), ms: Math.round(performance.now() - tt) });
            } catch (e) {
              res.push({ arm, k, err: (e as Error).message.slice(0, 120) });
            }
          }
        out({ kind: 'po', src, pool, board: j, what: b.what, T: b.s.turnNumber, arms: b.arms, res });
      }
    out({ kind: 'tm', src, pool, ms: Object.fromEntries([...time].map(([k, v]) => [k, Math.round(v)])) });
  }
  out({ kind: 's', shard, sources: done });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
