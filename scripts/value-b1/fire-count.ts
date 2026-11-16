/**
 * V-B B1 (brief rev 2 step B1, ruling 1): the cache keys' fire count and time, per cache. At each recorded decision (the
 * 56 local deals played by this tree's Normal AIs, and Jeff's games replayed; split by SHARD), a fresh Normal agent of
 * the acting side decides on a copy of the state in several trees, each its own module graph (a copy of src/ under
 * .fc-variants/<shard>/<arm>/), made from this tree by text patches that put a cache's old key back:
 *   base       every key as on beta (the branch point);
 *   branch     this tree;
 *   <cache>    only that change made (entry: a drawn card's two side entrances through cardRate; the three cache keys
 *              were measured in runs 43876047121 and 43890327131 and are kept incomplete, review M1);
 *   no-<cache> every key completed but that one (leave-one-out).
 * base, branch and the three <cache> trees decide every decision (their times are the time per cache, same decisions,
 * order rotated); where base and branch pick differently the no-<cache> trees decide too. `causes`: a cache alone
 * reproduces the branch's pick; `needs`: without that cache the pick goes back to base's. A change no cache reproduces
 * (no cause and no need) is a stop. Caches are cleared before each decision (the method of every other step), so this
 * counts wrong hits within a decision; across decisions play keeps the maps for the game. One JSON line per decision;
 * sum with fire-count-sum.mjs.   SHARD=0/64 npx vite-node scripts/value-b1/fire-count.ts > fc-0.txt
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameAction, GameState, actingSide, createInitialGameState, executeAction, findCardAnywhere } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';

/** Text patches that put each change's base text back (each must match exactly once), by change. A later step passes its
 * own as a JSON file `{ "<change>": [[file under src/, branch text, base text], ...] }` in ARGS (V-B B2 onward). */
const patchFile = process.argv.slice(2).find(a => a.endsWith('.json')) ?? (process.env.ARGS?.trim().endsWith('.json') ? process.env.ARGS.trim() : undefined);
const OFF: Record<string, [file: string, from: string, to: string][]> = patchFile
  ? JSON.parse(readFileSync(patchFile, 'utf8'))
  : {
      entry: [
        ['ai/handValues.ts', "'ownHandValue drawWorth', state, side === actingSide() ? cardRate(state, side) : drawWorth(state, side), side)", "'ownHandValue drawWorth', state, drawWorth(state, side), side)"],
        ['ai/handValues.ts', "'clickWorth drawWorth', state, side === actingSide() ? cardRate(state, side) : drawWorth(state, side), side)", "'clickWorth drawWorth', state, drawWorth(state, side), side)"],
      ],
    };
/** V-B B5: `_probe` patches go into every tree, the branch's too (then a copy), to count work by a global hook; `_flags`
 * names card codes, and each decision records which of them the Runner's deck or identity holds. */
const PROBE = OFF._probe ?? [];
const FLAGS = ((OFF._flags ?? []) as unknown as string[]).filter(Boolean);
delete OFF._probe;
delete OFF._flags;
const CACHES = Object.keys(OFF);

type Cache = string;
type Arm = string;

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve('.fc-variants', String(shard));

function makeTrees(): Record<Arm, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = { branch: resolve('.') } as Record<Arm, string>;
  const arms: [Arm, Cache[]][] = [...(PROBE.length ? [['branch', []] as [Arm, Cache[]]] : []), ['base', [...CACHES]], ...CACHES.map(c => [c, CACHES.filter(x => x !== c)] as [Arm, Cache[]]), ...CACHES.map(c => [`no-${c}`, [c]] as [Arm, Cache[]])];
  for (const [arm, off] of arms) {
    const dir = join(root, arm);
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [file, from, to] of [...off.flatMap(cache => OFF[cache]), ...PROBE]) {
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
  createAgent: typeof createAgent;
  clear: () => void;
  /** Runs `fn` with a value sink on: every value asked at the root (not in a leaf, playout or reply), by site and arguments. */
  rootValues: (fn: () => void) => Map<string, number>;
}

/**
 * V-B B3 on (ruling 6a, the AI Coordinator 17:23Z): the owners priced on the same boards. In base and branch, each value
 * asked at the decision's root is keyed by its site, its arguments (a card by instance id) and the board it was asked on
 * (a fingerprint of the state); a key both trees asked is compared. SITES=0 turns it off.
 */
const SITES = process.env.SITES !== '0';
const prints = new WeakMap<object, string>();
const boardPrint = (s: GameState): string => {
  let p = prints.get(s);
  if (p === undefined) {
    const zone = (cs: CardInstance[]) => cs.map(c => `${c.instanceId}${c.isRezzed ? 'r' : ''}${c.advancementCounters ?? ''}${JSON.stringify(c.tokens ?? {})}`).join(',');
    const servers = Object.values(s.corp.servers).map(v => `${v.id}:${zone(v.ice)}/${zone(v.root)}`).join(';');
    const rig = zone([...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources]);
    p = [s.turnNumber, s.activePlayer, s.phase, s.corp.credits, s.corp.clicks, s.corp.score, s.corp.hq.length, s.corp.rd.length, s.corp.archives.faceUp.length + s.corp.archives.faceDown.length, s.runner.credits, s.runner.clicks, s.runner.score, s.runner.tags, s.runner.grip.length, s.runner.stack.length, s.runner.heap.length, servers, rig, s.activeRun ? JSON.stringify(s.activeRun).length : '', s.pendingPrompts.length].join('|');
    prints.set(s, p);
  }
  return p;
};
const argKey = (a: unknown): string => {
  if (a === null || a === undefined || typeof a !== 'object') return String(a);
  if (Array.isArray(a)) return `[${a.map(argKey).join(',')}]`;
  const o = a as { instanceId?: string; corp?: unknown };
  if (typeof o.instanceId === 'string') return o.instanceId;
  if (o.corp !== undefined) return 'S';
  return 'o';
};
async function load(dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const tm = await m('ai/threatModel.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  const dg = await m('ai/diagnostics.ts');
  const pr = await m('ai/pricing.ts');
  return {
    rootValues: (fn: () => void) => {
      const out = new Map<string, number>();
      dg.withDiagnostics((d: { replying: boolean; onValue?: unknown }) => {
        d.onValue = (_q: string, site: string, state: GameState | undefined, value: number, args: readonly unknown[]) => {
          const c = pr.pricing();
          if (d.replying || c.leaves.length || c.frozen || c.side === null) return;
          const k = `${site}|${state ? boardPrint(state) : '-'}|${args.map(argKey).join(',')}`;
          if (!out.has(k)) out.set(k, value);
        };
        fn();
      });
      return out;
    },
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
  const dirs = makeTrees();
  const trees = {} as Record<Arm, Tree>;
  for (const arm of Object.keys(dirs) as Arm[]) trees[arm] = await load(dirs[arm]);
  const ask = (arm: Arm, side: 'corp' | 'runner', s: GameState) => {
    const tree = trees[arm];
    tree.clear();
    const agent = tree.createAgent(side, 'normal');
    const copy = structuredClone(s);
    // _probe: clock prices by viewer, and their milliseconds (`<viewer>ms`; a clock inside a clock counts in both)
    const tl = { corp: 0, runner: 0, corpms: 0, runnerms: 0 } as Record<string, number>;
    (globalThis as { __tl?: (v: string, ms?: number) => void }).__tl = (v, ms = 0) => {
      tl[v] = (tl[v] ?? 0) + 1;
      tl[`${v}ms`] = Math.round(((tl[`${v}ms`] ?? 0) + ms) * 10) / 10;
    };
    const t = performance.now();
    let a: GameAction | null;
    try {
      a = agent.chooseAction(copy);
    } catch (e) {
      return { a: `error: ${(e as Error).message}`, ms: 0, tl };
    }
    return { a: key(a), ms: performance.now() - t, tl };
  };
  const TIMED: Arm[] = ['base', 'branch', ...CACHES];
  let n = 0;
  const decision = (src: string, i: number, s: GameState) => {
    const side = actingSide(s);
    if (!side || s.winner) return;
    const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    const k = n++ % TIMED.length;
    const order = [...TIMED.slice(k), ...TIMED.slice(0, k)];
    const r = {} as Record<Arm, { a: string; ms: number; tl: Record<string, number> }>;
    for (const arm of order) r[arm] = ask(arm, side, s);
    const changed = r.base.a !== r.branch.a;
    const causes: string[] = [];
    const needs: string[] = [];
    if (changed) {
      for (const c of CACHES) if (r[c].a === r.branch.a) causes.push(c);
      for (const c of CACHES) if (ask(`no-${c}`, side, s).a === r.base.a) needs.push(c);
    }
    const ms = Object.fromEntries(TIMED.map(a => [a, Math.round(r[a].ms * 10) / 10]));
    const tl = PROBE.length ? Object.fromEntries(TIMED.map(a => [a, r[a].tl])) : undefined;
    // Each flagged card the Runner holds, by zone (id, rig, grip, stack, heap): "<code>:<zone>"
    const r_ = s.runner;
    const zones: [string, CardInstance[]][] = [['id', [r_.identity]], ['rig', [...r_.rig.programs, ...r_.rig.hardware, ...r_.rig.resources]], ['grip', r_.grip], ['stack', r_.stack], ['heap', r_.heap]];
    const flags = FLAGS.length ? zones.flatMap(([z, cs]) => [...new Set(cs.map(c => c.cardCode).filter(c => FLAGS.includes(c)))].map(c => `${c}:${z}`)) : undefined;
    // Ruling 6a: per site, the root values both trees asked on the same board with the same arguments: [asked in both,
    // differ, largest |difference|, over 2x or 10 credits], and the worst example
    let sites: Record<string, [number, number, number, number, string?]> | undefined;
    if (SITES) {
      const got = { base: new Map<string, number>(), branch: new Map<string, number>() };
      for (const arm of ['base', 'branch'] as const) {
        const m = trees[arm].rootValues(() => {
          const a = ask(arm, side, s).a;
          if (a.startsWith('error')) throw new Error(`site pass ${arm}: ${a}`);
        });
        got[arm] = m;
        if (process.env.FC_DEBUG) console.error(arm, m.size, [...m.keys()].slice(0, 2));
      }
      sites = {};
      for (const [k, b] of got.base) {
        const h = got.branch.get(k);
        if (h === undefined) continue;
        const site = k.slice(0, k.indexOf('|'));
        const row = (sites[site] ??= [0, 0, 0, 0]);
        row[0]++;
        const same = b === h || (Number.isNaN(b) && Number.isNaN(h));
        if (same) continue;
        const d = Math.abs(h - b);
        row[1]++;
        const big = d > 10 || (Math.max(Math.abs(b), Math.abs(h)) > 0.5 && (Math.abs(h) > 2 * Math.abs(b) || Math.abs(b) > 2 * Math.abs(h)));
        if (big) row[3]++;
        if (!(d <= row[2])) {
          row[2] = Math.round(d * 1000) / 1000;
          row[4] = `${k.slice(k.lastIndexOf('|') + 1)}: ${Math.round(b * 1000) / 1000} -> ${Math.round(h * 1000) / 1000}`;
        }
      }
    }
    // V-B B2's watch (non-money upgrade rezzes): the card a REZ_CARD pick rezzes, in base and branch
    const rezzed = (pick: string) => (pick.startsWith('{') && JSON.parse(pick).type === 'REZ_CARD' ? findCardAnywhere(s, JSON.parse(pick).cardInstanceId)?.cardCode : undefined);
    const rez = { base: rezzed(r.base.a), branch: rezzed(r.branch.a) };
    console.log(JSON.stringify({ src, i, side, kind, T: s.turnNumber, changed, causes, needs, base: changed ? r.base.a : undefined, branch: changed ? r.branch.a : undefined, rez: rez.base || rez.branch ? rez : undefined, ms, tl, flags, sites }));
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
  if (existsSync(root) && !process.env.FC_KEEP) rmSync(root, { recursive: true, force: true });
}

void main();
