/**
 * Stage D item 4 step 1, the AI Coordinator's follow-up trace (design-answer.md section 3): at the Corp decisions of the
 * losses where the Corp's own agenda install made a remote game-ending (and the four losses the count said held), what the
 * look-ahead saw. Scripts only: the trees are patched copies of src/ (game-end-patches.ts plus the probes below).
 *
 * Trees: base and b2 (the ±1000 terminal), and each again with plan.oracle.gripReply on (`-grip`: the reply is dealt the
 * Runner's real grip, the stack still hidden; measurement only), to tell a reply that cannot show the end from the dealt
 * view.
 *
 * For each target (a game, a Corp turn, the server the Runner won through) the game is reproduced to that Corp turn (the
 * deal played by this tree's Normal AIs with caches cleared as the harness does; a human game replayed move for move),
 * and at each Corp main-phase decision of that turn up to and including the one that installs or advances an agenda in
 * that server, each tree's fresh Normal Corp is asked on a copy with probes on: the planner's candidates and their values
 * (onCandidates), and for every Runner-reply sample: the candidate it belongs to (the extra contender samples marked),
 * the sample's winner, the servers its Runner ran, its worth, and the reply root's agenda servers. Then the real next
 * Runner turn: its moves and runs.
 *    TARGETS=deal:1041:10:remote-2 npx vite-node scripts/stage-d/game-end-installs.ts
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { HeuristicCorpAI } from '../../src/ai/corpAI';
import { HeuristicRunnerAI } from '../../src/ai/runnerAI';
import { REPLY, guessHidden } from '../../src/ai/runnerReply';
import { createRng } from '../../src/core';
import { serverHold } from '../../src/ai/corp/hold';
import { clearCaches, dealState } from '../stage-a/harness';
import { PATCHES, probe } from './game-end-patches';

type Patch = [string, string, string];
const G = globalThis as unknown as { __geCand?: string | number; __geSamples?: unknown[] };
const gp = '(globalThis as unknown as { __geCand?: string | number; __geSamples?: unknown[] })';
const replyProbe: Patch[] = [
  ['ai/turnPlanner.ts', '      const value = playout(root, side, c.action, ai, line, ends);', `      ${gp}.__geCand = candidates.indexOf(c);\n      const value = playout(root, side, c.action, ai, line, ends);`],
  ['ai/turnPlanner.ts', '    const extra = runnerReply(r.ends.state!, synergy, leaf, { from: first, count: REPLY.extra });', `    ${gp}.__geCand = 'extra:' + scored.indexOf(r);\n    const extra = runnerReply(r.ends.state!, synergy, leaf, { from: first, count: REPLY.extra });`],
  [
    'ai/runnerReply.ts',
    '      values.push(value);',
    `      ${gp}.__geSamples?.push({ cand: ${gp}.__geCand, k, winner: last.winner ?? null, ran: [...ran], value: Math.round(value * 10) / 10, score: [end.corp.score, end.runner.score], hq: end.corp.hq.filter(c => cardDef(c).type_code === 'agenda').map(c => cardDef(c).agenda_points), roots: Object.values(end.corp.servers).filter(v => v.root.some(c => cardDef(c).type_code === 'agenda')).map(v => v.id + ':' + v.root.filter(c => cardDef(c).type_code === 'agenda').map(c => cardDef(c).agenda_points).join('+') + ' ice ' + v.ice.length), runnerCr: end.runner.credits, end });\n      values.push(value);`,
  ],
];
const grip: Patch = ['ai/synergy.ts', 'gripThreat: false, gripReply: false },', 'gripThreat: false, gripReply: true },'];
const TREES: Record<string, Patch[]> = { base: [], b2: PATCHES.b2, 'base-grip': [grip], 'b2-grip': [...PATCHES.b2, grip] };
const root = resolve('.fc-variants', 'game-end', 'installs');

function makeTrees(): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const [arm, patches] of Object.entries(TREES)) {
    const dir = join(root, arm);
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [file, from, to] of [...probe, ...replyProbe, ...patches]) {
      const path = join(dir, 'src', file);
      const text = readFileSync(path, 'utf8');
      if (text.split(from).length !== 2) throw new Error(`patch ${arm} does not match once in ${file}: ${from.slice(0, 60)}`);
      writeFileSync(path, text.replace(from, to));
    }
    dirs[arm] = dir;
  }
  return dirs;
}

interface Tree {
  rez: (s: GameState) => { pick: GameAction | null; layer?: string };
  ask: (s: GameState) => { pick: GameAction; cands: { action: GameAction; value: number }[]; samples: Record<string, unknown>[]; layer?: string };
}
async function load(dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const pr = await m('ai/pricing.ts');
  const dg = await m('ai/diagnostics.ts');
  const po = await m('ai/playout.ts');
  return {
    rez: (s: GameState) => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.valueLoops?.clear();
      clearCaches();
      (globalThis as unknown as { __geLayer?: string }).__geLayer = undefined;
      const pick = ai.createAgent('corp', 'normal').chooseRez(structuredClone(s), po.rezCandidates(s, s.priority!.step));
      return { pick, layer: (globalThis as unknown as { __geLayer?: string }).__geLayer };
    },
    ask: (s: GameState) => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.valueLoops?.clear();
      clearCaches();
      const d = dg.newDiagnostics();
      let cands: { action: GameAction; value: number }[] = [];
      d.onCandidates = (side: string, values: number[], actions: GameAction[]) => {
        if (side === 'corp') cands = actions.map((a, i) => ({ action: a, value: Math.round(values[i] * 10) / 10 }));
      };
      G.__geSamples = [];
      G.__geCand = undefined;
      (globalThis as unknown as { __geLayer?: string }).__geLayer = undefined;
      const pick = pr.withPricing({ diagnostics: d }, () => ai.createAgent('corp', 'normal').chooseAction(structuredClone(s)));
      const samples = G.__geSamples as Record<string, unknown>[];
      G.__geSamples = undefined;
      return { pick, cands, samples, layer: (globalThis as unknown as { __geLayer?: string }).__geLayer };
    },
  };
}

const findCard = (s: GameState, id: string): CardInstance | undefined =>
  [...s.corp.hq, ...s.corp.rd, ...Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice]), ...s.runner.grip, ...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].find(c => c.instanceId === id);
function short(s: GameState, a: GameAction | null): string {
  if (!a) return 'pass';
  const x = a as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean; server?: string };
  const c = x.cardInstanceId ? findCard(s, x.cardInstanceId) : null;
  return `${a.type}${c ? ` ${cardDef(c).title}` : ''}${x.asNewRemote ? '->new' : x.targetServerId ? `->${x.targetServerId}` : ''}`;
}

function cleared(inner: Agent): Agent {
  return new Proxy(inner, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function' || !['chooseAction', 'chooseRez', 'chooseOffTurn'].includes(String(prop))) return v;
      return (...args: unknown[]) => {
        clearCaches();
        return v.apply(target, args);
      };
    },
  });
}

/** The game's states and moves in order, to the end of the Runner turn after Corp turn `turn` (deals: played; human: replayed). */
function history(src: string, turn: number): { s: GameState; a: GameAction }[] {
  const out: { s: GameState; a: GameAction }[] = [];
  const stop = (s: GameState) => s.winner || (s.turnNumber > turn && s.activePlayer === 'corp');
  if (src.startsWith('deal:')) {
    const game = new GameRunner(dealState(Number(src.slice(5))), { corp: cleared(createAgent('corp', 'normal')), runner: cleared(createAgent('runner', 'normal')) });
    for (let k = 0; k < 4000 && !stop(game.state); k++) {
      const s = game.state;
      if (!game.step()) break;
      out.push({ s, a: game.last! });
    }
  } else {
    const report = JSON.parse(readFileSync(`tests/fixtures/human-games/${src.slice(6)}`, 'utf8'));
    let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    for (const a of report.moves as GameAction[]) {
      if (stop(s)) break;
      out.push({ s, a });
      s = executeAction(s, a);
    }
  }
  return out;
}

/**
 * The reply isolated (design-answer 3.3): the real Runner-turn start of the target, played to the Runner turn's end the
 * way runnerReply plays a sample (REPLY.maxSteps, stop when the Corp's turn comes back), N times each, with:
 *  R1 Normal Corp + Normal Runner on the true state (fresh agents: no Runner memory of earlier accesses);
 *  R2 the reply's agents (planner off, both) on the true state;
 *  R3 the reply's agents on guessHidden(state, k) (what a reply sample is, on the real end state);
 *  R4 Normal Runner + the reply's Corp on guessHidden(state, k);
 *  R5 the reply's Runner + Normal Corp on the true state.
 * The true-state rows vary only the engine's rng (createRng(k)): shuffles and draws; the R3/R4 rows deal the hidden cards.
 */
function isolate(s0: GameState, server: string, n = Number(process.env.N ?? 8)) {
  const reply = () => ({ corp: cleared(new HeuristicCorpAI({ synergy: true, planner: false })), runner: cleared(new HeuristicRunnerAI({ synergy: true, planner: false })) });
  const normal = () => ({ corp: cleared(createAgent('corp', 'normal')), runner: cleared(createAgent('runner', 'normal')) });
  const rows: [string, (k: number) => GameState, () => { corp: Agent; runner: Agent }][] = [
    ['R1 Normal both, true state', k => ({ ...structuredClone(s0), rng: createRng(k + 1) }), normal],
    ['R2 reply agents, true state', k => ({ ...structuredClone(s0), rng: createRng(k + 1) }), reply],
    ['R3 reply agents, guessHidden', k => guessHidden(structuredClone(s0), k), reply],
    ['R4 Normal Runner + reply Corp, guessHidden', k => guessHidden(structuredClone(s0), k), () => ({ corp: reply().corp, runner: normal().runner })],
    ['R5 reply Runner + Normal Corp, true state', k => ({ ...structuredClone(s0), rng: createRng(k + 1) }), () => ({ corp: normal().corp, runner: reply().runner })],
  ];
  for (const [name, start, agents] of rows) {
    let wins = 0, ranT = 0, inT = 0, capped = 0;
    const how: string[] = [];
    for (let k = 0; k < n; k++) {
      const gr = new GameRunner(start(k), agents());
      let runnerTurn = false, steps = 0, ran = false, got = false;
      const runs: string[] = [];
      let cur: string | null = null;
      for (; steps < REPLY.maxSteps && !gr.state.winner; steps++) {
        const before = gr.state;
        if (!gr.step()) break;
        const x = gr.state;
        if (process.env.DETAIL && k === 0 && gr.last && gr.last.type !== 'PASS') console.log(`      ${name.slice(0, 2)} ${actingSide(before)} ${short(before, gr.last)} ${JSON.stringify(gr.last).slice(0, 140)}`);
        if (x.activeRun && !before.activeRun) cur = x.activeRun.server;
        if (cur && (!x.activeRun || x.winner)) {
          runs.push(cur + (before.activeRun?.isSuccessful || x.activeRun?.isSuccessful || x.winner === 'runner' ? '+' : '-'));
          cur = null;
        }
        if (x.activeRun?.server === server) ran = true;
        if (x.activeRun?.server === server && x.activeRun.isSuccessful) got = true;
        if (x.activePlayer === 'runner') runnerTurn = true;
        else if (runnerTurn && !x.activeRun) break;
      }
      if (steps >= REPLY.maxSteps) capped++;
      if (gr.state.winner === 'runner') wins++;
      if (ran) ranT++;
      if (got) inT++;
      if (k < 4) how.push(`${runs.join(' ') || 'no run'}${gr.state.winner ? ' W:' + gr.state.winner : ''} ${steps}st ${gr.state.runner.credits}cr`);
    }
    console.log(`    ${name.padEnd(44)} Runner wins ${wins}/${n}, ran ${server} ${ranT}, successful there ${inT}, hit maxSteps ${capped} | ${how.join(' ; ')}`);
  }
}

const isAgenda = (c?: CardInstance) => !!c && cardDef(c).type_code === 'agenda';

async function main() {
  const dirs = makeTrees();
  const trees: Record<string, Tree> = {};
  for (const arm of Object.keys(TREES)) trees[arm] = await load(dirs[arm]);
  const targets = (process.env.TARGETS ?? '').split(',').filter(Boolean).map(t => {
    const [kind, game, turn, server] = t.split(':');
    return { src: `${kind}:${game}`, turn: Number(turn), server };
  });
  for (const t of targets) {
    const h = history(t.src, t.turn);
    const corpTurn = h.filter(x => x.s.turnNumber === t.turn && x.s.activePlayer === 'corp' && actingSide(x.s) === 'corp');
    console.log(`\n### ${t.src} Corp turn ${t.turn}, the Runner won through ${t.server}`);
    console.log(`Corp's moves: ${corpTurn.filter(x => x.a.type !== 'PASS').map(x => short(x.s, x.a)).join(', ')}`);
    // The decisions to ask: main-phase decisions of the turn up to the one that installs or advances an agenda in the server
    let last = -1;
    corpTurn.forEach((x, i) => {
      const a = x.a as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
      const c = a.cardInstanceId ? findCard(x.s, a.cardInstanceId) : undefined;
      const next = executeAction(x.s, x.a);
      const where = c ? Object.entries(next.corp.servers).find(([, v]) => v.root.some(k => k.instanceId === c.instanceId))?.[0] : undefined;
      if ((a.type === 'INSTALL_CARD' || a.type === 'ADVANCE_CARD') && isAgenda(c) && where === t.server) last = i;
    });
    const asks = corpTurn.filter((x, i) => i <= (last >= 0 ? last : corpTurn.length - 1) && !x.s.pendingPrompts.length && x.a.type !== 'PASS' && x.a.type !== 'START_TURN' && x.a.type !== 'END_TURN');
    for (const x of process.env.ASKS === 'off' ? [] : asks) {
      console.log(`\n  decision at ${x.s.corp.clicks} clicks, Corp ${x.s.corp.credits}cr, score ${x.s.corp.score}-${x.s.runner.score}; played: ${short(x.s, x.a)}`);
      for (const arm of Object.keys(TREES)) {
        const r = trees[arm].ask(x.s);
        const byCand = (i: number | string) => r.samples.filter(k => k.cand === i || k.cand === `extra:${i}`);
        console.log(`   ${arm}: pick ${short(x.s, r.pick)} [${r.layer ?? '-'}]`);
        r.cands.forEach((c, i) => {
          const ks = byCand(i);
          const wins = ks.filter(k => k.winner === 'runner');
          const ranT = ks.filter(k => (k.ran as string[]).includes(t.server));
          console.log(`     ${short(x.s, c.action).padEnd(44)} ${String(c.value).padStart(7)} | samples ${ks.length}, ran ${t.server} ${ranT.length}, Runner wins ${wins.length} (${wins.map(k => (k.ran as string[]).join('/')).join('; ')}) | values ${ks.map(k => k.value).join(' ')} | root ${ks[0] ? `${JSON.stringify(ks[0].roots)} hq ${JSON.stringify(ks[0].hq)} Runner ${ks[0].runnerCr}cr` : '-'}`);
        });
      }
    }
    // LINEEND: the install candidate's line end (the board its reply samples start from) against the real Corp turn's end
    if (process.env.LINEEND && last >= 0) {
      const x = corpTurn[last];
      const r = trees.base.ask(x.s);
      const i = r.cands.findIndex(c => JSON.stringify(c.action) === JSON.stringify(x.a));
      const lineEnd = r.samples.find(k => k.cand === i)?.end as GameState | undefined;
      const realEnd = h.find(y => y.s.turnNumber >= t.turn && y.s.activePlayer === 'runner')?.s;
      if (lineEnd && realEnd) {
        const sum = (s: GameState) => ({ active: s.activePlayer, T: s.turnNumber, corpCr: s.corp.credits, clicks: [s.corp.clicks, s.runner.clicks], runnerCr: s.runner.credits, hq: s.corp.hq.map(c => cardDef(c).title), grip: s.runner.grip.length, servers: Object.fromEntries(Object.values(s.corp.servers).filter(v => v.ice.length || v.root.length).map(v => [v.id, [...v.ice.map(c => cardDef(c).title + (c.isRezzed ? '*' : '')), '|', ...v.root.map(c => cardDef(c).title + (c.isRezzed ? '*' : '') + (c.advancementCounters ? '+' + c.advancementCounters : ''))].join(' ')])), prompts: s.pendingPrompts.map(p => p.kind), priority: s.priority?.step, tags: s.runner.tags });
        console.log(`  line end of the install candidate: ${JSON.stringify(sum(lineEnd))}`);
        console.log(`  real end:                          ${JSON.stringify(sum(realEnd))}`);
        if (process.env.DIFF) {
          // the line end carried through the Corp's END_TURN by the reply's agents, against the real Runner-turn start
          const gr = new GameRunner(structuredClone(lineEnd), { corp: cleared(new HeuristicCorpAI({ synergy: true, planner: false })), runner: cleared(new HeuristicRunnerAI({ synergy: true, planner: false })) });
          for (let n = 0; n < 50 && !(gr.state.activePlayer === 'runner'); n++) gr.step();
          const diffs: string[] = [];
          const walk = (a: unknown, b: unknown, path: string) => {
            if (diffs.length > 60 || /rng|log|history|actionLog|corp\.rd\./.test(path)) return;
            if (a === b) return;
            if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return void diffs.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} | ${JSON.stringify(b)?.slice(0, 80)}`);
            for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
          };
          walk(gr.state, realEnd, 's');
          console.log(`  line end after END_TURN vs real Runner-turn start (line | real):\n    ${diffs.join('\n    ')}`);
        }
        console.log('  isolate on the line end:');
        isolate(lineEnd, t.server);
      }
    }
    const runner = h.filter(x => x.s.turnNumber >= t.turn && x.s.activePlayer === 'runner' && actingSide(x.s) === 'runner' && x.a.type !== 'PASS');
    console.log(`  real next Runner turn: ${runner.map(x => short(x.s, x.a) + (x.a.type === 'INITIATE_RUN' ? `@${(x.a as { server?: string }).server ?? ''}` : '')).join(', ')}`);
    if (process.env.FULL)
      for (const x of h.filter(x => x.s.turnNumber >= t.turn && x.s.activePlayer === 'runner' && x.a.type !== 'PASS'))
        console.log(`    ${actingSide(x.s)} ${short(x.s, x.a)} | Runner ${x.s.runner.credits}cr, Corp ${x.s.corp.credits}cr${x.s.activeRun ? `, run ${x.s.activeRun.server} ice ${x.s.activeRun.icePosition}` : ''}${x.a.type === 'RESOLVE_PROMPT' ? ' ' + JSON.stringify((x.a as { choice?: unknown }).choice).slice(0, 80) + ' ' + (x.s.pendingPrompts[0]?.source ? cardDef({ cardCode: x.s.pendingPrompts[0].source.cardCode } as CardInstance).title : '') : ''}`);
    const before = h.find(x => x.s.turnNumber >= t.turn && x.s.activePlayer === 'runner')?.s;
    if (before) console.log(`  Runner at its turn start: ${before.runner.credits}cr, grip ${before.runner.grip.map(c => cardDef(c).title).join(', ')}; rig ${[...before.runner.rig.programs, ...before.runner.rig.hardware, ...before.runner.rig.resources].map(c => cardDef(c).title).join(', ')}`);
    if (before && process.env.ISOLATE) isolate(before, t.server);
    // RUNREZ: at each Corp window of the real Runner turn's runs on the server, what the Corp did and what this tree's Corp
    // picks now (and the layer), with the ice and the 'thisRun' count
    if (process.env.RUNREZ)
      for (const x of h.filter(x => x.s.turnNumber >= t.turn && x.s.activePlayer === 'runner' && x.s.activeRun?.server === t.server && actingSide(x.s) === 'corp')) {
        const r = x.s.priority?.step === 'approach_ice' || x.s.priority?.step === 'approach_server' ? trees.base.rez(x.s) : trees.base.ask(x.s);
        const sv = x.s.corp.servers[t.server];
        const hold = serverHold(x.s, t.server, { when: 'thisRun' });
        console.log(`    window at ice ${x.s.activeRun!.icePosition} (${x.s.activeRun!.phase ?? ''}): played ${short(x.s, x.a)}; now ${short(x.s, r.pick)} [${r.layer ?? '-'}] | Corp ${x.s.corp.credits}cr | ice ${sv.ice.map(c => `${cardDef(c).title}${c.isRezzed ? '' : ` (unrezzed, ${cardDef(c).cost})`}`).join(', ')} | thisRun holds ${hold.holds} rez ${JSON.stringify(hold.rez)} cost ${hold.rezCost} need ${hold.need} budget ${hold.budget}`);
      }
  }
  rmSync(root, { recursive: true, force: true });
}

void main();
