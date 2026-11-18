/**
 * Stage D, "the Corp does not rez the set its agenda counted on", the count step (brief:
 * /mnt/project-files/netrunner-ai/stage-d/rez-follow/brief.md). Scripts only: the arms are text patches on copies of
 * src/ (rez-follow-arms.json; runner-money-trees.ts makeTrees). Sources: the fire count's 92, the 56 local deals played
 * by this checkout's Normal AIs and the human games replayed (scripts/stage-a/harness.ts), split by SHARD.
 *
 * Found row 71b: the tree that plays a source game (this checkout, `.`) is never asked or cleared. Every question goes
 * to a copy: `beta` (identical, asked for picks and for the window facts), `control` (identical, the time base), and the
 * arms. Each local deal's Corp credits and score at each Corp turn start are printed (`p` lines) so the sum can check
 * them against the g1 batch's deals.json: the sources are the batch's games.
 *
 * One pass over each source; JSON lines:
 *  - `d` (FIRE, Q3): every Corp decision (main phase, prompt, and rez windows with a candidate), asked of every copy on
 *    its own structuredClone by a fresh Normal Corp, order rotated, timed; a decision over a stop (2x control at 0.5 s
 *    or more, or 3 s slower) is timed twice more, both trees, medians kept. Rez windows of approach-ice carry the beta
 *    copy's window facts (rez-follow-lib.ts windowFacts: the rule, rezStops both ways, the 'thisRun' hold with, without,
 *    alone, modelRezGain, the keep), the server's kind, and in human games the recorded answer. Where an arm's pick
 *    differs from beta's, both are played on (CONT): that tree's Normal Corp against the beta copy's Normal Runner by
 *    GameRunner, to the game's end, with a mark at each turn's end (scores, the Corp's credits, and at the end of a
 *    Runner turn the keep, rezMoney on the Corp's view, asked of the beta copy).
 *  - `r` (Q2): every run on which the Corp met an approach-ice window: its windows (the facts' summary, the answer the
 *    source game took, the Runner's credits spent at that ice, whether the run ended there), and its outcome (ended,
 *    got in, agenda stolen). `stopCheck`: a holding set the count named at a window, rezzed in full by the run's end,
 *    while the Runner still got in (the brief's third table: a 'thisRun' count error, a STOP).
 *  - `x` (Q1, Q3): the exposures of EXPOSE (src:T:server), played from the Runner's turn start by each copy's Corp
 *    against the beta copy's Runner (a human game: the recorded Runner moves while the copy's Corp answers as recorded,
 *    then the beta copy's Runner from the first window it answers otherwise); stolen or not.
 *  - `p`: a local deal's record (cr, sc at each Corp turn start; the winner).
 * Hidden information: nothing here gives an arm the grip, the stack's order or a facedown Runner card; windowFacts asks
 * on the Corp's view. The measuring side reads no recorded hidden card.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/rez-follow.ts
 *   DEALS=1081 HUMAN=none PARTS=fire,windows npx vite-node scripts/stage-d/rez-follow.ts
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, wantsStop } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';
import { makeTrees, readArms } from './runner-money-trees';
import { Tree, WindowFacts, askAction, askRez, isRezWindow, key, loadTree, serverKind, windowFacts } from './rez-follow-lib';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
process.env.ARMS_FILE ||= 'scripts/stage-d/rez-follow-arms.json';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const file = readArms();
const TREES = Object.keys(file.arms);
const PARTS = new Set((process.env.PARTS ?? 'fire,windows,cont,expose').split(','));
const END = process.env.END !== '0';
const EXPOSE = (process.env.EXPOSE ?? 'deal:1081:16:remote-2,deal:1601:6:remote-1,deal:1641:18:remote-1,human:report-33.json:7:remote-3').split(',').filter(Boolean).map(x => {
  const p = x.split(':');
  return { src: `${p[0]}:${p[1]}`, T: Number(p[2]), server: p[3] };
});
const root = resolve(process.env.TROOT ?? '.rf-fire', String(shard));
const r1 = (x: number) => Math.round(x * 10) / 10;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';

async function main() {
  const dirs = makeTrees(file, root);
  const trees: Record<string, Tree> = {};
  for (const t of TREES) trees[t] = await loadTree(t, dirs[t]);
  const beta = trees.beta;

  // ------------------------------------------------------------------------------------------------ continuations
  const cont = (t: string, s: GameState) => {
    trees[t].clear();
    beta.clear();
    const g = new trees[t].GameRunner(structuredClone(s), { corp: trees[t].createAgent('corp', 'normal'), runner: beta.createAgent('runner', 'normal') });
    const marks: { ended: string; corp: number; runner: number; credits: number; keep?: number | string; T: number }[] = [];
    let last = g.state.activePlayer;
    const runners = () => marks.filter(m => m.ended === 'runner').length;
    for (let n = 0; n < 6000 && !g.state.winner && (END || runners() < 2); n++) {
      if (!g.step()) break;
      const now = g.state.activePlayer;
      if (now !== last) {
        const m: (typeof marks)[number] = { ended: last, corp: g.state.corp.score, runner: g.state.runner.score, credits: g.state.corp.credits, T: g.state.turnNumber };
        // The keep at the end of the first Runner turn (the F1 danger): rezMoney on the Corp's view, beta copy
        if (last === 'runner' && runners() === 0)
          try {
            m.keep = beta.asSide('corp', () => beta.rezMoney(beta.corpDecisionView(structuredClone(g.state))).keep);
          } catch (e) {
            m.keep = `error ${(e as Error).message.slice(0, 40)}`;
          }
        marks.push(m);
        last = now;
      }
    }
    return { start: { corp: s.corp.score, runner: s.runner.score, credits: s.corp.credits }, marks: marks.slice(0, 4), end: { corp: g.state.corp.score, runner: g.state.runner.score, T: g.state.turnNumber }, winner: g.state.winner ?? null };
  };

  // ------------------------------------------------------------------------------------------------ fire
  let n = 0;
  const decision = (src: string, i: number, s: GameState, dk: 'rez' | 'main' | 'prompt' | 'run', recorded?: GameAction | null): { facts?: WindowFacts; betaPick: string } | null => {
    if (!PARTS.has('fire') || s.winner) return null;
    const k = n++ % TREES.length;
    const order = [...TREES.slice(k), ...TREES.slice(0, k)];
    const ask = (t: string) => (dk === 'rez' ? askRez(trees[t], s) : askAction(trees[t], s));
    const r: Record<string, { a: string; ms: number }> = {};
    for (const t of order) r[t] = ask(t);
    const retimed: string[] = [];
    for (const a of TREES.filter(x => x !== 'control')) {
      if (!((r[a].ms >= 500 && r[a].ms > 2 * r.control.ms) || r[a].ms > r.control.ms + 3000)) continue;
      const am = [r[a].ms, ask(a).ms, ask(a).ms];
      const cm = [r.control.ms, ask('control').ms, ask('control').ms];
      retimed.push(`${a}:${am.map(r1).join('/')}|control:${cm.map(r1).join('/')}`);
      r[a] = { ...r[a], ms: median(am) };
      r.control = { ...r.control, ms: median(cm) };
    }
    const changed = TREES.filter(a => a !== 'beta' && r[a].a !== r.beta.a);
    const out: Record<string, unknown> = { kind: 'd', src, i, T: s.turnNumber, dk, changed, ms: Object.fromEntries(TREES.map(t => [t, r1(r[t].ms)])) };
    if (retimed.length) out.retimed = retimed;
    let facts: WindowFacts | undefined;
    let ice: CardInstance | undefined;
    if (dk === 'rez') {
      const run = s.activeRun!;
      out.server = run.server;
      out.sk = serverKind(beta, s, run.server);
      out.step = s.priority?.step;
      if (s.priority?.step === 'approach_ice') {
        ice = s.corp.servers[run.server]?.ice[run.icePosition ?? -1];
        if (ice && !ice.isRezzed) {
          facts = windowFacts(beta, s, ice);
          out.ice = { id: ice.instanceId, code: ice.cardCode, title: cardDef(ice).title, pos: run.icePosition, of: s.corp.servers[run.server].ice.length };
          out.facts = facts;
          out.corpCredits = s.corp.credits;
          out.runnerCredits = s.runner.credits;
          out.runnerClicks = s.runner.clicks;
          out.matchNeed = 7 - s.runner.score;
        }
      }
      if (recorded !== undefined) out.recorded = recorded ? key(recorded) : 'pass';
    }
    out.picks = Object.fromEntries(TREES.map(t => [t, r[t].a]));
    if (changed.length && PARTS.has('cont')) {
      const want = changed.filter(a => a !== 'control');
      if (want.length) {
        const c: Record<string, unknown> = { beta: cont('beta', s) };
        for (const a of want) c[a] = cont(a, s);
        out.cont = c;
      }
    }
    console.log(JSON.stringify(out));
    return { facts, betaPick: r.beta.a };
  };

  // ------------------------------------------------------------------------------------------------ runs (Q2)
  interface Win {
    i: number;
    pos: number;
    ice: string;
    code: string;
    facts?: WindowFacts;
    beta?: string;
    actual?: 'rez' | 'pass';
    credits0: number;
    tags0: number;
    spent?: number;
    tags?: number;
    endedHere?: boolean;
    closed?: boolean;
  }
  interface Run {
    src: string;
    T: number;
    server: string;
    sk: string;
    corpSide: string;
    runnerSide: string;
    wins: Win[];
    breached: boolean;
    stolen: string[];
    pendingWindow: Win | null;
  }
  function runTracker(src: string, sides: { corp: string; runner: string }) {
    let cur: Run | null = null;
    const close = (w: Win, s: GameState, ended: boolean) => {
      if (w.closed) return;
      w.closed = true;
      w.spent = w.credits0 - s.runner.credits;
      w.tags = s.runner.tags - w.tags0;
      w.endedHere = ended;
    };
    const finish = (after: GameState) => {
      if (!cur) return;
      const r = cur;
      cur = null;
      if (!r.wins.length) return;
      const last = after.runsThisTurn[after.runsThisTurn.length - 1];
      const inn = r.breached || !!last?.successful;
      for (const w of r.wins) close(w, after, !inn && w === r.wins[r.wins.length - 1] && !w.closed);
      const sv = after.corp.servers[r.server];
      const rezzedNow = new Set((sv?.ice ?? []).filter(c => c.isRezzed).map(c => c.instanceId));
      // The third table: a holding set the count named at a window, all rezzed by the run's end, and the Runner got in
      const stopCheck = inn
        ? r.wins.flatMap(w => [w.facts?.withIt.holds && w.actual === 'rez' ? { at: w.i, set: w.facts.withIt.rez! } : null, w.facts?.without.holds ? { at: w.i, set: w.facts.without.rez! } : null]).filter(x => x && x.set.every(id => rezzedNow.has(id)))
        : [];
      console.log(JSON.stringify({ kind: 'r', src, T: r.T, server: r.server, sk: r.sk, corpSide: r.corpSide, runnerSide: r.runnerSide, outcome: r.stolen.length ? 'stolen' : inn ? 'in' : 'ended', stolen: r.stolen, wins: r.wins.map(w => ({ ...w, facts: w.facts ? { rule: w.facts.rule, stopsT: w.facts.stopsT, stopsF: w.facts.stopsF, withIt: w.facts.withIt.holds, without: w.facts.without.holds, alone: w.facts.alone.holds, gain: w.facts.gain } : undefined })), stopCheck }));
      if (stopCheck.length) console.error(`STOP thisRun count: ${src} T${r.T} ${r.server} windows ${stopCheck.map(x => x!.at).join(',')}`);
    };
    return {
      window(i: number, s: GameState, facts: WindowFacts | undefined, betaPick: string | undefined) {
        const run = s.activeRun!;
        const ice = s.corp.servers[run.server]?.ice[run.icePosition ?? -1];
        if (!cur || !ice || s.priority?.step !== 'approach_ice') return;
        const w: Win = { i, pos: run.icePosition!, ice: ice.instanceId, code: ice.cardCode, facts, beta: betaPick === 'null' ? 'pass' : betaPick?.includes('REZ_CARD') ? 'rez' : betaPick, credits0: s.runner.credits, tags0: s.runner.tags };
        cur.wins.push(w);
        cur.pendingWindow = w;
      },
      feed(before: GameState, a: GameAction | null, after: GameState) {
        if (!a) return;
        const started = !!after.activeRun && (!before.activeRun || after.runsThisTurn.length > before.runsThisTurn.length);
        if (started) {
          if (cur) finish(before);
          cur = { src, T: after.turnNumber, server: after.activeRun!.server, sk: serverKind(beta, after, after.activeRun!.server), corpSide: sides.corp, runnerSide: sides.runner, wins: [], breached: false, stolen: [], pendingWindow: null };
        }
        if (!cur) return;
        if (cur.pendingWindow && a.player === 'corp') {
          cur.pendingWindow.actual = a.type === 'REZ_CARD' ? 'rez' : 'pass';
          cur.pendingWindow = null;
        } else if (cur.pendingWindow && a.player === 'runner') {
          // The window passed with no Corp move recorded (a person's stops): a pass
          cur.pendingWindow.actual = 'pass';
          cur.pendingWindow = null;
        }
        const run = after.activeRun;
        if (run?.breached) cur.breached = true;
        const before0 = new Set(before.runner.scoreArea.map(c => c.instanceId));
        for (const c of after.runner.scoreArea) if (!before0.has(c.instanceId) && isAgenda(c) && !cur.stolen.includes(c.instanceId)) cur.stolen.push(c.instanceId);
        // An ice is behind the Runner once its position moves inward or the run reaches the server
        for (const w of cur.wins) if (!w.closed && run && (run.icePosition === null || run.icePosition < w.pos)) close(w, after, false);
        if (!run) finish(after);
      },
      end(s: GameState) {
        finish(s);
      },
    };
  }

  // ------------------------------------------------------------------------------------------------ exposures (x)
  const runnerTurnAI = (t: string, s: GameState, server: string) => {
    trees[t].clear();
    beta.clear();
    const g = new trees[t].GameRunner(structuredClone(s), { corp: trees[t].createAgent('corp', 'normal'), runner: beta.createAgent('runner', 'normal') });
    const rezzed: string[] = [];
    for (let k = 0; k < 3000; k++) {
      const b = g.state as GameState;
      if (!g.step()) break;
      const a = g.last as GameAction;
      if (a?.type === 'REZ_CARD' && b.activeRun?.server === server) rezzed.push(a.cardInstanceId);
      if (b.activePlayer === 'runner' && g.state.activePlayer === 'corp') break;
    }
    return { state: g.state as GameState, rezzed };
  };
  const stolenFrom = (start: GameState, end: GameState, server: string) => {
    const ids = new Set((start.corp.servers[server]?.root ?? []).filter(isAgenda).map(c => c.instanceId));
    return end.runner.scoreArea.filter(c => ids.has(c.instanceId)).map(c => c.instanceId);
  };
  const exposeSelf = (src: string, T: number, server: string, start: GameState) => {
    const out: Record<string, unknown> = { kind: 'x', src, T, server };
    for (const t of TREES.filter(x => x !== 'control')) {
      const { state, rezzed } = runnerTurnAI(t, start, server);
      out[t] = { stolen: stolenFrom(start, state, server), rezzed, corpCredits: state.corp.credits };
    }
    console.log(JSON.stringify(out));
  };
  const exposeHuman = (src: string, T: number, server: string, start: GameState, moves: GameAction[]) => {
    const out: Record<string, unknown> = { kind: 'x', src, T, server };
    for (const t of TREES.filter(x => x !== 'control')) {
      let s = structuredClone(start);
      let switched: number | null = null;
      const rezzed: string[] = [];
      for (let k = 0; k < moves.length; k++) {
        const m = moves[k];
        if (isRezWindow(s, wantsStop) && s.activeRun?.server === server) {
          const cards = trees[t].rezCandidates(s, s.priority!.step);
          if (cards.length) {
            let ans: GameAction = { type: 'PASS', player: 'corp' };
            try {
              ans = (JSON.parse(askRez(trees[t], s).a) as GameAction | null) ?? ans;
            } catch {
              /* an error pick: passed */
            }
            const rec: GameAction = m.player === 'corp' ? m : { type: 'PASS', player: 'corp' };
            if (key(ans) !== key(rec)) {
              switched = k;
              s = executeAction(s, ans);
              if (ans.type === 'REZ_CARD') rezzed.push(ans.cardInstanceId);
              const rest = runnerTurnAI(t, s, server);
              rezzed.push(...rest.rezzed);
              s = rest.state;
              break;
            }
          }
        }
        if (m.type === 'REZ_CARD' && s.activeRun?.server === server) rezzed.push(m.cardInstanceId);
        try {
          s = executeAction(s, m);
        } catch {
          break;
        }
      }
      out[t] = { stolen: stolenFrom(start, s, server), rezzed, corpCredits: s.corp.credits, switchedAt: switched };
    }
    console.log(JSON.stringify(out));
  };

  // ------------------------------------------------------------------------------------------------ sources
  const sources: (() => void)[] = [
    ...deals().map(seed => () => {
      const src = `deal:${seed}`;
      let i = 0;
      const tr = runTracker(src, { corp: 'ai', runner: 'ai' });
      const watch = (inner: Agent): Agent =>
        new Proxy(inner, {
          get(target, prop, recv) {
            if (prop === 'chooseAction')
              return (state: GameState) => {
                decision(src, i++, state, state.pendingPrompts.length ? 'prompt' : state.activeRun ? 'run' : 'main');
                return target.chooseAction(state);
              };
            if (prop === 'chooseRez')
              return (state: GameState, cards: CardInstance[]) => {
                if (cards.length && PARTS.has('windows')) {
                  const at = i++;
                  const d = decision(src, at, state, 'rez');
                  tr.window(at, state, d?.facts, d?.betaPick);
                }
                return target.chooseRez!(state, cards);
              };
            return Reflect.get(target, prop, recv);
          },
        });
      const start = dealState(seed);
      const game = new GameRunner(start, { corp: watch(createAgent('corp', 'normal')), runner: createAgent('runner', 'normal') });
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      const want = EXPOSE.filter(e => e.src === src);
      const snaps: { T: number; server: string; s: GameState }[] = [];
      for (let k = 0; k < 4000; k++) {
        const before = game.state;
        if (before.turnNumber !== lastTurn && before.activePlayer === 'corp') {
          cr.push(before.corp.credits);
          sc.push(before.corp.score);
          lastTurn = before.turnNumber;
        }
        if (!game.step()) break;
        tr.feed(before, game.last, game.state);
        for (const e of want) if (before.turnNumber === e.T && before.activePlayer === 'corp' && game.state.activePlayer === 'runner') snaps.push({ T: e.T, server: e.server, s: structuredClone(game.state) });
      }
      tr.end(game.state);
      console.log(JSON.stringify({ kind: 'p', src, cr, sc, winner: game.state.winner ?? null }));
      if (PARTS.has('expose')) for (const x of snaps) exposeSelf(src, x.T, x.server, x.s);
    }),
    ...humanFiles().map(f => () => {
      const report = JSON.parse(readFileSync(f, 'utf8'));
      if (!report.moves?.length) return;
      const src = `human:${f.split('/').pop()}`;
      let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
      if (report.startStops) s = { ...s, stops: report.startStops };
      const ai = report.config.ai as string;
      const sides = { corp: ai === 'corp' ? 'ai-old' : 'human', runner: ai === 'runner' ? 'ai-old' : 'human' };
      const tr = runTracker(src, sides);
      const want = EXPOSE.filter(e => e.src === src);
      const snaps: { T: number; server: string; s: GameState; from: number }[] = [];
      const moves = report.moves as GameAction[];
      let i = 0;
      for (let k = 0; k < moves.length; k++) {
        const move = moves[k];
        if (!s.winner) {
          if (isRezWindow(s, wantsStop)) {
            const cards = beta.rezCandidates(structuredClone(s), s.priority!.step);
            if (cards.length && PARTS.has('windows')) {
              const at = i++;
              const d = decision(src, at, s, 'rez', move.player === 'corp' ? move : null);
              tr.window(at, s, d?.facts, d?.betaPick);
            }
          } else if (actingSide(s) === 'corp' && !(s.priority && s.priority.holder === 'corp' && s.activePlayer === 'runner')) decision(src, i++, s, s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main');
        }
        const before = s;
        try {
          s = executeAction(s, move);
        } catch {
          break;
        }
        tr.feed(before, move, s);
        for (const e of want) if (before.turnNumber === e.T && before.activePlayer === 'corp' && s.activePlayer === 'runner') snaps.push({ T: e.T, server: e.server, s: structuredClone(s), from: k + 1 });
      }
      tr.end(s);
      if (PARTS.has('expose'))
        for (const x of snaps) {
          // The recorded moves of that Runner turn
          const rest: GameAction[] = [];
          let t = structuredClone(x.s);
          for (let k = x.from; k < moves.length; k++) {
            rest.push(moves[k]);
            const b = t;
            try {
              t = executeAction(t, moves[k]);
            } catch {
              break;
            }
            if (b.activePlayer === 'runner' && t.activePlayer === 'corp') break;
          }
          exposeHuman(src, x.T, x.server, x.s, rest);
        }
    }),
  ];
  sources.forEach((run, k) => {
    if (k % shards === shard) run();
  });
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
