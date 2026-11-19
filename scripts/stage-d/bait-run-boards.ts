/**
 * Stage D exploit F3 count, part B "the hunt's boards by name" (brief section B): what beta and each arm do on the
 * exploit hunt's boards (/mnt/project-files/adversarial/2026-11-19-stage-d-checkpoint/, findings.md finding 1; boards
 * rebuilt as its probes a1.ts, b1.ts, d1.ts build them, from the copies bait-run-hunt-base.json = probes/
 * f1-rez-drain-state.json and bait-run-hunt-doorA.json = states/f1-bait-remote-corp5.json), with the bait line, the
 * honest line and the mirrors. Every game is played by GameRunner, the Normal Corp of the tree, the Runner scripted for
 * its main-phase clicks of this turn and the Normal Runner of the tree for everything else (as the hunter's harness).
 *   npx vite-node scripts/stage-d/bait-run-boards.ts            (OUT=path for a JSON copy)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { Arm, Tree, loadTree, makeTrees } from './bait-run-trees';

const ARMS_HERE: Arm[] = ['beta', 'stopOverTurn', 'outOverTurn', 'both', 'outSettled', 'stopLiteral'];
const G = globalThis as any;
const raw = (f: string) => {
  const r = JSON.parse(readFileSync(f, 'utf8'));
  return (r.state ?? r) as GameState;
};
const BASE = raw('scripts/stage-d/bait-run-hunt-base.json');
const DOOR_A = raw('scripts/stage-d/bait-run-hunt-doorA.json');

type Line = (s: GameState) => GameAction | null;
const run = (server: string): GameAction =>
  ({
    type: 'INITIATE_RUN',
    player: 'runner',
    targetServerId: server,
  }) as GameAction;
const credit: GameAction = {
  type: 'GAIN_CREDIT',
  player: 'runner',
} as GameAction;
const draw: GameAction = { type: 'DRAW_CARD', player: 'runner' } as GameAction;

function scripted(t: Tree, line: Line, turn: () => number) {
  const ai = t.createAgent('runner', 'normal');
  return new Proxy(ai, {
    get(target, p) {
      if (p === 'chooseAction')
        return (s: GameState) => {
          if (!s.activeRun && s.pendingPrompts.length === 0 && s.activePlayer === 'runner' && s.turnNumber === turn()) {
            const a = line(s);
            if (a && t.core.isLegalAction(s, a)) return a;
          }
          return ai.chooseAction(s);
        };
      const v = (target as any)[p];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

interface Case {
  name: string;
  board: (t: Tree) => GameState;
  line: Line;
  /** The Runner's turn the line plays (the board's turn, or the next one when the board is the Corp's). */
  runnerTurn: (s: GameState) => number;
}

function mk(t: Tree, s: GameState, code: string, rez = false) {
  const c = t.core.createCardInstance(s, code);
  c.isRezzed = rez;
  return c;
}

// Door A, a1.ts's board (Palisade outside Sleipnir, Offworld Office in the root, the Runner on 1 credit, Cleaver only)
function boardA(t: Tree, corp: number): GameState {
  const s = structuredClone(BASE);
  s.runner.rig.programs = s.runner.rig.programs.filter(c => c.cardCode !== '30026');
  s.runner.score = 0;
  s.runner.scoreArea = [];
  s.runner.credits = 1;
  s.corp.credits = corp;
  s.corp.servers.hq.ice = [mk(t, s, '30072', true)];
  s.corp.servers['remote-1'] = {
    ...s.corp.servers['remote-1'],
    ice: [mk(t, s, '36030'), mk(t, s, '30072')],
    root: [mk(t, s, '30067')],
  };
  return s;
}
// Door B, b1.ts's board (HQ: one unrezzed Palisade; remote-1: Sleipnir unrezzed, Send a Message; Runner 0 credits)
function boardB(t: Tree, corp: number): GameState {
  const s = structuredClone(BASE);
  s.runner.rig.programs = s.runner.rig.programs.filter(c => c.cardCode !== '30026');
  s.runner.score = 0;
  s.runner.scoreArea = [];
  s.runner.credits = 0;
  s.corp.credits = corp;
  s.corp.servers.hq.ice = [mk(t, s, '30072')];
  s.corp.servers['remote-1'] = {
    ...s.corp.servers['remote-1'],
    ice: [mk(t, s, '36030')],
  };
  return s;
}
// Door C, d1.ts's board (remote-1: Offworld Office and a rezzed Anoetic Void, no ice; Corp 6, Runner 3)
function boardC(t: Tree): GameState {
  const s = structuredClone(BASE);
  s.runner.score = 0;
  s.runner.scoreArea = [];
  s.runner.credits = 3;
  s.corp.credits = 6;
  s.corp.servers['remote-1'] = {
    ...s.corp.servers['remote-1'],
    ice: [],
    root: [mk(t, s, '30067'), mk(t, s, '30050', true)],
  };
  s.corp.hq.push(mk(t, s, '30069'), mk(t, s, '30061'), mk(t, s, '30074'));
  return s;
}

/** The boards are at the Corp's END_TURN (clicks 0); the Runner's turn that follows keeps the turn number (a1.ts: over when the Corp is active with a higher one). */
const sameTurn = (s: GameState) => s.turnNumber;
const CASES: Case[] = [
  // Door A from the hunter's saved state (the Corp's END_TURN, Corp 5): bait (run, click, click, run), honest (3 clicks, run)
  {
    name: 'A state corp5 bait',
    board: () => structuredClone(DOOR_A),
    runnerTurn: sameTurn,
    line: s => (s.runner.clicks === 4 || s.runner.clicks === 1 ? run('remote-1') : s.runner.clicks > 0 ? credit : null),
  },
  {
    name: 'A state corp5 honest',
    board: () => structuredClone(DOOR_A),
    runnerTurn: sameTurn,
    line: s => (s.runner.clicks === 1 ? run('remote-1') : s.runner.clicks > 0 ? credit : null),
  },
  // mirror: the Runner draws with three clicks and makes the 1-credit run on its last click (no click left after it)
  {
    name: 'A state corp5 mirror-lastclick',
    board: () => structuredClone(DOOR_A),
    runnerTurn: sameTurn,
    line: s => (s.runner.clicks === 1 ? run('remote-1') : s.runner.clicks > 0 ? draw : null),
  },
  ...[4, 5, 6, 7].flatMap(c => [
    {
      name: `A board corp${c} bait`,
      board: (t: Tree) => boardA(t, c),
      runnerTurn: sameTurn,
      line: (s: GameState) => (s.runner.clicks === 4 || s.runner.clicks === 1 ? run('remote-1') : s.runner.clicks > 0 ? credit : null),
    },
    {
      name: `A board corp${c} honest`,
      board: (t: Tree) => boardA(t, c),
      runnerTurn: sameTurn,
      line: (s: GameState) => (s.runner.clicks === 1 ? run('remote-1') : s.runner.clicks > 0 ? credit : null),
    },
    {
      name: `A board corp${c} mirror-lastclick`,
      board: (t: Tree) => boardA(t, c),
      runnerTurn: sameTurn,
      line: (s: GameState) => (s.runner.clicks === 1 ? run('remote-1') : s.runner.clicks > 0 ? draw : null),
    },
  ]),
  ...[6, 7].flatMap(c => [
    {
      name: `B corp${c} bait (hq, click, click, remote)`,
      board: (t: Tree) => boardB(t, c),
      runnerTurn: sameTurn,
      line: (s: GameState) => (s.runner.clicks === 4 ? run('hq') : s.runner.clicks === 1 ? run('remote-1') : s.runner.clicks > 0 ? credit : null),
    },
    {
      name: `B corp${c} honest (3 clicks, remote)`,
      board: (t: Tree) => boardB(t, c),
      runnerTurn: sameTurn,
      line: (s: GameState) => (s.runner.clicks === 1 ? run('remote-1') : s.runner.clicks > 0 ? credit : null),
    },
    {
      name: `B corp${c} mirror-lastclick (3 draws, hq)`,
      board: (t: Tree) => boardB(t, c),
      runnerTurn: sameTurn,
      line: (s: GameState) => (s.runner.clicks === 1 ? run('hq') : s.runner.clicks > 0 ? draw : null),
    },
  ]),
  // Door C: the Runner runs remote-1 with every click (d1.ts); mirror: one click only (the run term's "out" is then the turn's)
  {
    name: 'C bait (run every click)',
    board: t => boardC(t),
    runnerTurn: sameTurn,
    line: s => (s.runner.clicks > 0 && s.corp.servers['remote-1'] ? run('remote-1') : s.runner.clicks > 0 ? credit : null),
  },
  {
    name: 'C mirror-lastclick (3 draws, one run)',
    board: t => boardC(t),
    runnerTurn: sameTurn,
    line: s => (s.runner.clicks === 1 && s.corp.servers['remote-1'] ? run('remote-1') : s.runner.clicks > 0 ? draw : null),
  },
];

function play(t: Tree, c: Case) {
  t.clear();
  const s0 = c.board(t);
  const T = c.runnerTurn(s0);
  const corp = t.createAgent('corp', 'normal');
  const g = new t.GameRunner(s0, {
    corp,
    runner: scripted(t, c.line, () => T),
  });
  const rezzes: string[] = [];
  const answers: string[] = [];
  G.__brArm = true;
  let n = 0;
  for (; n < 1500 && !g.state.winner; n++) {
    const before: GameState = g.state;
    if (before.turnNumber > T && before.activePlayer === 'corp') break;
    G.__brRez = [];
    G.__brRun = null;
    if (!g.step()) break;
    const a = g.last as any;
    if (a?.type === 'REZ_CARD' && before.activeRun)
      rezzes.push(`${t.core.cardDef(t.core.findCardAnywhere(before, a.cardInstanceId)).title}@${before.activeRun.server} c${before.corp.credits} r${before.runner.credits}/${before.runner.clicks}k`);
    for (const r of G.__brRez ?? []) if (r.rule) rezzes.push(`  rule ${r.rule} ${r.title} -> ${r.r}${r.armed !== null ? ` (arm passes: ${r.armed})` : ''}`);
    if (G.__brRun)
      answers.push(
        `run term @${G.__brRun.server} clicks ${G.__brRun.clicks}: ${G.__brRun.opts.map((o: any) => `${JSON.stringify(o.a.choice?.optionId ?? o.a.choice?.kind)} ${o.v}${o.charged ? ' charged' : ''}`).join(', ')}`,
      );
  }
  G.__brArm = false;
  const e: GameState = g.state;
  return {
    stolen: e.runner.score - s0.runner.score,
    scoreArea: e.runner.scoreArea.map(x => t.core.cardDef(x).title),
    corp: e.corp.credits,
    hq: e.corp.hq.length,
    rezzes,
    answers,
    winner: e.winner ?? null,
  };
}

async function main() {
  const root = resolve('node_modules/.cache/bait-run-boards');
  const dirs = makeTrees(root, ARMS_HERE);
  const trees: Record<string, Tree> = {};
  for (const a of ARMS_HERE) trees[a] = await loadTree(a, dirs[a]);
  const rows: any[] = [];
  for (const c of CASES) {
    for (const a of ARMS_HERE) {
      const r = play(trees[a], c);
      rows.push({ case: c.name, arm: a, ...r });
      console.log(`${c.name.padEnd(42)} ${a.padEnd(12)} stolen ${r.stolen} [${r.scoreArea.join(', ')}] corp ${r.corp}c hq ${r.hq}`);
      for (const x of r.rezzes) console.log(`      ${x}`);
      for (const x of r.answers) console.log(`      ${x}`);
    }
  }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(rows, null, 1));
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
