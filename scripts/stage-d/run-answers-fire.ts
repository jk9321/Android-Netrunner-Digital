/**
 * Stage D item 1 follow-up 3, step 2 (followup3-run-answers/design-answer.md, bar section 5 and 8.4-8.5): the fire count
 * and the time of the run term, both sides, against beta. At every decision of the recorded sample (the 56 local deals,
 * driven by beta's Normal agents; the human games, their recorded moves), a fresh Normal agent of the acting side decides
 * on a copy of the state in each tree, each its own module graph, every hand cache cleared first:
 *   beta    the beta commit given as BETA=<40-char sha> (git archive into .ra-tree/<sha>);
 *   here    this checkout's src (the run term and the hold owner's run stand; rez.ts is unchanged, section 9).
 * One JSON line per decision ('d': side, kind, ms per tree, changed, in a run with a Corp prompt, run-term asks and
 * decisions and hold run-stand asks inside the `here` decision), and per source a 'src' line. Changed decisions carry
 * both picks. Order of the two trees alternates by decision (the time is paired).
 *   ARGS="BETA=<sha>" SHARD=0/64 npx vite-node scripts/stage-d/run-answers-fire.ts     (sum: run-answers-fire-sum.mjs)
 * Single decisions (the bar's median of 3): ONLY=human:report-49.json#83,deal:1241#77 REPEAT=3 (DEALS=none or HUMAN=none to skip a group)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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

// ONLY=<src>#<i>,... asks those decisions alone (the bar's single decisions), each REPEAT times per tree, alternating;
// the line's ms are the medians and `all` lists every time
const only = new Set((process.env.ONLY ?? '').split(',').filter(Boolean));
const repeat = Number(process.env.REPEAT ?? 1);
let n = 0;
function decide(src: string, i: number, side: 'corp' | 'runner', state: GameState, a: Ask) {
  if (only.size && !only.has(`${src}#${i}`)) return;
  const order = n++ % 2 === 0 ? [beta, here] : [here, beta];
  const r: Record<string, ReturnType<typeof ask>> = {};
  const all: Record<string, number[]> = { beta: [], here: [] };
  for (let k = 0; k < repeat; k++) {
    for (const t of k % 2 ? [...order].reverse() : order) {
      r[t.name] = ask(t, side, state, a);
      all[t.name].push(Math.round(r[t.name].ms));
    }
  }
  if (repeat > 1) {
    for (const t of ['beta', 'here']) r[t].ms = [...all[t]].sort((x, y) => x - y)[Math.floor(repeat / 2)];
    console.log(JSON.stringify({ kind: 'times', src, i, all }));
  }
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
  for (const t of [beta, here]) t.loops.clear();
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
  for (const t of [beta, here]) t.loops.clear();
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
