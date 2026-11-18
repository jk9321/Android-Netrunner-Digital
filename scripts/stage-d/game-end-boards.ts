/**
 * Stage D item 4 step 1 (brief sections 2 and 3.5): named boards played in each tree of game-end-patches.ts. Each board is
 * the Corp's turn played by that tree's Normal Corp (this tree's Normal Runner for its windows), then the Runner's next
 * turn; printed: the Corp's moves, the ice on each server one access to which can end the game (rule 1.7.2a; the stake
 * owner's points) and whether it holds by the count at the Corp's turn end, the Runner's runs and the winner.
 *
 * Boards (all from tests/fixtures/bug-report-4-turn13.json, Corp turn 13, Corp 7 credits, Runner 6):
 *  - br4:          bug report #4 as recorded (Runner 4, Send a Message (3) in HQ: HQ can end the game).
 *  - br4-mirror:   Send a Message replaced by a Tithe (no agenda in HQ).
 *  - five:         brief 3.5: Runner 5, Longevity Serum (2) in HQ instead, Offworld Office (4/2, no counters) in remote-1's
 *                  root (Ansel, Diviner rezzed), which the Corp can score next turn and not this one.
 *  - five-mirror:  the same with Superconducting Hub (1) in HQ: HQ cannot end the game, remote-1 can.
 *  - four:         Runner 4, Send a Message (3) in HQ (HQ can end the game), Offworld Office in remote-1 as above (it cannot:
 *                  4 + 2 = 6): the order's case, a game-ending central against a scoring remote that does not end the game.
 *  - four-mirror:  the same with a Tithe in HQ instead.
 *  - deal1321:     deal 1321 (the harness seed) played by this tree's Normal AIs, from the Corp's turn TURN (default 14).
 *  PLANNER=off plays each tree's Corp without the look-ahead (the list and the counted questions only).
 *    BOARDS=br4,five ARMS=a1,a2 npx vite-node scripts/stage-d/game-end-boards.ts
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameState, cardDef } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { asSide } from '../../src/ai/pricing';
import { serverHold } from '../../src/ai/corp/hold';
import { stake } from '../../src/ai/corp/pools';
import { clearCaches, dealState } from '../stage-a/harness';
import { PATCHES, probe } from './game-end-patches';

const want = (process.env.ARMS ?? '').split(',').filter(Boolean);
const ARMS = ['base', ...Object.keys(PATCHES).filter(a => !want.length || want.includes(a))];
const root = resolve('.fc-variants', 'game-end', 'boards');

function makeTrees(): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of ARMS) {
    const dir = join(root, arm);
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [file, from, to] of [...probe, ...(PATCHES[arm] ?? [])]) {
      const path = join(dir, 'src', file);
      const text = readFileSync(path, 'utf8');
      if (text.split(from).length !== 2) throw new Error(`patch ${arm} does not match once in ${file}`);
      writeFileSync(path, text.replace(from, to));
    }
    dirs[arm] = dir;
  }
  return dirs;
}

type Tree = { corp: () => Agent };
async function load(dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const ca = await m('ai/corpAI.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const clear = () => {
    hv.clearHandCaches();
    ev.clearDamageThreats();
    vm.valueLoops?.clear();
  };
  // PLANNER=off: the list and the counted questions only (no look-ahead), to read the order's layer alone
  return { corp: () => cleared(process.env.PLANNER === 'off' ? new ca.HeuristicCorpAI({ planner: false }) : ai.createAgent('corp', 'normal'), clear) };
}

function cleared(inner: Agent, clear: () => void): Agent {
  return new Proxy(inner, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function' || !['chooseAction', 'chooseRez', 'chooseOffTurn'].includes(String(prop))) return v;
      return (...args: unknown[]) => {
        clear();
        clearCaches();
        return v.apply(target, args);
      };
    },
  });
}

const card = (code: string, id: string, extra: Partial<CardInstance> = {}): CardInstance => ({ instanceId: id, cardCode: code, isRezzed: false, advancementCounters: 0, tokens: {}, hostedCardIds: [], installedTurn: '12-corp', ...extra }) as unknown as CardInstance;
const br4 = (): GameState => JSON.parse(readFileSync('tests/fixtures/bug-report-4-turn13.json', 'utf8'));
const swapHq = (s: GameState, from: string, to: string): GameState => ({ ...s, corp: { ...s.corp, hq: s.corp.hq.map(c => (c.cardCode === from ? { ...c, cardCode: to } : c)) } });
function five(hqAgenda: string, score = 5): GameState {
  const s = swapHq(br4(), '30069', hqAgenda);
  const r1 = s.corp.servers['remote-1'];
  return { ...s, runner: { ...s.runner, score }, corp: { ...s.corp, servers: { ...s.corp.servers, 'remote-1': { ...r1, root: [...r1.root, card('30067', 'inst-9001')] } } } };
}

function deal1321(turn: number): GameState {
  const game = new GameRunner(dealState(1321), { corp: cleared(createAgent('corp', 'normal'), () => {}), runner: cleared(createAgent('runner', 'normal'), () => {}) });
  for (let k = 0; k < 4000 && !game.state.winner; k++) {
    if (game.state.activePlayer === 'corp' && game.state.turnNumber >= turn && !game.state.priority) break;
    game.step();
  }
  return game.state;
}

function ends(s: GameState) {
  return asSide('corp', () =>
    Object.keys(s.corp.servers)
      .map(id => ({ id, pts: stake(s, id).points }))
      .filter(v => s.runner.score + v.pts >= 7)
      .map(v => `${v.id}(+${v.pts}, ice ${s.corp.servers[v.id].ice.length}, ${serverHold(s, v.id, { when: 'runnerTurn' }).holds ? 'holds' : 'open'})`),
  );
}

function play(t: Tree, s0: GameState) {
  const game = new GameRunner(structuredClone(s0), { corp: t.corp(), runner: cleared(createAgent('runner', 'normal'), () => {}) });
  const moves: string[] = [];
  const t0 = s0.turnNumber;
  let n = 0;
  while (n++ < 150 && !game.state.winner && game.state.activePlayer === 'corp') {
    const st = game.state;
    game.step();
    const a = game.last as { type: string; cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean } | null;
    if (a && a.type !== 'PASS' && st.activePlayer === 'corp') {
      const c = a.cardInstanceId ? [...st.corp.hq, ...Object.values(st.corp.servers).flatMap(v => [...v.root, ...v.ice])].find(k => k.instanceId === a.cardInstanceId) : null;
      moves.push(`${a.type}${c ? ` ${cardDef(c).title}` : ''}${a.asNewRemote ? '->new' : a.targetServerId ? `->${a.targetServerId}` : ''}`);
    }
  }
  const end = game.state;
  const runs: string[] = [];
  let run: { server: string; score: number; ok: boolean } | null = null;
  while (n++ < 600 && !game.state.winner && !(game.state.activePlayer === 'corp' && game.state.turnNumber > end.turnNumber)) {
    const st = game.state;
    game.step();
    const nx = game.state;
    if (!st.activeRun && nx.activeRun) run = { server: nx.activeRun.server, score: st.runner.score, ok: false };
    if (run && nx.activeRun?.isSuccessful) run.ok = true;
    if (run && (!nx.activeRun || nx.winner)) {
      runs.push(`${run.server}${run.ok ? ' in' : ' out'}${nx.runner.score > run.score ? ` +${nx.runner.score - run.score}` : ''}`);
      run = null;
    }
  }
  return { moves, end: ends(end), ice: Object.fromEntries(['hq', 'rd', 'remote-1'].map(id => [id, end.corp.servers[id]?.ice.length])), credits: end.corp.credits, runs, winner: game.state.winner ?? null, turns: game.state.turnNumber - t0 };
}

async function main() {
  const dirs = makeTrees();
  const trees: Record<string, Tree> = {};
  for (const arm of ARMS) trees[arm] = await load(dirs[arm]);
  const boards: Record<string, () => GameState> = {
    br4,
    'br4-mirror': () => swapHq(br4(), '30069', '30073'),
    five: () => five('30044'),
    'five-mirror': () => five('30070'),
    four: () => five('30069', 4),
    'four-mirror': () => five('30073', 4),
    deal1321: () => deal1321(Number(process.env.TURN ?? 14)),
  };
  const pick = (process.env.BOARDS ?? '').split(',').filter(Boolean);
  for (const [name, make] of Object.entries(boards)) {
    if (pick.length && !pick.includes(name)) continue;
    const s = make();
    console.log(`\n### ${name}: T${s.turnNumber} score ${s.corp.score}-${s.runner.score}, Corp ${s.corp.credits}cr, can end: ${ends(s).join(', ') || 'none'}`);
    for (const arm of ARMS) {
      const r = play(trees[arm], s);
      console.log(`${arm}: ${r.moves.join(', ')}\n    turn end: ice ${JSON.stringify(r.ice)}, Corp ${r.credits}cr, can end ${r.end.join(', ') || 'none'} | Runner: ${r.runs.join(', ') || 'no run'} | winner ${r.winner ?? '-'}`);
    }
  }
  rmSync(root, { recursive: true, force: true });
}

void main();
