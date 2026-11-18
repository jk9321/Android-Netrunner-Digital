/**
 * Stage D item 1 follow-up 3, step 2 (followup3-run-answers/design-answer.md, bar section 5 and 8.4-8.5): the fire count
 * and the time of the run term, both sides, against beta. At every decision of the recorded sample (the 56 local deals,
 * driven by beta's Normal agents; the human games, their recorded moves), a fresh Normal agent of the acting side decides
 * on a copy of the state in each tree, each its own module graph, every hand cache cleared first:
 *   beta    the beta commit given as BETA=<40-char sha> (git archive into .ra-tree/<sha>);
 *   here    this checkout's src (the run term, the hold owner's run stand, LEO folded onto runLoss);
 *   nofold  this checkout's src with leoGain's stolen-board branch put back (rez windows only: the fold's own arm).
 * One JSON line per decision ('d': side, kind, ms per tree, changed, in a run with a Corp prompt, run-term asks and
 * decisions and hold run-stand asks inside the `here` decision), and per source a 'src' line. Changed decisions carry
 * both picks. Order of the two trees alternates by decision (the time is paired).
 *   ARGS="BETA=<sha>" SHARD=0/64 npx vite-node scripts/stage-d/run-answers-fire.ts     (sum: run-answers-fire-sum.mjs)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import type { Agent } from '../../src/ai/agent';

const ARGS = `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`;
const betaSha = /BETA=([0-9a-f]{40})/.exec(ARGS)?.[1];
if (!betaSha) throw new Error('run-answers-fire: BETA=<40-char sha> is required');

function archived(sha: string): string {
  const dir = resolve('.ra-tree', sha);
  if (existsSync(join(dir, 'src', 'core', 'index.ts'))) return dir;
  for (let k = 0; ; k++) {
    try {
      execSync(`git cat-file -e ${sha}^{commit}`, { stdio: 'ignore' });
      break;
    } catch {
      if (k >= 10) throw new Error(`run-answers-fire: could not fetch ${sha}`);
      try {
        execSync(`git fetch -q --depth=1 origin ${sha}`, { stdio: 'ignore' });
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 + Math.floor(Math.random() * 1500));
      }
    }
  }
  const tmp = `${dir}.${process.pid}`;
  mkdirSync(tmp, { recursive: true });
  execSync(`git archive ${sha} src | tar -x -C ${tmp}`);
  try {
    execSync(`mv ${tmp} ${dir}`, { stdio: 'ignore' });
  } catch {
    execSync(`rm -rf ${tmp}`);
  }
  return dir;
}

/** This checkout's src with leoGain as on beta (the stolen board for the root's agendas). */
const FOLD_NEW = "  return evaluate(next(after), 'corp') - (evaluate(state, 'corp') - runLoss(state));\n}";
const FOLD_OLD = `  const server = state.corp.servers[state.activeRun!.server];
  const agendas = server.root.filter(c => type(c) === 'agenda');
  let letIn: number;
  if (agendas.length > 0) {
    const stolen = structuredClone(state);
    const root = stolen.corp.servers[server.id].root;
    for (const a of agendas) {
      const i = root.findIndex(c => c.instanceId === a.instanceId);
      stolen.runner.scoreArea.push(...root.splice(i, 1));
      stolen.runner.score += cardDef(a).agenda_points ?? 0;
    }
    stolen.activeRun = null;
    letIn = evaluate(next(stolen), 'corp');
  } else letIn = evaluate(state, 'corp') - runLoss(state);
  return evaluate(next(after), 'corp') - letIn;
}`;
function noFold(): string {
  const dir = resolve('.ra-tree', `nofold-${process.pid}`);
  execSync(`rm -rf ${dir} && mkdir -p ${dir} && cp -r src ${dir}/src`);
  const file = join(dir, 'src', 'ai', 'corp', 'rez.ts');
  const text = readFileSync(file, 'utf8');
  if (text.split(FOLD_NEW).length !== 2) throw new Error('run-answers-fire: the fold patch does not match once');
  writeFileSync(file, text.replace(FOLD_NEW, FOLD_OLD));
  return dir;
}

interface Tree {
  name: string;
  core: typeof import('../../src/core');
  ai: typeof import('../../src/ai');
  playout: typeof import('../../src/ai/playout');
  clear: () => void;
  loops: { clear(): void };
  stats: () => { asked: number; decided: number; stands: number; searched: number };
}
async function tree(name: string, root: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(root, 'src', p));
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const prompts = await m('ai/prompts.ts');
  const hold = await m('ai/corp/hold.ts');
  return {
    name,
    core: await m('core/index.ts'),
    ai: await m('ai/index.ts'),
    playout: await m('ai/playout.ts'),
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
    },
    loops: vm.valueLoops,
    stats: () => ({ asked: prompts.runTermStats?.asked ?? 0, decided: prompts.runTermStats?.decided ?? 0, stands: hold.runStandStats?.asked ?? 0, searched: hold.runStandStats?.searched ?? 0 }),
  };
}

const beta = await tree('beta', archived(betaSha));
const here = await tree('here', resolve('.'));
const nofold = await tree('nofold', noFold());

type Ask = { method: 'chooseAction' | 'chooseRez' | 'chooseOffTurn'; cards?: CardInstance[] };
const key = (a: GameAction | null) => JSON.stringify(a);

/** One tree's fresh agent on a copy of the state: its pick, time, and the run term's counts inside it. */
function ask(t: Tree, side: 'corp' | 'runner', state: GameState, a: Ask) {
  t.clear();
  const agent = t.ai.createAgent(side, 'normal') as Agent;
  const s = structuredClone(state);
  const s0 = t.stats();
  const t0 = performance.now();
  let pick: GameAction | null;
  try {
    pick = a.method === 'chooseRez' ? (agent.chooseRez?.(s, structuredClone(a.cards ?? [])) ?? null) : a.method === 'chooseOffTurn' ? (agent.chooseOffTurn?.(s) ?? null) : agent.chooseAction(s);
  } catch (e) {
    return { pick: `error ${(e as Error).message}`, ms: performance.now() - t0, d: { asked: 0, decided: 0, stands: 0, searched: 0 } };
  }
  const ms = performance.now() - t0;
  const s1 = t.stats();
  return { pick: key(pick), ms, d: { asked: s1.asked - s0.asked, decided: s1.decided - s0.decided, stands: s1.stands - s0.stands, searched: s1.searched - s0.searched } };
}

let n = 0;
function decide(src: string, i: number, side: 'corp' | 'runner', state: GameState, a: Ask) {
  const order = n++ % 2 === 0 ? [beta, here] : [here, beta];
  const r: Record<string, ReturnType<typeof ask>> = {};
  for (const t of order) r[t.name] = ask(t, side, state, a);
  const prompt = beta.core.activePrompt(state);
  const inRun = !!state.activeRun && !!prompt && prompt.side === 'corp';
  const line: Record<string, unknown> = {
    kind: 'd', src, i, side, m: a.method, T: state.turnNumber, inRun,
    ms: [Math.round(r.beta.ms * 10) / 10, Math.round(r.here.ms * 10) / 10],
    changed: r.beta.pick !== r.here.pick,
    run: r.here.d,
  };
  if (line.changed) {
    line.picks = { beta: r.beta.pick.slice(0, 300), here: r.here.pick.slice(0, 300) };
    line.card = prompt && 'source' in prompt ? `${prompt.source.cardCode}:${prompt.source.step}` : null;
    line.server = state.activeRun?.server ?? null;
  }
  // The fold's own arm: a rez window of the Corp's, LEO folded (here) against not (nofold)
  if (side === 'corp' && a.method === 'chooseRez') {
    const f = ask(nofold, side, state, a);
    line.fold = f.pick !== r.here.pick ? { nofold: f.pick.slice(0, 200), here: r.here.pick.slice(0, 200) } : false;
  }
  console.log(JSON.stringify(line));
}

let dealStateOf: (seed: number) => GameState;
{
  const root = archived(betaSha);
  const d = await import(/* @vite-ignore */ join(root, 'src', 'data', 'decks.ts'));
  const nsg = await import(/* @vite-ignore */ join(root, 'src', 'data', 'testDecks', 'nsgSamples.ts'));
  const ALL = [...d.STARTER_DECKS, ...nsg.NSG_SAMPLE_DECKS];
  dealStateOf = (seed: number) => {
    const corpDecks = ALL.filter((x: { side: string }) => x.side === 'corp');
    const runnerDecks = ALL.filter((x: { side: string }) => x.side === 'runner');
    const p = Math.floor((seed - 1001) / 10);
    return beta.core.createInitialGameState(d.deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length]));
  };
  (globalThis as { __deckSetup?: unknown }).__deckSetup = d.deckGameSetup;
}

function playDeal(seed: number) {
  for (const t of [beta, here, nofold]) t.loops.clear();
  const src = `deal:${seed}`;
  const counter = { corp: 0, runner: 0 };
  const drive = { corp: beta.ai.createAgent('corp', 'normal') as Agent, runner: beta.ai.createAgent('runner', 'normal') as Agent };
  const wrap = (side: 'corp' | 'runner'): Agent =>
    ({
      side,
      chooseAction(state: GameState) {
        decide(src, counter[side]++, side, state, { method: 'chooseAction' });
        beta.clear();
        return drive[side].chooseAction(state);
      },
      chooseRez(state: GameState, cards: CardInstance[]) {
        decide(src, counter[side]++, side, state, { method: 'chooseRez', cards });
        beta.clear();
        return drive[side].chooseRez?.(state, cards) ?? null;
      },
      chooseOffTurn(state: GameState) {
        decide(src, counter[side]++, side, state, { method: 'chooseOffTurn' });
        beta.clear();
        return drive[side].chooseOffTurn?.(state) ?? null;
      },
    }) as Agent;
  const t0 = performance.now();
  const game = new beta.playout.GameRunner(dealStateOf(seed), { corp: wrap('corp'), runner: wrap('runner') });
  for (let k = 0; k < 4000 && game.step(); k++);
  console.log(JSON.stringify({ kind: 'src', src, winner: game.state.winner ?? null, turns: game.state.turnNumber, decisions: counter, ms: Math.round(performance.now() - t0) }));
}

function replayHuman(file: string) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const src = `human:${file.split('/').pop()}`;
  if (!report.moves?.length) return;
  for (const t of [beta, here, nofold]) t.loops.clear();
  const setup = (globalThis as { __deckSetup?: (...a: unknown[]) => unknown }).__deckSetup!;
  let s: GameState = beta.core.createInitialGameState(setup(report.config.seed, report.config.corpDeck, report.config.runnerDeck) as never);
  if (report.startStops) s = { ...s, stops: report.startStops };
  const counter = { corp: 0, runner: 0 };
  const t0 = performance.now();
  for (const move of report.moves as GameAction[]) {
    const side = beta.core.actingSide(s);
    const w = s.priority;
    if (side && !s.winner) {
      const ai = { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState;
      if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
        if (beta.core.wantsStop(ai, side, w)) {
          if (side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) decide(src, counter.corp++, 'corp', s, { method: 'chooseRez', cards: beta.playout.rezCandidates(s, w.step) });
          else if (side === 'runner' && w.step === 'corp_action') decide(src, counter.runner++, 'runner', s, { method: 'chooseOffTurn' });
        }
      } else decide(src, counter[side]++, side, s, { method: 'chooseAction' });
    }
    try {
      s = beta.core.executeAction(s, move);
    } catch {
      break;
    }
  }
  console.log(JSON.stringify({ kind: 'src', src, winner: s.winner ?? null, turns: s.turnNumber, decisions: counter, ms: Math.round(performance.now() - t0) }));
}

const list = (k: string) => (process.env[k] ?? '').split(',').filter(Boolean);
const dealList = list('DEALS').includes('none') ? [] : list('DEALS').length ? list('DEALS').map(Number) : Array.from({ length: 56 }, (_, k) => 1001 + 40 * k);
const humanList = list('HUMAN').includes('none')
  ? []
  : readdirSync('tests/fixtures/human-games')
      .filter(f => f.endsWith('.json'))
      .filter(f => !list('HUMAN').length || list('HUMAN').some(w => f.startsWith(w)))
      .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
      .map(f => join('tests/fixtures/human-games', f));
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const sources: (() => void)[] = [...dealList.map(seed => () => playDeal(seed)), ...humanList.map(f => () => replayHuman(f))];
console.error(`run-answers-fire: beta ${betaSha}, ${sources.length} sources, shard ${shard}/${shards}`);
sources.forEach((run, k) => {
  if (k % shards === shard) run();
});
