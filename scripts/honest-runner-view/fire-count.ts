/**
 * ai-honest-runner-view (brief rev 2, "Bar"; red team finding 5): the fire count, split by cause, for Runner AND Corp
 * picks. At each recorded decision (the 56 local deals played by this tree's Normal AIs, and the human games replayed;
 * split by SHARD), a fresh Normal agent of the acting side decides on a copy of the state in several trees, each its own
 * module graph (a copy of src/ under .fc-variants/<shard>/<arm>/):
 *   beta     the branch point, beta b7c4917 (fetched from codeload.github.com);
 *   branch   this tree;
 *   none     this tree with all five fixes below turned off (what is left is the view's plumbing: the baseline on the
 *            view, runScore on the view, the prompt guard, the memoised view);
 *   <cause>  this tree with only that fix on: ice (boardNeed's unseen ice cost), agenda (boardNeed's agenda odds),
 *            loose (the HQ/R&D/Archives deal), installed (the facedown installed deal), pool (the tag-punisher pool);
 *   deal     the two deals together (they share one pool, so one alone is another deal, not half of this one);
 *   no-<cause> this tree with only that fix off (leave-one-out: `needs` lists the fixes the change goes away without).
 * Where beta's pick and the branch's differ, the decision is asked again in every cause tree: a cause reproduces the
 * change when its pick is the branch's; `struct` when none's pick differs from beta's. A change nothing reproduces is
 * a stop. The Corp's picks change through the Runner inside its reply (fixes ice, agenda, pool): a correction of the
 * Corp's model of the Runner. One JSON line per decision. Sum with fire-count-sum.mjs.
 *   SHARD=0/64 npx vite-node scripts/honest-runner-view/fire-count.ts > fc-0.txt
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameAction, GameState, actingSide, executeAction } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';
import { createInitialGameState } from '../../src/core';

const BETA = 'b7c49173147eca27627aaed0b543f2f2129a86df';
const CAUSES = ['ice', 'agenda', 'loose', 'installed', 'pool'] as const;
type Cause = (typeof CAUSES)[number];
type Arm = 'beta' | 'branch' | 'none' | 'deal' | Cause | `no-${Cause}`;

/** Text patches that turn each fix off (each must match exactly once). */
const OFF: Record<Cause, [file: string, from: string, to: string][]> = {
  ice: [['ai/valueModel.ts', 'ice.faceUp || ice.runnerKnows ? (plan().oneRezMoney ? rezCostOf(state, ice) : cardDef(ice).cost ?? 0) : corpIceMean(state)', '(plan().oneRezMoney ? rezCostOf(state, ice) : cardDef(ice).cost ?? 0)']],
  agenda: [['ai/valueModel.ts', 'const guard = server.isRemote ? remoteAgendaChance(state, server) : 1;', "const guard = server.isRemote ? (server.root.some(c => cardDef(c).type_code === 'agenda') ? 1 : 0) : 1;"]],
  loose: [['ai/runnerReply.ts', 'const { ice, root, loose } = runnerUnknownSlots(s, memory);', 'const { ice, root, loose: __l } = runnerUnknownSlots(s, memory); const loose: CardInstance[] = []; void __l;']],
  installed: [['ai/runnerReply.ts', 'const codes = [...ice, ...root, ...loose].map(c => c.cardCode);', 'ice.length = 0; root.length = 0; const codes = [...ice, ...root, ...loose].map(c => c.cardCode);']],
  pool: [['ai/evaluate.ts', 'const unseen = unseenCorpPool(state);\n    const share', 'const unseen = [...corp.hq, ...corp.rd];\n    const share']],
};

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve('.fc-variants', String(shard));

function makeTrees(): Record<Arm, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = {} as Record<Arm, string>;
  // beta: its src/ from the tarball (cached across this runner's processes is not needed: each takes its own copy)
  const beta = join(root, 'beta');
  mkdirSync(beta, { recursive: true });
  const tgz = join(root, 'beta.tgz');
  execSync(`curl -sSfL --retry 4 -o ${tgz} https://codeload.github.com/jk9321/Android-Netrunner-Digital/tar.gz/${BETA}`);
  execSync(`tar -xzf ${tgz} -C ${beta} --strip-components=1 --wildcards '*/src/*'`);
  dirs.beta = beta;
  dirs.branch = resolve('.');
  const arms: [Arm, Cause[]][] = [
    ['none', [...CAUSES]],
    ['deal', ['ice', 'agenda', 'pool']],
    ...CAUSES.map(c => [c, CAUSES.filter(x => x !== c)] as [Arm, Cause[]]),
    ...CAUSES.map(c => [`no-${c}`, [c]] as [Arm, Cause[]]),
  ];
  for (const [arm, off] of arms) {
    const dir = join(root, arm);
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const cause of off) {
      for (const [file, from, to] of OFF[cause]) {
        const path = join(dir, 'src', file);
        const text = readFileSync(path, 'utf8');
        if (text.split(from).length !== 2) throw new Error(`patch ${cause} does not match once in ${file}`);
        writeFileSync(path, text.replace(from, to));
      }
    }
    dirs[arm] = dir;
  }
  return dirs;
}

interface Tree {
  createAgent: typeof createAgent;
  clear: () => void;
}
async function load(dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const tm = await m('ai/threatModel.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  return {
    createAgent: ai.createAgent,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      tm.clearThreatCaches();
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
  };
}

const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');

async function main() {
  const dirs = makeTrees();
  const trees = {} as Record<Arm, Tree>;
  for (const arm of Object.keys(dirs) as Arm[]) trees[arm] = await load(dirs[arm]);
  const ask = (arm: Arm, side: 'corp' | 'runner', s: GameState) => {
    const tree = trees[arm];
    tree.clear();
    const agent = tree.createAgent(side, 'normal');
    const t = performance.now();
    let a: GameAction | null;
    try {
      a = agent.chooseAction(structuredClone(s));
    } catch (e) {
      return { a: `error: ${(e as Error).message}`, ms: 0 };
    }
    return { a: key(a), ms: performance.now() - t };
  };
  let n = 0;
  const decision = (src: string, i: number, s: GameState) => {
    const side = actingSide(s);
    if (!side || s.winner) return;
    const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    if (side === 'corp' && kind !== 'main') return; // the Corp: its ordinary moves (as the honest-order count)
    if (side === 'runner' && kind === 'run') return; // run steps read rezzed ice and credits only (checked in the hand-off)
    const order: Arm[] = n++ % 2 ? ['beta', 'branch'] : ['branch', 'beta'];
    const r = {} as Record<Arm, { a: string; ms: number }>;
    for (const arm of order) r[arm] = ask(arm, side, s);
    const changed = r.beta.a !== r.branch.a;
    // causes: the fix alone reproduces the branch's pick (deal: the two deals together, which share one pool);
    // needs: without that fix the branch's pick goes back to beta's (leave-one-out)
    const causes: string[] = [];
    const needs: string[] = [];
    if (changed) {
      for (const c of CAUSES) if (ask(c, side, s).a === r.branch.a) causes.push(c);
      if (ask('deal', side, s).a === r.branch.a) causes.push('deal');
      if (ask('none', side, s).a !== r.beta.a) causes.push('struct');
      for (const c of CAUSES) if (ask(`no-${c}`, side, s).a === r.beta.a) needs.push(c);
    }
    console.log(JSON.stringify({ src, i, side, kind, T: s.turnNumber, changed, causes, needs, beta: changed ? r.beta.a : undefined, branch: changed ? r.branch.a : undefined, msBeta: Math.round(r.beta.ms), msBranch: Math.round(r.branch.ms) }));
  };

  const sources: (() => void)[] = [
    ...deals().map(seed => () => {
      const src = `deal:${seed}`;
      let i = 0;
      const watch = (inner: Agent): Agent =>
        new Proxy(inner, {
          get(target, prop, recv) {
            if (prop === 'chooseAction') return (state: GameState) => (decision(src, i++, state), target.chooseAction(state));
            return Reflect.get(target, prop, recv);
          },
        });
      const game = new GameRunner(dealState(seed), { corp: watch(createAgent('corp', 'normal')), runner: watch(createAgent('runner', 'normal')) });
      for (let k = 0; k < 4000 && game.step(); k++);
    }),
    ...humanFiles().map(file => () => {
      const report = JSON.parse(readFileSync(file, 'utf8'));
      if (!report.moves?.length) return;
      const src = `human:${file.split('/').pop()}`;
      let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
      if (report.startStops) s = { ...s, stops: report.startStops };
      let i = 0;
      for (const move of report.moves as GameAction[]) {
        // A human game: ask at each state where the side that moved is the acting side (its main phase or its prompt)
        if (actingSide(s) === move.player && !(s.priority && s.priority.holder === 'corp' && s.activePlayer === 'runner')) decision(src, i++, s);
        try {
          s = executeAction(s, move);
        } catch {
          break;
        }
      }
    }),
  ];
  sources.forEach((run, k) => {
    if (k % shards === shard) run();
  });
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

void main();
