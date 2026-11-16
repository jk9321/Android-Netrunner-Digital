/**
 * ai-threat-delete (brief-threat-delete.md rev 2, "Proof"): the local fire count, both sides. At each recorded decision
 * (the 56 local deals played by this tree's Normal AIs, and Jeff's games replayed; split by SHARD), a fresh Normal agent
 * of the acting side decides on a copy of the state in each arm, each its own module graph:
 *   branch          this tree;
 *   <sha>[:<off>]   that commit's src/ (fetched from codeload.github.com into .fc-variants/<shard>/), with the PLAN_OFF
 *                   list <off> (names joined by '+') applied in its own module graph, e.g. c5f0ac0...:threatValues.
 * The first arm named in ARGS is the reference: a decision is `changed` when the branch's pick differs from it, and
 * every other arm's pick is compared with the reference too. Changed decisions are sorted by kind: `agenda installed`
 * (the branch installs an agenda the reference does not), `agenda held` (the reference installs an agenda the branch
 * does not), `other`. Times are per arm, the order rotated by decision. One JSON line per decision; sum with
 * fire-count-sum.mjs.
 *   SHARD=0/64 npx vite-node scripts/threat-delete/fire-count.ts -- <sha>[:<off>] [<sha>[:<off>] ...] > fc-0.txt
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';

const args = (process.argv.slice(2).filter(a => a !== '--').length ? process.argv.slice(2).filter(a => a !== '--') : (process.env.ARGS ?? '').split(/\s+/)).filter(Boolean);
if (!args.length) throw new Error('name at least one reference arm: <sha>[:<off>]');
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve('.fc-variants', String(shard));

interface Tree {
  createAgent: typeof createAgent;
  clear: () => void;
}

/** A commit's src/ from the tarball, copied into its own directory per arm (each arm its own module graph). */
function fetchTree(sha: string, arm: string): string {
  const got = join(root, `sha-${sha}`);
  if (!existsSync(join(got, 'src'))) {
    mkdirSync(got, { recursive: true });
    const tgz = join(root, `${sha}.tgz`);
    execSync(`curl -sSfL --retry 4 -o ${tgz} https://codeload.github.com/jk9321/Android-Netrunner-Digital/tar.gz/${sha}`);
    execSync(`tar -xzf ${tgz} -C ${got} --strip-components=1 --wildcards '*/src/*'`);
  }
  const dir = join(root, `arm-${arm.replace(/[^\w]+/g, '_')}`);
  cpSync(join(got, 'src'), join(dir, 'src'), { recursive: true });
  return dir;
}

async function load(dir: string, off: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const syn = await m('ai/synergy.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const tm = await m('ai/threatModel.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  if (off) syn.applyPlanOff(off.split('+').join(','));
  return {
    createAgent: ai.createAgent,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      tm.clearThreatCaches?.(); // a tree from before ai-threat-delete
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
  };
}

const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');

async function main() {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const trees: Record<string, Tree> = {};
  for (const arm of args) {
    const [sha, off = ''] = arm.split(':');
    trees[arm] = await load(fetchTree(sha, arm), off);
  }
  trees.branch = { createAgent, clear: () => {} };
  {
    // this tree's own caches, from its own graph
    const hv = await import('../../src/ai/handValues');
    const ev = await import('../../src/ai/effectValues');
    const vm = await import('../../src/ai/valueModel');
    const iv = await import('../../src/ai/iceValues');
    trees.branch.clear = () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops.clear();
    };
  }
  const ARMS = [...args, 'branch'];
  const ask = (arm: string, side: 'corp' | 'runner', s: GameState) => {
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
  const agendaInstall = (s: GameState, pick: string) => {
    if (!pick.startsWith('{')) return false;
    const a = JSON.parse(pick);
    if (a.type !== 'INSTALL_CARD') return false;
    const card = findCardAnywhere(s, a.cardInstanceId);
    return !!card && cardDef(card).type_code === 'agenda';
  };
  let n = 0;
  const decision = (src: string, i: number, s: GameState) => {
    const side = actingSide(s);
    if (!side || s.winner) return;
    const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    const k = n++ % ARMS.length;
    const order = [...ARMS.slice(k), ...ARMS.slice(0, k)];
    const r: Record<string, { a: string; ms: number }> = {};
    for (const arm of order) r[arm] = ask(arm, side, s);
    const ref = r[args[0]].a;
    const changed = r.branch.a !== ref;
    const differs = Object.fromEntries(ARMS.filter(a => a !== args[0]).map(a => [a, r[a].a !== ref]));
    const sort = !changed ? undefined : agendaInstall(s, r.branch.a) && !agendaInstall(s, ref) ? 'agenda installed' : agendaInstall(s, ref) && !agendaInstall(s, r.branch.a) ? 'agenda held' : 'other';
    const ms = Object.fromEntries(ARMS.map(a => [a, Math.round(r[a].ms * 10) / 10]));
    console.log(JSON.stringify({ src, i, side, kind, T: s.turnNumber, changed, sort, differs, ref: changed ? ref : undefined, branch: changed ? r.branch.a : undefined, ms }));
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
