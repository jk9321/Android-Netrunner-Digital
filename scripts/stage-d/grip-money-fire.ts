/**
 * Stage D exploit F2 (grip money), the count step (brief: /mnt/project-files/netrunner-ai/stage-d/f2-grip-money/brief.md).
 * Scripts only: nothing under src/ changes; the arms are text patches on copies of src/ (grip-money-arms.json, written by
 * grip-money-arms.mjs; trees by runner-money-trees.ts makeTrees). The sources are the fire count's 92: the 56 local
 * deals played by this tree's Normal AIs and the human games replayed (scripts/stage-a/harness.ts), split by SHARD.
 *
 * Two parts, one pass over each source:
 *  - FIRE (brief Q2, Q4; as runner-money-fire.ts): at each recorded Corp decision a fresh Normal Corp decides on a copy
 *    of the state in `beta` (this tree) and in every arm, each its own module graph, order rotated, timed. `control` is
 *    beta copied the way the arms are (the time base, found row 69a). A single decision over a stop (2x control at
 *    0.5 s or more, or 3 s slower) is timed twice more, both trees, and its medians kept. Where an arm's pick differs
 *    from beta's: the line each pick has in its own tree's order (rankMainActions; the main phase only), and
 *    continuations as CONT did (the GameRunner, that tree's Normal Corp against beta's Normal Runner, from the
 *    decision: a mark at each turn's end) played to the game's end (END=0: to the second Runner turn's end), with the
 *    place of the agenda beta's pick moves at the end of that Corp turn.
 *  - COMMITS (brief Q1, Q3): every recorded Corp move that installs or advances an agenda in a remote whose beta count
 *    says `holds` after the move (serverHold 'runnerTurn' with the Corp's credits after it). For each: margin, grip
 *    size, the money events in the deck list less the public cards (the arm's own reader, unseenRunnerCards), each
 *    arm's answer on the same board, the chance p (Q3: playable's count asked with one event at a time, the
 *    hypergeometric over the unseen cards and the grip's size), then the recorded game's next Runner turn: the cards it
 *    played or installed from its grip before it breached that server, whether it breached and stole.
 *    MEASURING ONLY (says what was true; no arm reads it): the recorded grip (its money events, whether it held a
 *    covering one), and the grip plus stack and the setup deck list (to report boards where the arm's deck list less
 *    public cards differs from them).
 *
 * One JSON line per Corp decision (`d`) and per commit (`c`). Sum with grip-money-sum.mjs.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/grip-money-fire.ts
 *   DEALS=1881 HUMAN=none PARTS=commits npx vite-node scripts/stage-d/grip-money-fire.ts
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';
import { makeTrees, present, readArms } from './runner-money-trees';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
process.env.ARMS_FILE ||= 'scripts/stage-d/grip-money-arms.json';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
if (process.env.ONLY && !process.env.ONLY.split(',').map(Number).includes(shard)) process.exit(0);
const file = readArms();
const ARMS = Object.keys(file.arms);
const CONT = new Set((process.env.CONT ?? 'f2max,f2odds,playable,commit,commitLine').split(',').filter(Boolean));
const END = process.env.END !== '0';
const PARTS = new Set((process.env.PARTS ?? 'fire,commits').split(','));
const root = resolve(process.env.TROOT ?? '.gm-fire', String(shard));

/** The money events of the arms (grip-money-arms.mjs GRIP_EVENTS), for the measuring side's labels. */
const MONEY = new Set(['30030', '30020', '34001', '30029', '34087', '36011']);

interface HoldLike {
  holds: boolean;
  need: number;
  budget: number;
  margin: number;
  rez: string[] | null;
}
interface HoldMod {
  serverHold: (s: GameState, server: string, o: { when: 'runnerTurn'; corpCredits: number }) => HoldLike;
  withGrip?: <T>(f: () => T) => T;
  GRIP?: { on: boolean; only: string[] | null };
  unseenRunnerCards?: (s: GameState) => Map<string, number>;
  holdCacheStats: { asked: number; searched: number };
}
interface Tree {
  createAgent: typeof createAgent;
  GameRunner: typeof GameRunner;
  hold: HoldMod;
  clear: () => void;
}
async function load(dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  const po = await m('ai/playout.ts');
  const hold = await m('ai/corp/hold.ts');
  return {
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    hold,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
  };
}
const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');
const r1 = (x: number) => Math.round(x * 10) / 10;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
const installedCorp = (s: GameState) => Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice]);
const serverOf = (s: GameState, id: string) => Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id))?.id;
const rigOf = (s: GameState) => [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
/** Every Runner card installed or hosted, on its own cards or the Corp's. */
const runnerInstalled = (s: GameState) => [...rigOf(s), ...[...rigOf(s), ...Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice])].flatMap(c => c.hostedCards ?? [])].filter(c => cardDef(c).side_code === 'runner');
const countCodes = (cards: CardInstance[]) => {
  const m = new Map<string, number>();
  for (const c of cards) m.set(c.cardCode, (m.get(c.cardCode) ?? 0) + 1);
  return m;
};
/** Copies by which two code counts differ. */
const codeDiff = (a: Map<string, number>, b: Map<string, number>) => {
  let n = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) n += Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0));
  return n;
};

/** Where an agenda is (its instance id): a server, HQ, a score area, Archives, R&D, gone. */
function placeOf(s: GameState, id: string): string {
  const sv = serverOf(s, id);
  if (sv) return sv;
  if (s.corp.hq.some(c => c.instanceId === id)) return 'hq';
  if (s.corp.scoreArea.some(c => c.instanceId === id)) return 'scored';
  if (s.runner.scoreArea.some(c => c.instanceId === id)) return 'stolen';
  if ([...s.corp.archives.faceUp, ...s.corp.archives.faceDown].some(c => c.instanceId === id)) return 'archives';
  if (s.corp.rd.some(c => c.instanceId === id)) return 'rd';
  return 'gone';
}

/** The agenda a Corp action installs or advances, and whether it is in a remote after it (`after`). */
function agendaMoveOf(before: GameState, a: GameAction, after: GameState): { id: string; code: string; server: string | undefined; act: string } | null {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string | undefined) : undefined;
  if (!id) return null;
  if (a.type === 'INSTALL_CARD') {
    const c = before.corp.hq.find(x => x.instanceId === id);
    if (typeOf(c) !== 'agenda') return null;
    return { id, code: c!.cardCode, server: serverOf(after, id), act: 'install' };
  }
  if (a.type === 'ADVANCE_CARD') {
    const c = installedCorp(before).find(x => x.instanceId === id);
    if (typeOf(c) !== 'agenda') return null;
    return { id, code: c!.cardCode, server: serverOf(after, id), act: 'advance' };
  }
  return null;
}

async function main() {
  const dirs = { beta: resolve('.'), ...makeTrees(file, root) } as Record<string, string>;
  const trees: Record<string, Tree> = {};
  for (const t of Object.keys(dirs)) trees[t] = await load(dirs[t]);
  const reader = trees.playable ?? trees.commit; // the arm library: unseenRunnerCards, GRIP (measuring calls)

  // ---------------------------------------------------------------------------------------------------- FIRE
  const askOnce = (t: string, s: GameState) => {
    const tree = trees[t];
    tree.clear();
    const agent = tree.createAgent('corp', 'normal');
    const st = tree.hold.holdCacheStats;
    const [asked, searched] = [st.asked, st.searched];
    const at = performance.now();
    let a: GameAction | null;
    try {
      a = agent.chooseAction(structuredClone(s));
    } catch (e) {
      return { a: `error: ${(e as Error).message}`, ms: 0, hq: [0, 0] };
    }
    return { a: key(a), ms: performance.now() - at, hq: [st.asked - asked, st.searched - searched] };
  };
  /** The line and the place in its own tree's order of a main-phase pick (`a` as key). */
  const lineOf = (t: string, s: GameState, a: string) => {
    if (s.pendingPrompts.length || s.activeRun) return null;
    try {
      trees[t].clear();
      const agent = trees[t].createAgent('corp', 'normal') as unknown as { rankMainActions: (s: GameState) => { action: GameAction; line?: number; behind?: boolean }[] };
      const ranked = agent.rankMainActions(structuredClone(s));
      const pos = ranked.findIndex(r => key(r.action) === a);
      return { line: pos >= 0 ? (ranked[pos].line ?? null) : null, behind: pos >= 0 ? !!ranked[pos].behind : null, pos, firstLine: ranked[0]?.line ?? null };
    } catch (e) {
      return { error: (e as Error).message.slice(0, 80) };
    }
  };

  /** The game on from `s` with tree `t`'s Corp against beta's Runner (see the file comment). */
  const cont = (t: string, s: GameState, agendaId: string | null) => {
    trees[t].clear();
    trees.beta.clear();
    const g = new trees[t].GameRunner(structuredClone(s), { corp: trees[t].createAgent('corp', 'normal'), runner: trees.beta.createAgent('runner', 'normal') });
    const marks: { ended: string; corp: number; runner: number; T: number }[] = [];
    let last = g.state.activePlayer;
    let placed: Record<string, unknown> | null = null;
    const runners = () => marks.filter(m => m.ended === 'runner').length;
    for (let n = 0; n < 6000 && !g.state.winner && (END || runners() < 2); n++) {
      const before = g.state;
      if (!g.step()) break;
      const now = g.state.activePlayer;
      if (now !== last) {
        marks.push({ ended: last, corp: g.state.corp.score, runner: g.state.runner.score, T: g.state.turnNumber });
        // The end of the Corp turn under way: where the agenda of beta's pick is, and its server's ice then
        if (!placed && last === 'corp' && agendaId) {
          const at = placeOf(before, agendaId);
          placed = { at, ice: before.corp.servers[at]?.ice.length ?? null };
        }
        last = now;
      }
    }
    if (!placed && agendaId) placed = { at: placeOf(g.state, agendaId), ice: null, ended: true };
    return { start: { corp: s.corp.score, runner: s.runner.score }, marks: marks.slice(0, 4), end: { corp: g.state.corp.score, runner: g.state.runner.score, T: g.state.turnNumber }, winner: g.state.winner ?? null, placed };
  };

  const TIMED = ['beta', ...ARMS];
  let n = 0;
  const decision = (src: string, i: number, s: GameState) => {
    if (!PARTS.has('fire') || actingSide(s) !== 'corp' || s.winner) return;
    const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    const k = n++ % TIMED.length;
    const order = [...TIMED.slice(k), ...TIMED.slice(0, k)];
    const r: Record<string, { a: string; ms: number; hq: number[] }> = {};
    for (const t of order) r[t] = askOnce(t, s);
    // The stops (Q4): an arm over 2x control at 0.5 s or more, or 3 s slower: two more times each, medians kept
    const retimed: string[] = [];
    if (r.control)
      for (const a of ARMS.filter(x => x !== 'control')) {
        if (!((r[a].ms >= 500 && r[a].ms > 2 * r.control.ms) || r[a].ms > r.control.ms + 3000)) continue;
        const am = [r[a].ms, askOnce(a, s).ms, askOnce(a, s).ms];
        const cm = [r.control.ms, askOnce('control', s).ms, askOnce('control', s).ms];
        retimed.push(`${a}:${am.map(r1).join('/')}|control:${cm.map(r1).join('/')}`);
        r[a] = { ...r[a], ms: median(am) };
        r.control = { ...r.control, ms: median(cm) };
      }
    const changed = ARMS.filter(a => r[a].a !== r.beta.a);
    const p = present(s);
    const groups = Object.entries(p).filter(([g, v]) => g !== 'known' && v === true).map(([g]) => g);
    const out: Record<string, unknown> = { kind: 'd', src, i, T: s.turnNumber, dk: kind, groups, changed, ms: Object.fromEntries(TIMED.map(t => [t, r1(r[t].ms)])) };
    // Hold questions asked and searched (holdCacheStats) per tree, for the time trace (Q4)
    out.hq = Object.fromEntries(TIMED.map(t => [t, r[t].hq]));
    if (retimed.length) {
      out.retimed = retimed;
      if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `state-${src.replace(/\W/g, '_')}-${i}.json`), JSON.stringify(s));
    }
    if (changed.length) {
      out.picks = Object.fromEntries([['beta', r.beta.a], ...changed.map(a => [a, r[a].a])]);
      out.lines = Object.fromEntries([['beta', lineOf('beta', s, r.beta.a)], ...changed.map(a => [a, lineOf(a, s, r[a].a)])]);
      // The agenda beta's pick installs or advances, and whether beta's count says it holds after (a commit)
      let agendaId: string | null = null;
      try {
        const ba = JSON.parse(r.beta.a) as GameAction;
        const after = executeAction(s, ba);
        const m = agendaMoveOf(s, ba, after);
        if (m) {
          agendaId = m.id;
          const h = m.server?.startsWith('remote') ? trees.beta.hold.serverHold(after, m.server, { when: 'runnerTurn', corpCredits: after.corp.credits }) : null;
          out.betaAgenda = { act: m.act, server: m.server ?? null, holds: h?.holds ?? null, margin: h ? r1(h.margin) : null, iceThen: m.server ? (s.corp.servers[m.server]?.ice.length ?? 0) : null };
        }
      } catch {
        /* not an action of the engine's list (an error pick) */
      }
      const want = changed.filter(a => CONT.has(a));
      if (want.length) {
        const c: Record<string, unknown> = { beta: cont('beta', s, agendaId) };
        for (const a of want) c[a] = cont(a, s, agendaId);
        out.cont = c;
      }
    }
    console.log(JSON.stringify(out));
  };

  // ---------------------------------------------------------------------------------------------------- COMMITS
  interface Play {
    id: string;
    code: string;
    how: 'event' | 'install';
    drawn: boolean;
    money: boolean;
    breaker: boolean;
  }
  interface Commit {
    line: Record<string, unknown>;
    id: string;
    server: string;
    turn: number;
    phase: 'corp' | 'runner';
    gripAtStart?: Set<string>;
    /** Runner cards installed or hosted anywhere at the Runner's turn start (a later one came from the grip: Madani, Bahia Bands, ...). */
    rigAtStart?: Set<string>;
    plays: Play[];
    breached: boolean;
    runs: number;
    stolen: boolean;
    endRez: string[] | null;
  }
  const holdOf = (t: string, s: GameState, server: string, grip = false) => {
    const h = trees[t].hold;
    const ask = () => h.serverHold(s, server, { when: 'runnerTurn', corpCredits: s.corp.credits });
    return grip && h.withGrip ? h.withGrip(ask) : ask();
  };
  /** Q3: the money codes unseen whose play alone turns this hold over (playable's count, one event at a time), and p. */
  const chance = (s: GameState, server: string, unseen: Map<string, number>) => {
    const G = reader.hold.GRIP!;
    const covering: string[] = [];
    for (const code of [...unseen.keys()].filter(c => MONEY.has(c) && unseen.get(c)!)) {
      G.only = [code];
      try {
        if (!holdOf(reader === trees.playable ? 'playable' : 'commit', s, server, true).holds) covering.push(code);
      } finally {
        G.only = null;
      }
    }
    let total = 0;
    for (const v of unseen.values()) total += v;
    const k = covering.reduce((m, c) => m + unseen.get(c)!, 0);
    const g = s.runner.grip.length;
    let none = 1;
    for (let i = 0; i < g; i++) none *= Math.max(0, total - k - i) / (total - i);
    return { covering, p: g && total ? 1 - none : 0, unseenTotal: total, coveringCopies: k };
  };

  function tracker(src: string, setup: GameState, sides: { corp: string; runner: string }) {
    const setupDeck = countCodes([...setup.runner.grip, ...setup.runner.stack, ...rigOf(setup)]);
    let open: Commit[] = [];
    let ci = 0;
    const flush = (c: Commit, why: string) => {
      console.log(JSON.stringify({ ...c.line, outcome: why, plays: c.plays, breached: c.breached, runs: c.runs, stolen: c.stolen, endRez: c.endRez }));
    };
    return {
      feed(before: GameState, a: GameAction | null, after: GameState) {
        if (!PARTS.has('commits') || !a) return;
        // A commit (Q1)
        if (a.player === 'corp' && before.activePlayer === 'corp') {
          const m = agendaMoveOf(before, a, after);
          if (m?.server?.startsWith('remote')) {
            const h = holdOf('beta', after, m.server);
            if (h.holds) {
              const unseen = reader.hold.unseenRunnerCards!(after);
              const money = Object.fromEntries([...unseen].filter(([c, k]) => MONEY.has(c) && k));
              const arms = Object.fromEntries(ARMS.filter(x => x !== 'control').map(x => [x, holdOf(x, after, m.server!, x.startsWith('commit')).holds]));
              const ch = chance(after, m.server, unseen);
              // MEASURING ONLY: the recorded grip, grip + stack, the setup deck list less the public cards
              const grip = after.runner.grip.map(c => c.cardCode);
              const gs = countCodes([...after.runner.grip, ...after.runner.stack]);
              const publicNow = countCodes([...after.runner.heap, ...rigOf(after), ...[...rigOf(after), ...installedCorp(after)].flatMap(c => c.hostedCards ?? []).filter(c => cardDef(c).side_code === 'runner'), ...after.removedFromGame.filter(c => cardDef(c).side_code === 'runner')]);
              const setupLess = new Map(setupDeck);
              for (const [c, k] of publicNow) setupLess.set(c, Math.max(0, (setupLess.get(c) ?? 0) - k));
              const line = {
                kind: 'c', src, ci: ci++, aid: m.id, T: before.turnNumber, act: m.act, agenda: m.code, server: m.server, corpSide: sides.corp, runnerSide: sides.runner,
                margin: r1(h.margin), need: r1(h.need), budget: r1(h.budget), grip: after.runner.grip.length, credits: after.runner.credits, clicks: after.runner.maxClicks,
                money, arms, p: Math.round(ch.p * 1000) / 1000, covering: ch.covering, unseenTotal: ch.unseenTotal, coveringCopies: ch.coveringCopies,
                truth: { gripMoney: grip.filter(c => MONEY.has(c)), gripCovering: grip.filter(c => ch.covering.includes(c)).length, deckVsGripStack: codeDiff(unseen, gs), deckVsSetup: codeDiff(unseen, setupLess) },
              };
              // One open commit per agenda: a later move on it the same turn replaces the earlier (both lines are kept)
              open = open.filter(o => {
                if (o.id !== m.id || o.phase !== 'corp') return true;
                flush(o, 'superseded');
                return false;
              });
              open.push({ line, id: m.id, server: m.server, turn: before.turnNumber, phase: 'corp', plays: [], breached: false, runs: 0, stolen: false, endRez: null });
            }
          }
        }
        // The Corp's turn ends: the count at the Runner's turn start (the Corp's later moves the same turn are in it)
        if (before.activePlayer === 'corp' && after.activePlayer === 'runner') {
          for (const o of open.filter(x => x.phase === 'corp')) {
            o.phase = 'runner';
            o.gripAtStart = new Set(after.runner.grip.map(c => c.instanceId));
            o.rigAtStart = new Set(runnerInstalled(after).map(c => c.instanceId));
            const at = placeOf(after, o.id);
            const h = at === o.server ? holdOf('beta', after, o.server) : null;
            o.line.atRunnerTurn = { at, holds: h?.holds ?? null, margin: h ? r1(h.margin) : null, rezSet: h?.rez ?? null, corpCredits: after.corp.credits };
            o.endRez = h?.rez ?? null;
          }
        }
        // The Runner's turn: grip cards played or installed before the breach, runs, the breach, the steal
        for (const o of open.filter(x => x.phase === 'runner')) {
          // A run on the server begun by this step (a click or a run event: runsThisTurn is pushed at each run's start)
          if (after.runsThisTurn.length > before.runsThisTurn.length && after.runsThisTurn[after.runsThisTurn.length - 1].server === o.server) o.runs++;
          if (!o.breached) {
            // An event played from the grip by this action; a card installed since the turn began (by a click, an
            // event or an ability: Madani hosting a program from the grip mid-run), once each
            const seen = new Set(o.plays.map(p => p.id));
            const played = a.type === 'PLAY_OPERATION_OR_EVENT' ? before.runner.grip.find(c => c.instanceId === (a as { cardInstanceId?: string }).cardInstanceId) : undefined;
            const fresh = runnerInstalled(after).filter(c => !o.rigAtStart!.has(c.instanceId) && !seen.has(c.instanceId));
            for (const [c, how] of [...(played ? [[played, 'event'] as const] : []), ...fresh.map(c => [c, 'install'] as const)])
              o.plays.push({ id: c.instanceId, code: c.cardCode, how, drawn: !o.gripAtStart!.has(c.instanceId), money: MONEY.has(c.cardCode), breaker: /Icebreaker/.test(cardDef(c).keywords ?? '') });
            const ok = (s: GameState) => s.runsThisTurn.filter(x => x.server === o.server && x.successful).length;
            const breach = ok(after) > ok(before) || (!!after.activeRun?.breached && after.activeRun.server === o.server && !(before.activeRun?.breached && before.activeRun.server === o.server));
            if (breach) {
              o.breached = true;
              const ice = after.corp.servers[o.server]?.ice ?? before.corp.servers[o.server]?.ice ?? [];
              o.line.atBreach = { unrezzed: ice.filter(c => !c.isRezzed).map(c => c.instanceId), rezSetUnrezzed: (o.endRez ?? []).filter(id => ice.some(c => c.instanceId === id && !c.isRezzed)), credits: before.runner.credits };
            }
          }
          if (after.runner.scoreArea.some(c => c.instanceId === o.id)) o.stolen = true;
        }
        // The Runner's turn is over (or the game): every commit it answered is written
        if ((before.activePlayer === 'runner' && after.activePlayer === 'corp') || after.winner) {
          for (const o of open) flush(o, o.phase === 'runner' ? (after.winner && before.activePlayer !== 'runner' ? 'game over' : 'answered') : 'game over');
          open = after.winner ? [] : open.filter(x => x.phase === 'corp');
        }
      },
      end() {
        for (const o of open) flush(o, 'source end');
        open = [];
      },
    };
  }

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
      const start = dealState(seed);
      const tr = tracker(src, start, { corp: 'ai', runner: 'ai' });
      const game = new GameRunner(start, { corp: watch(createAgent('corp', 'normal')), runner: createAgent('runner', 'normal') });
      for (let k = 0; k < 4000; k++) {
        const before = game.state;
        if (!game.step()) break;
        tr.feed(before, game.last, game.state);
      }
      tr.end();
    }),
    ...humanFiles().map(f => () => {
      const report = JSON.parse(readFileSync(f, 'utf8'));
      if (!report.moves?.length) return;
      const src = `human:${f.split('/').pop()}`;
      let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
      if (report.startStops) s = { ...s, stops: report.startStops };
      const ai = report.config.ai as string;
      const tr = tracker(src, s, { corp: ai === 'corp' ? 'ai-old' : 'human', runner: ai === 'runner' ? 'ai-old' : 'human' });
      let i = 0;
      for (const move of report.moves as GameAction[]) {
        if (actingSide(s) === move.player && !(s.priority && s.priority.holder === 'corp' && s.activePlayer === 'runner')) decision(src, i++, s);
        const before = s;
        try {
          s = executeAction(s, move);
        } catch {
          break;
        }
        tr.feed(before, move, s);
      }
      tr.end();
    }),
  ];
  sources.forEach((run, k) => {
    if (k % shards === shard) run();
  });
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

void main();
