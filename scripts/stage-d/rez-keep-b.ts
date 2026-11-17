/**
 * Stage D item 3 step 1a, part B (brief section 2 B, Fix D9): economy assets staked in rez money.
 *
 * Trees (as scripts/value-b1/fire-count.ts): a copy of src/ per arm under .fc-variants/rez-keep/<shard>/<arm>/, made from this tree
 * by the text patches of scripts/stage-d/rez-keep-b-patches.json (no source change): `base` (a plain copy, so every arm
 * is timed in a copy), `d9` (a remote with no agenda is staked by its non-agenda root cards when their trash loses the
 * Corp worth, the Runner can get in and pay the trash cost, and that worth is more than the holding rez on the Corp's
 * credit slide), `d9-noline` (the same, but not for the scoring line's floors: lineFloor and lineKeep, which pass
 * `without`), `upper` (every root card worth more than 0 staked, whatever the rez costs: the upper bound).
 *
 * Sources: the 56 local deals played by this tree's Normal AIs, and the 36 human games replayed (SHARD as the harness).
 * Records (one JSON line each, sum with rez-keep-b-sum.mjs):
 *  - 'decision': at every Corp decision (main phase and prompts), a fresh Normal Corp in each tree on a copy of the state:
 *    its pick, ms and the hold walks asked (holdCacheStats.asked, rkStats), and each tree's rezMoney keep and staked set.
 *    The asset servers at that state (`assets`, read from this tree's owners) where any arm stakes more than base.
 *  - 'breach': every breach of a remote whose root holds a non-agenda card: the card(s), their worth (corpCardValue with
 *    left, the Corp's and the Runner's view), hosted credits, trash cost, whether the Runner trashed one and its credits;
 *    the ice on the server left unrezzed; at the start of that Runner turn (the Corp's turn just ended): the Corp's
 *    credits, the server's cheapest holding rez (serverHold 'runnerTurn', money unbounded) and whether it held with the
 *    Corp's credits.
 *    SHARD=0/64 npx vite-node scripts/stage-d/rez-keep-b.ts > b-0.txt
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { counters } from '../../src/core/engine/cardEffects';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { asSide } from '../../src/ai/pricing';
import { corpCardValue } from '../../src/ai/evaluate';
import { serverHold } from '../../src/ai/corp/hold';
import { sideCreditValue } from '../../src/ai/valueModel';
import { clearCaches, dealState, deals, humanFiles } from '../stage-a/harness';
import { isAgenda } from './rez-keep-lib';
import { accessTrap } from '../../src/ai/runs';

const patchFile = 'scripts/stage-d/rez-keep-b-patches.json';
const PATCHES: Record<string, [string, string, string][]> = JSON.parse(readFileSync(patchFile, 'utf8'));
const ARMS = ['base', ...Object.keys(PATCHES).filter(a => !(process.env.ARMS ?? '').length || (process.env.ARMS ?? '').split(',').includes(a))];
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve('.fc-variants', 'rez-keep', String(shard));
const out = (o: unknown) => console.log(JSON.stringify(o));

function makeTrees(): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of ARMS) {
    const dir = join(root, arm);
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [file, from, to] of PATCHES[arm] ?? []) {
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
  keep: (s: GameState) => { keep: number; staked: string[]; by: Record<string, number> };
  asked: () => number;
  rk: () => { asked: number; staked: number };
}

async function load(dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  const rm = await m('ai/corp/rezMoney.ts');
  const hd = await m('ai/corp/hold.ts');
  const pr = await m('ai/pricing.ts');
  return {
    createAgent: ai.createAgent,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
    keep: (s: GameState) =>
      pr.asSide('corp', () => {
        const money = rm.rezMoney(s);
        return { keep: money.keep, staked: rm.stakedServers(s), by: money.byServer };
      }),
    asked: () => hd.holdCacheStats.asked,
    rk: () => ({ ...(rm.rkStats ?? { asked: 0, staked: 0 }) }),
  };
}

const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');
const round = (x: number) => Math.round(x * 100) / 100;

/** The non-agenda root cards of each remote with no agenda, with the owners' numbers (this tree). */
function assetServers(s: GameState) {
  return asSide('corp', () =>
    Object.values(s.corp.servers)
      .filter(v => v.isRemote && v.root.length && !v.root.some(isAgenda))
      .map(v => {
        const open = serverHold(s, v.id, { when: 'runnerTurn', corpCredits: 0 });
        const hold = serverHold(s, v.id, { when: 'runnerTurn', corpCredits: Infinity });
        const price = hold.holds ? sideCreditValue(s, 'corp', 'corp') - sideCreditValue({ ...s, corp: { ...s.corp, credits: s.corp.credits - hold.rezCost } }, 'corp', 'corp') : null;
        return {
          id: v.id,
          ice: v.ice.length,
          unrezzed: v.ice.filter(c => !c.isRezzed).length,
          cards: v.root.map(c => ({ t: cardDef(c).title, trap: accessTrap(c.cardCode), r: c.isRezzed, h: counters(c, 'credit'), tc: cardDef(c).trash_cost ?? null, w: round(corpCardValue(c, s, 'corp', true)), wr: round(corpCardValue(c, s, 'runner', true)) })),
          open: { need: open.need, budget: open.budget },
          rezCost: hold.holds ? hold.rezCost : null,
          heldNow: serverHold(s, v.id, { when: 'runnerTurn' }).holds,
          price: price === null ? null : round(price),
          corp: s.corp.credits,
        };
      }),
  );
}

async function main() {
  const dirs = makeTrees();
  const trees: Record<string, Tree> = {};
  for (const arm of ARMS) trees[arm] = await load(dirs[arm]);

  const decide = (src: string, who: string, i: number, s: GameState) => {
    if (actingSide(s) !== 'corp' || s.winner) return;
    const r: Record<string, { a: string; ms: number; asked: number; keep: number; staked: string[]; rk: { asked: number; staked: number } }> = {};
    const order = [...ARMS.slice(i % ARMS.length), ...ARMS.slice(0, i % ARMS.length)];
    for (const arm of order) {
      const t = trees[arm];
      t.clear();
      const k = t.keep(structuredClone(s));
      t.clear();
      const asked0 = t.asked();
      const rk0 = t.rk();
      const copy = structuredClone(s);
      const t0 = performance.now();
      let a: string;
      try {
        a = key(t.createAgent('corp', 'normal').chooseAction(copy));
      } catch (e) {
        a = `error: ${(e as Error).message}`;
      }
      const ms = performance.now() - t0;
      const rk1 = t.rk();
      r[arm] = { a, ms: Math.round(ms), asked: t.asked() - asked0, keep: k.keep, staked: k.staked, rk: { asked: rk1.asked - rk0.asked, staked: rk1.staked - rk0.staked } };
    }
    const more = ARMS.some(arm => r[arm].staked.length > r.base.staked.length);
    const changed = ARMS.filter(arm => arm !== 'base' && r[arm].a !== r.base.a);
    out({
      kind: 'decision',
      src,
      who,
      i,
      T: s.turnNumber,
      phase: s.pendingPrompts.length ? 'prompt' : 'main',
      corp: s.corp.credits,
      clicks: s.corp.clicks,
      changed,
      picks: Object.fromEntries(ARMS.map(arm => [arm, changed.length || arm === 'base' ? r[arm].a : undefined])),
      keep: Object.fromEntries(ARMS.map(arm => [arm, r[arm].keep])),
      staked: Object.fromEntries(ARMS.map(arm => [arm, r[arm].staked])),
      ms: Object.fromEntries(ARMS.map(arm => [arm, r[arm].ms])),
      asked: Object.fromEntries(ARMS.map(arm => [arm, r[arm].asked])),
      rk: Object.fromEntries(ARMS.map(arm => [arm, r[arm].rk])),
      assets: more || changed.length ? assetServers(s) : undefined,
    });
  };

  /** Watches the Runner's breaches of remotes holding a non-agenda root card. */
  const breaches = (src: string, who: string) => {
    let turnStart: GameState | null = null;
    let run: { server: string; start: GameState; at?: GameState } | null = null;
    return (prev: GameState, next: GameState) => {
      if (next.activePlayer === 'runner' && prev.activePlayer !== 'runner') turnStart = next;
      if (!prev.activeRun && next.activeRun) run = { server: next.activeRun.server, start: next };
      if (run && next.activeRun?.breached && !run.at) run.at = next;
      if (run && prev.activeRun && !next.activeRun) {
        const v = run.start.corp.servers[run.server];
        if (run.at && v?.isRemote && v.root.length && !v.root.some(isAgenda)) {
          const at = run.at;
          const after = next.corp.servers[run.server];
          const gone = v.root.filter(c => !after?.root.some(x => x.instanceId === c.instanceId));
          const ts = turnStart ?? run.start;
          const hold = asSide('corp', () => serverHold(ts, run!.server, { when: 'runnerTurn', corpCredits: Infinity }));
          const heldNow = asSide('corp', () => serverHold(ts, run!.server, { when: 'runnerTurn' }).holds);
          out({
            kind: 'breach',
            src,
            who,
            T: next.turnNumber,
            server: run.server,
            cards: v.root.map(c => ({ t: cardDef(c).title, trap: accessTrap(c.cardCode), r: c.isRezzed, h: counters(c, 'credit'), tc: cardDef(c).trash_cost ?? null, w: round(asSide('corp', () => corpCardValue(c, at, 'corp', true))), wr: round(asSide('runner', () => corpCardValue(c, at, 'runner', true))) })),
            trashed: gone.map(c => cardDef(c).title),
            runnerAtBreach: at.runner.credits,
            runnerAfter: next.runner.credits,
            unrezzedLeft: (after ?? v).ice.filter(c => !c.isRezzed).length,
            ice: v.ice.length,
            turnStart: { corp: ts.corp.credits, rezCost: hold.holds ? hold.rezCost : null, holds: hold.holds, heldNow, ice: ts.corp.servers[run.server]?.ice.length ?? 0 },
          });
        }
        run = null;
      }
    };
  };

  const sources: (() => void)[] = [
    ...deals().map(seed => () => {
      const src = `deal:${seed}`;
      let i = 0;
      const watch = (inner: Agent): Agent =>
        new Proxy(inner, {
          get(target, prop, recv) {
            if (prop === 'chooseAction')
              return (state: GameState) => {
                if (inner.side === 'corp') decide(src, 'self', i++, state);
                clearCaches();
                return target.chooseAction(state);
              };
            return Reflect.get(target, prop, recv);
          },
        });
      const game = new GameRunner(dealState(seed), { corp: watch(createAgent('corp', 'normal')), runner: watch(createAgent('runner', 'normal')) });
      const seen = breaches(src, 'self');
      let prev = game.state;
      for (let k = 0; k < 4000 && game.step(); k++) {
        seen(prev, game.state);
        prev = game.state;
      }
      out({ kind: 'end', src, winner: game.state.winner ?? null, T: game.state.turnNumber });
    }),
    ...humanFiles().map(file => () => {
      const report = JSON.parse(readFileSync(file, 'utf8'));
      if (!report.moves?.length) return;
      const src = `human:${file.split('/').pop()}`;
      const who = report.config.ai === 'corp' ? 'person-runner' : 'person-corp';
      let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
      if (report.startStops) s = { ...s, stops: report.startStops };
      const seen = breaches(src, who);
      let i = 0;
      for (const move of report.moves as GameAction[]) {
        if (actingSide(s) === 'corp' && move.player === 'corp' && !(s.priority && s.priority.holder === 'corp' && s.activePlayer === 'runner')) decide(src, who, i++, s);
        let next: GameState;
        try {
          next = executeAction(s, move);
        } catch {
          break;
        }
        seen(s, next);
        s = next;
      }
      out({ kind: 'end', src, winner: s.winner ?? null, T: s.turnNumber });
    }),
  ];
  sources.forEach((run, k) => {
    if (k % shards !== shard) return;
    try {
      run();
    } catch (e) {
      console.error(`source ${k}: ${(e as Error).stack}`);
    }
  });
  if (existsSync(root) && !process.env.RK_KEEP) rmSync(root, { recursive: true, force: true });
}

void main();

export type { CardInstance };
