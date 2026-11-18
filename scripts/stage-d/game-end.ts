/**
 * Stage D item 4 step 1a (brief stage-d/item4-game-end/brief.md section 2): does a game-ending access matter, and at
 * which layer. Scripts only; no source change.
 *
 * Trees: a copy of src/ per arm under .fc-variants/game-end/<shard>/<arm>/ (as rez-keep-b.ts), made by the text patches
 * of game-end-patches.ts: `base` (a plain copy with the layer probe), a1, a2, a2e, b1, b2 (see that file).
 *
 * Sources: the 56 local deals played by this tree's Normal AIs (the harness seeds; caches cleared before every decision)
 * and the 36 human games replayed move for move (SHARD as the harness). Records (one JSON line each; sum with
 * game-end-sum.mjs):
 *  - 'decision': at every Corp decision (main phase, prompts, rez windows) a fresh Normal Corp in each tree on a copy of
 *    the state: its pick, the layer that made it (the probe), ms; `ends`: the servers one access to which can take the
 *    Runner to 7 (rule 1.7.2a; the stake owner's points, one access), each with the hold owner's 'runnerTurn' verdict.
 *  - 'cont': for a decision some tree changed where a server can end the game, each changed tree and base play on from
 *    a copy (that tree's Corp, this tree's Normal Runner) through the Corp's turn and the Runner's next turn: the Corp's
 *    moves, each `ends` server's hold at the Corp's turn end, the Runner's runs (server, breached, points) and the winner.
 *  - 'loss': every game the Corp lost on agenda points: the winning run (server, points it took, extra accesses), the
 *    Corp's last turn before it (its moves, the base tree's layer for each where known); at that turn's end the server's
 *    `ends` and hold; the kind (a: held by the count and the Runner got in; b: did not hold, and a move that turn would
 *    have made it hold by the count: the money spent elsewhere, or one ice from HQ; c: no such move; n: the server could
 *    not end the game by one access at the turn's end); and per tree, the Corp's turn played again from its start (that
 *    tree's Corp): whether the server then holds.
 *    SHARD=0/64 npx vite-node scripts/stage-d/game-end.ts > out-0.txt
 *    DEALS=1321 HUMAN=none ARMS=a1 npx vite-node scripts/stage-d/game-end.ts
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, wantsStop } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner, rezCandidates } from '../../src/ai/playout';
import { asSide } from '../../src/ai/pricing';
import { serverHold } from '../../src/ai/corp/hold';
import { stake } from '../../src/ai/corp/pools';
import { withIceInstalled } from '../../src/ai/board';
import { clearCaches, dealState, deals, humanFiles } from '../stage-a/harness';
import { PATCHES, probe } from './game-end-patches';

const want = (process.env.ARMS ?? '').split(',').filter(Boolean);
const ARMS = ['base', ...Object.keys(PATCHES).filter(a => !want.length || want.includes(a))];
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve('.fc-variants', 'game-end', String(shard));
const out = (o: unknown) => console.log(JSON.stringify(o));
const WIN = 7; // rule 1.7.2a
let contTest = Number(process.env.CONT_TEST ?? 0);

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
      if (text.split(from).length !== 2) throw new Error(`patch ${arm} does not match once in ${file}: ${from.slice(0, 80)}`);
      writeFileSync(path, text.replace(from, to));
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
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  return {
    createAgent: ai.createAgent,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}

const G = globalThis as unknown as { __geLayer?: string };
const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'player').sort())) : 'null');

/** Compact form of an action for the records. */
function short(s: GameState, a: GameAction | null): string {
  if (!a) return 'pass';
  const x = a as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean; server?: string };
  const card = x.cardInstanceId ? findCard(s, x.cardInstanceId) : null;
  const name = card ? cardDef(card).title : '';
  const where = x.asNewRemote ? '->new' : x.targetServerId ? `->${x.targetServerId}` : x.server ? `@${x.server}` : '';
  return `${a.type}${name ? ` ${name}` : ''}${where}`;
}

function findCard(s: GameState, id: string): CardInstance | undefined {
  const c = s.corp;
  return [...c.hq, ...c.rd, ...c.archives.faceUp, ...c.archives.faceDown, ...Object.values(c.servers).flatMap(v => [...v.root, ...v.ice])].find(k => k.instanceId === id);
}

/** The servers one access to which can take the Runner to 7 (the stake owner's points), with the hold owner's verdict. */
function endsServers(s: GameState): { id: string; pts: number; holds: boolean; ice: number }[] {
  return asSide('corp', () =>
    Object.keys(s.corp.servers)
      .map(id => ({ id, pts: stake(s, id).points }))
      .filter(v => s.runner.score + v.pts >= WIN)
      .map(v => ({ ...v, holds: serverHold(s, v.id, { when: 'runnerTurn' }).holds, ice: s.corp.servers[v.id].ice.length })),
  );
}

/** A Corp agent of a tree that clears its caches before each decision. */
function treeCorp(t: Tree): Agent {
  const inner = t.createAgent('corp', 'normal');
  return new Proxy(inner, {
    get(target, prop, recv) {
      if (prop === 'chooseAction' || prop === 'chooseRez')
        return (...args: unknown[]) => {
          t.clear();
          clearCaches();
          return (Reflect.get(target, prop, recv) as (...a: unknown[]) => unknown).apply(target, args);
        };
      return Reflect.get(target, prop, recv);
    },
  });
}

function mainRunner(): Agent {
  const inner = createAgent('runner', 'normal');
  return new Proxy(inner, {
    get(target, prop, recv) {
      if (prop === 'chooseAction' || prop === 'chooseOffTurn')
        return (...args: unknown[]) => {
          clearCaches();
          return (Reflect.get(target, prop, recv) as (...a: unknown[]) => unknown).apply(target, args);
        };
      return Reflect.get(target, prop, recv);
    },
  });
}

/** Plays on from `s` with a tree's Corp: the rest of the Corp's turn (to the Runner's turn) and, with `runnerTurn`, the Runner's next turn. */
function playOn(t: Tree, s: GameState, ends: string[], runnerTurn: boolean) {
  const game = new GameRunner(structuredClone(s), { corp: treeCorp(t), runner: mainRunner() });
  const moves: string[] = [];
  const startTurn = s.turnNumber;
  let n = 0;
  const corpTurn = s.activePlayer === 'corp';
  try {
    // The Corp's turn (or, from a rez window in the Runner's turn, the run under way)
    while (n++ < 120 && !game.state.winner) {
      const st = game.state;
      if (corpTurn && st.activePlayer === 'runner') break;
      if (!corpTurn && !st.activeRun) break;
      if (!game.step()) break;
      if (actingSide(st) === 'corp' && game.last && game.last.type !== 'PASS') moves.push(short(st, game.last));
    }
  } catch (e) {
    moves.push(`error: ${(e as Error).message}`);
  }
  const atEnd = game.state;
  const held = asSide('corp', () => Object.fromEntries(ends.map(id => [id, atEnd.corp.servers[id] ? { holds: serverHold(atEnd, id, { when: 'runnerTurn' }).holds, ends: atEnd.runner.score + stake(atEnd, id).points >= WIN, ice: atEnd.corp.servers[id].ice.length } : null])));
  const runs: { server: string; breached: boolean; pts: number }[] = [];
  if (runnerTurn && !atEnd.winner) {
    let run: { server: string; breached: boolean; score: number } | null = null;
    try {
      while (n++ < 400 && !game.state.winner) {
        const st = game.state;
        if (st.activePlayer === 'corp' && st.turnNumber > atEnd.turnNumber && !st.activeRun) break;
        if (!game.step()) break;
        const nx = game.state;
        if (!st.activeRun && nx.activeRun) run = { server: nx.activeRun.server, breached: false, score: st.runner.score };
        if (run && nx.activeRun?.isSuccessful) run.breached = true;
        if (run && (!nx.activeRun || nx.winner)) {
          runs.push({ server: run.server, breached: run.breached, pts: nx.runner.score - run.score });
          run = null;
        }
      }
    } catch (e) {
      runs.push({ server: `error: ${(e as Error).message}`, breached: false, pts: 0 });
    }
  }
  return { moves, held, corpEnd: { credits: atEnd.corp.credits, T: atEnd.turnNumber }, runs, winner: game.state.winner ?? null, turns: game.state.turnNumber - startTurn };
}

interface Turn {
  T: number;
  start: GameState;
  end?: GameState;
  moves: { i: number; a: string; layer?: string }[];
}

async function main() {
  const dirs = makeTrees();
  const trees: Record<string, Tree> = {};
  for (const arm of ARMS) trees[arm] = await load(dirs[arm]);

  /** Every Corp decision: each tree's pick on a copy. Returns the base tree's layer. */
  const decide = (src: string, who: string, i: number, s: GameState, rez: boolean): string | undefined => {
    if (s.winner) return;
    const ends = endsServers(s);
    const r: Record<string, { a: string; ms: number; layer?: string; short: string }> = {};
    const order = [...ARMS.slice(i % ARMS.length), ...ARMS.slice(0, i % ARMS.length)];
    for (const arm of order) {
      const t = trees[arm];
      t.clear();
      clearCaches();
      const copy = structuredClone(s);
      G.__geLayer = undefined;
      const t0 = performance.now();
      let a: GameAction | null = null;
      let err: string | null = null;
      try {
        const agent = t.createAgent('corp', 'normal');
        if (rez) {
          const w = copy.priority!.step as 'approach_ice' | 'approach_server';
          a = agent.chooseRez?.(copy, rezCandidates(copy, w)) ?? null;
        } else a = agent.chooseAction(copy);
      } catch (e) {
        err = `error: ${(e as Error).message}`;
      }
      const ms = performance.now() - t0;
      r[arm] = { a: err ?? key(a), ms: Math.round(ms), layer: G.__geLayer, short: err ?? short(s, a) };
    }
    const changed = ARMS.filter(arm => arm !== 'base' && r[arm].a !== r.base.a);
    out({
      kind: 'decision',
      src,
      who,
      i,
      T: s.turnNumber,
      rez,
      phase: rez ? 'rez' : s.pendingPrompts.length ? 'prompt' : 'main',
      corp: s.corp.credits,
      clicks: s.corp.clicks,
      score: [s.corp.score, s.runner.score],
      ends,
      changed,
      picks: Object.fromEntries(ARMS.map(arm => [arm, changed.length || arm === 'base' ? r[arm].short : undefined])),
      layers: Object.fromEntries(ARMS.map(arm => [arm, changed.length || arm === 'base' ? r[arm].layer : undefined])),
      ms: Object.fromEntries(ARMS.map(arm => [arm, r[arm].ms])),
    });
    // CONT_TEST=n: also play on from the first n decisions with an ends-server that nothing changed (a check of playOn)
    if (ends.length && !process.env.NO_CONT && (changed.length || contTest-- > 0)) {
      const ids = ends.map(e => e.id);
      const runnerTurn = s.activePlayer === 'corp';
      for (const arm of ['base', ...changed]) out({ kind: 'cont', src, who, i, T: s.turnNumber, arm, ...playOn(trees[arm], s, ids, runnerTurn) });
    }
    return r.base.layer;
  };

  /** Watches a game: Corp turns (start, end, moves) and the run that wins it. */
  const watcher = (src: string, who: string) => {
    const turns: Turn[] = [];
    let run: { server: string; score: number; extra: number } | null = null;
    let last: { server: string; pts: number; extra: number } | null = null;
    return {
      turns,
      decision(s: GameState) {
        if (s.activePlayer !== 'corp') return;
        if (!turns.length || turns[turns.length - 1].T !== s.turnNumber) turns.push({ T: s.turnNumber, start: s, moves: [] });
      },
      move(i: number, s: GameState, a: GameAction, layer?: string) {
        const t = turns[turns.length - 1];
        if (s.activePlayer === 'corp' && t && t.T === s.turnNumber && a.type !== 'PASS') t.moves.push({ i, a: short(s, a), layer });
      },
      step(prev: GameState, next: GameState) {
        if (prev.activePlayer === 'corp' && next.activePlayer === 'runner') {
          const t = turns[turns.length - 1];
          if (t && t.T === prev.turnNumber) t.end = next;
        }
        if (!prev.activeRun && next.activeRun) run = { server: next.activeRun.server, score: prev.runner.score, extra: 0 };
        if (run && next.activeRun) run.extra = Math.max(run.extra, next.activeRun.extraAccesses ?? 0);
        if (run && (!next.activeRun || next.winner)) {
          last = { server: run.server, pts: next.runner.score - run.score, extra: run.extra };
          run = null;
        }
      },
      end(s: GameState) {
        if (s.winner !== 'runner' || !/agenda points/.test(s.winReason ?? '')) return;
        const win = last;
        const turn = [...turns].reverse().find(t => t.end && t.end.turnNumber <= s.turnNumber);
        if (!win || !turn?.end) {
          out({ kind: 'loss', src, who, T: s.turnNumber, server: win?.server ?? null, note: 'no Corp turn found' });
          return;
        }
        const end = turn.end;
        const id = win.server;
        const v = end.corp.servers[id];
        const startPts = asSide('corp', () => (turn.start.corp.servers[id] ? stake(turn.start, id).points : 0));
        const endPts = asSide('corp', () => (v ? stake(end, id).points : 0));
        const ends = end.runner.score + endPts >= WIN;
        const hold = asSide('corp', () => (v ? serverHold(end, id, { when: 'runnerTurn' }) : null));
        const clicks = turn.start.corp.clicks || 3;
        const bound = Math.max(end.corp.credits, turn.start.corp.credits + clicks);
        const moves: string[] = [];
        if (v && ends && hold && !hold.holds) {
          asSide('corp', () => {
            if (serverHold(end, id, { when: 'runnerTurn', corpCredits: bound }).holds) moves.push(`money: holds with ${bound} credits (ended on ${end.corp.credits})`);
            const seen = new Set<string>();
            for (const ice of turn.start.corp.hq.filter(c => cardDef(c).type_code === 'ice')) {
              if (seen.has(ice.cardCode)) continue;
              seen.add(ice.cardCode);
              // The ice taken out of wherever it ended (HQ or the server it was installed on this turn), installed unrezzed here
              const servers = Object.fromEntries(Object.entries(end.corp.servers).map(([k, sv]) => [k, { ...sv, ice: sv.ice.filter(c => c.instanceId !== ice.instanceId) }]));
              const view0 = { ...end, corp: { ...end.corp, hq: end.corp.hq.filter(c => c.instanceId !== ice.instanceId), servers } };
              const fresh = { ...ice, isRezzed: false };
              const view = withIceInstalled(view0, fresh, servers[id]);
              const install = servers[id].ice.length;
              const credits = bound - 1 - install;
              if (credits >= 0 && serverHold(view, id, { when: 'runnerTurn', corpCredits: credits }).holds) moves.push(`ice: ${cardDef(ice).title} on ${id} (install ${install}, ${credits} left)`);
            }
          });
        }
        const kind = !v ? 'n' : !ends ? 'n' : hold?.holds ? 'a' : moves.length ? 'b' : 'c';
        const replay: Record<string, unknown> = {};
        if (kind === 'b' || kind === 'c' || kind === 'a') for (const arm of ARMS) replay[arm] = playOn(trees[arm], turn.start, [id], false);
        out({
          kind: 'loss',
          src,
          who,
          T: s.turnNumber,
          server: id,
          runPts: win.pts,
          extra: win.extra,
          corpTurn: turn.T,
          scoreAtEnd: [end.corp.score, end.runner.score],
          endsAtStart: turn.start.runner.score + startPts >= WIN,
          endsAtEnd: ends,
          ptsAtEnd: endPts,
          ice: v?.ice.length ?? 0,
          unrezzed: v?.ice.filter(c => !c.isRezzed).length ?? 0,
          hold: hold ? { holds: hold.holds, need: hold.need, budget: hold.budget, rezCost: hold.rezCost } : null,
          corp: { start: turn.start.corp.credits, end: end.corp.credits, bound },
          class: kind,
          holdingMoves: moves,
          corpMoves: turn.moves,
          replay,
        });
      },
    };
  };

  const sources: (() => void)[] = [
    ...deals().map(seed => () => {
      const src = `deal:${seed}`;
      const w = watcher(src, 'self');
      let i = 0;
      const watch = (inner: Agent): Agent =>
        new Proxy(inner, {
          get(target, prop, recv) {
            if (prop === 'chooseAction' || prop === 'chooseRez')
              return (state: GameState, cards?: CardInstance[]) => {
                let layer: string | undefined;
                if (inner.side === 'corp') {
                  w.decision(state);
                  layer = decide(src, 'self', i++, state, prop === 'chooseRez');
                }
                clearCaches();
                const a = prop === 'chooseRez' ? target.chooseRez!(state, cards!) : target.chooseAction(state);
                if (inner.side === 'corp' && a) w.move(i - 1, state, a, layer);
                return a;
              };
            if (prop === 'chooseOffTurn')
              return (state: GameState) => {
                clearCaches();
                return target.chooseOffTurn?.(state) ?? null;
              };
            return Reflect.get(target, prop, recv);
          },
        });
      const game = new GameRunner(dealState(seed), { corp: watch(createAgent('corp', 'normal')), runner: watch(createAgent('runner', 'normal')) });
      let prev = game.state;
      for (let k = 0; k < 4000 && game.step(); k++) {
        w.step(prev, game.state);
        prev = game.state;
      }
      w.end(game.state);
      out({ kind: 'end', src, who: 'self', winner: game.state.winner ?? null, reason: game.state.winReason ?? null, T: game.state.turnNumber });
    }),
    ...humanFiles().map(file => () => {
      const report = JSON.parse(readFileSync(file, 'utf8'));
      if (!report.moves?.length) return;
      const src = `human:${file.split('/').pop()}`;
      const who = report.config.ai === 'corp' ? 'person-runner' : 'person-corp';
      const w = watcher(src, who);
      let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
      if (report.startStops) s = { ...s, stops: report.startStops };
      let i = 0;
      for (const move of report.moves as GameAction[]) {
        const window = s.priority;
        const rezWindow = s.pendingPrompts.length === 0 && window && window.holder === 'corp' && s.activePlayer === 'runner' && (window.step === 'approach_ice' || window.step === 'approach_server');
        let layer: string | undefined;
        if (actingSide(s) === 'corp' && !s.winner) {
          w.decision(s);
          if (rezWindow) {
            if (wantsStop({ ...s, stops: { corp: 'ai', runner: 'ai' } }, 'corp', window)) layer = decide(src, who, i++, s, true);
          } else if (!(window && window.holder === 'corp' && s.activePlayer === 'runner')) layer = decide(src, who, i++, s, false);
          w.move(i - 1, s, move, layer);
        }
        let next: GameState;
        try {
          next = executeAction(s, move);
        } catch {
          break;
        }
        w.step(s, next);
        s = next;
      }
      w.end(s);
      out({ kind: 'end', src, who, winner: s.winner ?? null, reason: s.winReason ?? null, T: s.turnNumber });
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
  if (existsSync(root) && !process.env.GE_KEEP) rmSync(root, { recursive: true, force: true });
}

void main();
