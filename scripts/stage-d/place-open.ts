/**
 * Stage D item 5 step 1a (brief stage-d/item5-placement/brief.md section 3): where the Corp's ice goes, and what protects
 * a loaded asset. Scripts only; no source change.
 *
 * Trees: a copy of src/ per arm under .fc-variants/place-open/<shard>/<arm>/, made by the text patches of
 * place-open-patches.ts (base, a1, a2, b, c1, c2), each with item 4's layer probe and this script's placement probe.
 *
 * Sources (SHARD=k/n takes every n-th; one JSON line per record, summed by place-open-sum.mjs):
 *  - ask:<deal>   the 56 local deals played by the base tree's Normal Corp (one agent, its memory kept) against this
 *                 tree's Normal Runner, caches cleared before every decision; at every Corp main-phase and prompt
 *                 decision a fresh Normal Corp of each tree is asked on a copy ('decision': pick, layer, ms, hold asks);
 *                 a changed main-phase decision is played on in each changed tree and base ('cont': the Corp's turn and
 *                 the Runner's next). The game itself is watched as below ('game', 'ice', 'turn', 'run', 'loss').
 *  - ask:<human>  the 36 human games replayed move for move (the recorded moves), asked and watched the same way.
 *  - play:<deal>:<arm>  the 56 deals played out by an arm's Corp (a1, a2, b, c1, c2) against this tree's Runner, watched.
 *
 * What a game's watch records:
 *  - 'ice': every Corp ice install (the ice ledger): the rule that placed it (the tree's own order asked on that state:
 *    place's reason and the candidate's line; 'unoffered' when today's order does not offer that exact move), its
 *    server and the install cost paid (8.5.11a); the hold count of that server before and after (serverHold
 *    'runnerTurn': holds, entries), the stake there (agendas: stake().loss; assets: the denial owner's worth, as c1);
 *    and, by the game's end: rezzed or never, met by a run or never, runs it stopped (the run ended while the Runner
 *    encountered it), the Runner's credits spent during its encounters (the tax), runs that passed it.
 *  - 'turn': at each Runner turn's start, every staked server (HQ, R&D, Archives or a remote with an agenda stake;
 *    a remote holding an asset worth more than 0) and whether it holds by the count; ice and agendas in HQ.
 *  - 'run': every run: server, kind, breached, points taken, assets trashed.
 *  - 'loss': a game the Corp lost on agenda points, classed as item 4 (a/b/c/n), and read backwards (backTrace).
 *  - 'abreach': a breach of a remote holding an asset, with the hold at the Runner turn's start, read backwards when no
 *    rez set held it.
 *    SHARD=0/64 npx vite-node scripts/stage-d/place-open.ts > out-0.txt
 *    DEALS=1001 HUMAN=none ARMS=a1 NO_PLAY=1 npx vite-node scripts/stage-d/place-open.ts
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, getLegalActions, wantsStop } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { asSide } from '../../src/ai/pricing';
import { serverHold } from '../../src/ai/corp/hold';
import { stake } from '../../src/ai/corp/pools';
import { scoringRemote } from '../../src/ai/corp/lines';
import { corpCardValue } from '../../src/ai/evaluate';
import { accessTrap } from '../../src/ai/runs';
import { clearCaches, dealState, deals, humanFiles } from '../stage-a/harness';
import { probe } from './game-end-patches';
import { PATCHES, placeProbe } from './place-open-patches';

const want = (process.env.ARMS ?? '').split(',').filter(Boolean);
const ARMS = ['base', ...Object.keys(PATCHES).filter(a => !want.length || want.includes(a))];
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve('.fc-variants', process.env.PO_ROOT ?? 'place-open', String(shard));
const out = (o: unknown) => console.log(JSON.stringify(o));
const WIN = 7; // rule 1.7.2a
const G = globalThis as unknown as Record<string, any>;
const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'player').sort())) : 'null');

function makeTrees(): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of ARMS) {
    const dir = join(root, arm);
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [file, from, to] of [...probe, ...placeProbe, ...(PATCHES[arm] ?? [])]) {
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
  arm: string;
  createAgent: typeof createAgent;
  clear: () => void;
  candidates: (s: GameState, legal: GameAction[], opts: { held: unknown; freeExhausted: boolean }) => unknown[];
  stats: { asked: number; searched: number };
}

async function load(arm: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  const cand = await m('ai/corp/candidates.ts');
  const hold = await m('ai/corp/hold.ts');
  return {
    arm,
    createAgent: ai.createAgent,
    candidates: cand.corpCandidates,
    stats: hold.holdCacheStats,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}

// ------------------------------------------------------------------------------------------------ board readings

const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
const isIce = (c: CardInstance) => typeOf(c) === 'ice';
const isAgenda = (c: CardInstance) => typeOf(c) === 'agenda';

function findCard(s: GameState, id: string): CardInstance | undefined {
  const c = s.corp;
  return [...c.hq, ...c.rd, ...c.archives.faceUp, ...c.archives.faceDown, ...Object.values(c.servers).flatMap(v => [...v.root, ...v.ice])].find(k => k.instanceId === id);
}
const serverOfIce = (s: GameState, id: string) => Object.values(s.corp.servers).find(v => v.ice.some(c => c.instanceId === id))?.id;

function short(s: GameState, a: GameAction | null): string {
  if (!a) return 'pass';
  const x = a as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean; server?: string };
  const card = x.cardInstanceId ? findCard(s, x.cardInstanceId) : null;
  const name = card ? cardDef(card).title : '';
  const where = x.asNewRemote ? '->new' : x.targetServerId ? `->${x.targetServerId}` : x.server ? `@${x.server}` : '';
  return `${a.type}${name ? ` ${name}` : ''}${where}`;
}

/** The denial owner's worth of the assets in a remote's root (access traps none), as arm c1 reads it. */
function assetWorth(s: GameState, id: string): number {
  const v = s.corp.servers[id];
  if (!v?.isRemote) return 0;
  return asSide('corp', () => v.root.filter(c => typeOf(c) === 'asset' && !accessTrap(c.cardCode)).reduce((n, c) => n + Math.max(0, corpCardValue(c, s, 'runner', true)), 0));
}

const kindOf = (s: GameState, id: string) => (id === 'hq' || id === 'rd' || id === 'archives' ? id : s.corp.servers[id]?.root.some(isAgenda) ? 'remote:agenda' : s.corp.servers[id]?.root.some(c => typeOf(c) === 'asset') ? 'remote:asset' : 'remote');

/** Staked servers: an agenda stake (stake().loss > 0) or a remote whose assets are worth more than 0. */
function staked(s: GameState) {
  return asSide('corp', () =>
    Object.keys(s.corp.servers)
      .map(id => {
        const loss = stake(s, id).loss;
        const worth = assetWorth(s, id);
        return { id, kind: kindOf(s, id), loss: +loss.toFixed(2), worth: +worth.toFixed(2) };
      })
      .filter(v => v.loss > 0 || v.worth > 0)
      .map(v => {
        const h = serverHold(s, v.id, { when: 'runnerTurn' });
        return { ...v, holds: h.holds, entries: h.entries, ice: s.corp.servers[v.id].ice.length, unrezzed: s.corp.servers[v.id].ice.filter(c => !c.isRezzed).length };
      }),
  );
}

// ------------------------------------------------------------------------------------------------ backward trace

interface IceRow {
  id: string;
  title: string;
  T: number;
  server: string;
  install: number;
}

/**
 * The losing (or breached) server `x` at board `e` (the Runner's turn start): for each Corp turn t from `tEnd` back to
 * the first, the ice the Corp installed on another server from t on (still installed on `e`) and the ice in HQ on `e`,
 * moved onto `x` unrezzed, outermost in install order: does `x` then hold by the count? Money: the Corp's credits on `e`,
 * plus the install costs those ice were paid elsewhere and the rez costs of those rezzed there (refunded), less the
 * install costs on `x` (1 credit per ice already protecting it, rule 8.5.11a). `latest` is the latest turn from which
 * the move holds (with the money; null when none); `free` is the same with the money unbounded (is it the ice or the
 * money); `missing` when no turn holds: 'money' (holds with the money unbounded), 'deck ice' (holds when every ice
 * still in R&D is added too, unbounded), else 'ice' (no placement of ice it had or could draw).
 */
function backTrace(e: GameState, x: string, ledger: IceRow[], tEnd: number, held: { T: number; ids: string[] }[] = []) {
  const target = e.corp.servers[x];
  if (!target) return null;
  const hqIce = e.corp.hq.filter(isIce);
  const turns = [...new Set([...ledger.map(r => r.T), ...held.map(h => h.T)].filter(T => T <= tEnd))].sort((a, b) => b - a);
  // Ice the Corp held in HQ at a Corp turn's start from t on and discarded since (in Archives on `e`)
  const archived = [...e.corp.archives.faceUp, ...e.corp.archives.faceDown].filter(isIce);
  const discardedFrom = (t: number) => {
    const ids = new Set(held.filter(h => h.T >= t && h.T <= tEnd).flatMap(h => h.ids));
    return archived.filter(c => ids.has(c.instanceId));
  };
  const test = (t: number, unbounded: boolean, extra: CardInstance[] = []) => {
    const moved = ledger
      .filter(r => r.T >= t && r.T <= tEnd && r.server !== x)
      .map(r => ({ r, at: serverOfIce(e, r.id) }))
      .filter(m => m.at && m.at !== x);
    const ids = new Set(moved.map(m => m.r.id));
    let credits = e.corp.credits;
    const servers = Object.fromEntries(Object.entries(e.corp.servers).map(([k, v]) => [k, { ...v, ice: v.ice.filter(c => !ids.has(c.instanceId)) }]));
    const add: CardInstance[] = [];
    for (const m of moved) {
      const card = e.corp.servers[m.at!].ice.find(c => c.instanceId === m.r.id)!;
      credits += m.r.install + (card.isRezzed ? cardDef(card).cost ?? 0 : 0);
      add.push({ ...card, isRezzed: false });
    }
    const discarded = discardedFrom(t);
    for (const c of [...hqIce, ...discarded, ...extra]) add.push({ ...c, isRezzed: false });
    let n = servers[x].ice.length;
    for (const c of add) credits -= n++;
    servers[x] = { ...servers[x], ice: [...servers[x].ice, ...add] };
    const hqIds = new Set(hqIce.map(c => c.instanceId));
    const view: GameState = { ...e, corp: { ...e.corp, hq: e.corp.hq.filter(c => !hqIds.has(c.instanceId)), servers } };
    if (!unbounded && credits < 0) return { holds: false, added: add.length, discarded: discarded.length, credits };
    const h = asSide('corp', () => serverHold(view, x, { when: 'runnerTurn', corpCredits: unbounded ? 999 : credits }));
    return { holds: h.holds, need: h.need, budget: h.budget, rezCost: h.rezCost, added: add.length, discarded: discarded.length, credits };
  };
  const now = asSide('corp', () => serverHold(e, x, { when: 'runnerTurn' }));
  let latest: number | null = null;
  let freeLatest: number | null = null;
  const tests: Record<string, unknown>[] = [];
  const first = turns.length ? turns[turns.length - 1] : tEnd;
  for (const t of turns.length ? turns : [tEnd]) {
    const r = test(t, false);
    const f = latest === null || freeLatest === null ? test(t, true) : null;
    tests.push({ t, holds: r.holds, free: f?.holds, added: r.added, discarded: r.discarded, credits: r.credits, need: (r as { need?: number }).need, budget: (r as { budget?: number }).budget });
    if (r.holds && latest === null) latest = t;
    if (f?.holds && freeLatest === null) freeLatest = t;
    if (latest !== null && freeLatest !== null) break;
  }
  let missing: string | null = null;
  if (latest === null) {
    if (freeLatest !== null) missing = 'money';
    else missing = test(first, true, e.corp.rd.filter(isIce)).holds ? 'deck ice' : 'ice';
  }
  return { now: { holds: now.holds, need: now.need, budget: now.budget, ice: target.ice.length }, tEnd, latest, back: latest === null ? null : tEnd - latest, freeLatest, missing, hqIce: hqIce.length, tests };
}

// ------------------------------------------------------------------------------------------------ the game watch

/**
 * Watches one game: `order(s)` gives the tree's own order on a state (placement reasons and lines by action key).
 * Call decision(s) before each Corp decision, move(s, a) for each Corp move, step(prev, next) after each engine step,
 * end(s) at the game's end.
 */
function watcher(src: string, who: string, arm: string, order: (s: GameState) => { reasons: Map<string, string>; lines: Map<string, { line: number; behind: boolean }> }) {
  const ledger: (IceRow & Record<string, unknown>)[] = [];
  const life = new Map<string, { rezzed: boolean; met: number; stopped: number; passed: number; tax: number; rezPaid: number }>();
  const turns: { T: number; start: GameState; end?: GameState; moves: string[]; hqIce: string[] }[] = [];
  const held = () => turns.map(t => ({ T: t.T, ids: t.hqIce }));
  const runnerTurnStarts: { T: number; s: GameState }[] = [];
  let run: { server: string; score: number; extra: number; encounter: string | null; credits: number; last: string | null; assets: string[]; breached: boolean } | null = null;
  let lastRun: { server: string; pts: number; extra: number } | null = null;
  const scores: { T: number; pts: number; server: string }[] = [];
  let runs = 0;
  return {
    decision(s: GameState) {
      if (s.activePlayer !== 'corp') return;
      if (!turns.length || turns[turns.length - 1].T !== s.turnNumber) turns.push({ T: s.turnNumber, start: s, moves: [], hqIce: s.corp.hq.filter(isIce).map(c => c.instanceId) });
    },
    move(s: GameState, a: GameAction) {
      const t = turns[turns.length - 1];
      if (s.activePlayer === 'corp' && t && t.T === s.turnNumber && a.type !== 'PASS') t.moves.push(short(s, a));
      if (a.type === 'SCORE_AGENDA') {
        const id = (a as { cardInstanceId?: string }).cardInstanceId ?? '';
        const v = Object.values(s.corp.servers).find(sv => sv.root.some(c => c.instanceId === id));
        const card = findCard(s, id);
        scores.push({ T: s.turnNumber, pts: card ? cardDef(card).agenda_points ?? 0 : 0, server: v?.id ?? '?' });
      }
      if (a.type !== 'INSTALL_CARD') return;
      const x = a as GameAction & { cardInstanceId: string; targetServerId?: string; asNewRemote?: boolean };
      const card = s.corp.hq.find(c => c.instanceId === x.cardInstanceId);
      if (!card) return;
      const type = typeOf(card);
      if (type !== 'ice' && type !== 'asset') return;
      let o: ReturnType<typeof order> | null = null;
      try {
        o = order(s);
      } catch (e) {
        o = null;
      }
      const k = key(a);
      const reason = o?.reasons.get(k) ?? 'unoffered';
      const line = o?.lines.get(k) ?? null;
      let after: GameState | null = null;
      try {
        after = executeAction(s, a);
      } catch {
        return;
      }
      const server = x.asNewRemote ? (type === 'ice' ? serverOfIce(after, card.instanceId) : Object.values(after.corp.servers).find(v => v.root.some(c => c.instanceId === card.instanceId))?.id) : x.targetServerId;
      if (!server) return;
      const before = s.corp.servers[server];
      const hq = s.corp.hq.filter(c => c.instanceId !== card.instanceId);
      const facts = asSide('corp', () => {
        const was = before ? serverHold(s, server, { when: 'runnerTurn' }) : null;
        const now = serverHold(after!, server, { when: 'runnerTurn', corpCredits: after!.corp.credits });
        const loss = before ? stake(s, server, { leaving: card.instanceId }).loss : 0;
        const sc = scoringRemote(s)?.id === server;
        return { was: was ? { holds: was.holds, entries: was.entries } : null, now: { holds: now.holds, entries: now.entries }, loss: +loss.toFixed(2), scoring: sc };
      });
      // Other servers that did not hold on `s` (where else the ice could have gone): HQ and R&D
      const centrals = asSide('corp', () => Object.fromEntries((['hq', 'rd'] as const).map(id => {
        const h = serverHold(s, id, { when: 'runnerTurn' });
        return [id, { holds: h.holds, entries: h.entries, ice: s.corp.servers[id].ice.length, loss: +stake(s, id, { leaving: card.instanceId }).loss.toFixed(2) }];
      })));
      const row = {
        kind: 'ice',
        src,
        who,
        arm,
        T: s.turnNumber,
        type,
        id: card.instanceId,
        title: cardDef(card).title,
        server,
        serverKind: x.asNewRemote ? 'new' : kindOf(s, server),
        install: type === 'ice' ? (x.asNewRemote ? 0 : before?.ice.length ?? 0) : 0,
        reason,
        line: line?.line ?? null,
        behind: line?.behind ?? null,
        ...facts,
        worth: type === 'asset' ? +assetWorth(after, server).toFixed(2) : +assetWorth(s, server).toFixed(2),
        centrals,
        hqAgendas: hq.filter(isAgenda).length,
        corp: s.corp.credits,
        clicks: s.corp.clicks,
        score: [s.corp.score, s.runner.score],
      };
      if (type === 'ice') {
        ledger.push(row);
        life.set(card.instanceId, { rezzed: false, met: 0, stopped: 0, passed: 0, tax: 0, rezPaid: 0 });
      } else out({ ...row, kind: 'asset' });
    },
    step(prev: GameState, next: GameState) {
      // Rezzes of ledger ice
      for (const [id, l] of life) {
        if (l.rezzed) continue;
        const c = Object.values(next.corp.servers).flatMap(v => v.ice).find(k => k.instanceId === id);
        if (c?.isRezzed) {
          l.rezzed = true;
          l.rezPaid = Math.max(0, prev.corp.credits - next.corp.credits);
        }
      }
      if (prev.activePlayer === 'corp' && next.activePlayer === 'runner') {
        const t = turns[turns.length - 1];
        if (t && t.T === prev.turnNumber) t.end = next;
        runnerTurnStarts.push({ T: next.turnNumber, s: next });
        try {
          out({ kind: 'turn', src, who, arm, T: next.turnNumber, servers: staked(next), hqIce: next.corp.hq.filter(isIce).length, hqAgendas: next.corp.hq.filter(isAgenda).length, corp: next.corp.credits, score: [next.corp.score, next.runner.score] });
        } catch (e) {
          out({ kind: 'turn', src, who, arm, T: next.turnNumber, error: (e as Error).message });
        }
      }
      const pr = prev.activeRun;
      const nr = next.activeRun;
      if (!pr && nr) {
        const v = prev.corp.servers[nr.server];
        run = { server: nr.server, score: prev.runner.score, extra: 0, encounter: null, credits: prev.runner.credits, last: null, assets: v ? v.root.filter(c => typeOf(c) === 'asset').map(c => c.instanceId) : [], breached: false };
        runs++;
      }
      if (run && nr) {
        run.extra = Math.max(run.extra, nr.extraAccesses ?? 0);
        if (nr.isSuccessful || (nr.accessedCount ?? 0) > 0) run.breached = true;
        const enc = nr.encounter?.iceId ?? null;
        if (enc !== run.encounter) {
          if (run.encounter) {
            const l = life.get(run.encounter);
            if (l) {
              l.tax += Math.max(0, run.credits - next.runner.credits);
              l.passed++;
            }
          }
          if (enc) {
            const l = life.get(enc);
            if (l) l.met++;
            run.credits = prev.runner.credits;
            run.last = enc;
          }
          run.encounter = enc;
        }
      }
      if (run && (!nr || next.winner)) {
        // The run ended: an encounter in progress stopped it (the subroutines ended it, or the Runner jacked out there)
        if (run.encounter) {
          const l = life.get(run.encounter);
          if (l) {
            l.tax += Math.max(0, run.credits - next.runner.credits);
            if (!run.breached) l.stopped++;
            else l.passed++;
          }
        }
        const pts = next.runner.score - run.score;
        const trashed = run.assets.filter(id => !Object.values(next.corp.servers).some(v => v.root.some(c => c.instanceId === id)));
        if (pts > 0 || trashed.length) run.breached = true;
        const rs = [...runnerTurnStarts].reverse().find(r => r.T <= next.turnNumber);
        const at = rs?.s.corp.servers[run.server];
        let hold: { holds: boolean; need: number; budget: number } | null = null;
        if (rs && at) {
          const h = asSide('corp', () => serverHold(rs.s, run!.server, { when: 'runnerTurn' }));
          hold = { holds: h.holds, need: h.need, budget: h.budget };
        }
        out({ kind: 'run', src, who, arm, T: next.turnNumber, server: run.server, serverKind: kindOf(prev, run.server), breached: run.breached, pts, assets: run.assets.length, trashed: trashed.length, hold, ice: at?.ice.length ?? null });
        if (run.breached && run.assets.length && prev.corp.servers[run.server]?.isRemote && rs) {
          // An asset breach (item 3's class): read backwards when no rez set held the server at the Runner turn's start
          const worth = assetWorth(rs.s, run.server);
          const lastCorp = [...turns].reverse().find(t => t.T < next.turnNumber || (t.end && t.end.turnNumber <= next.turnNumber));
          let back = null;
          if (hold && !hold.holds && worth > 0) {
            try {
              back = backTrace(rs.s, run.server, ledger, lastCorp?.T ?? next.turnNumber, held());
            } catch (e) {
              back = { error: (e as Error).message };
            }
          }
          out({ kind: 'abreach', src, who, arm, T: next.turnNumber, server: run.server, worth: +worth.toFixed(2), trashed: trashed.length, ice: at?.ice.length ?? 0, unrezzed: at?.ice.filter(c => !c.isRezzed).length ?? 0, hold, back });
        }
        lastRun = { server: run.server, pts, extra: run.extra };
        run = null;
      }
    },
    end(s: GameState) {
      for (const r of ledger) {
        const l = life.get(r.id)!;
        out({ ...r, life: { ...l, at: serverOfIce(s, r.id) ?? 'gone' } });
      }
      out({ kind: 'game', src, who, arm, corpId: cardDef(s.corp.identity).title, runnerId: cardDef(s.runner.identity).title, winner: s.winner ?? null, reason: s.winReason ?? null, T: s.turnNumber, score: [s.corp.score, s.runner.score], scores, runs, hqIceAtEnd: s.corp.hq.filter(isIce).length });
      if (s.winner !== 'runner' || !/agenda points/.test(s.winReason ?? '') || !lastRun) return;
      const win = lastRun;
      const turn = [...turns].reverse().find(t => t.end && t.end.turnNumber <= s.turnNumber);
      if (!turn?.end) {
        out({ kind: 'loss', src, who, arm, T: s.turnNumber, server: win.server, note: 'no Corp turn found' });
        return;
      }
      const end = turn.end;
      const id = win.server;
      const v = end.corp.servers[id];
      const endPts = asSide('corp', () => (v ? stake(end, id).points : 0));
      const ends = end.runner.score + endPts >= WIN;
      const hold = asSide('corp', () => (v ? serverHold(end, id, { when: 'runnerTurn' }) : null));
      const cls = !v || !ends ? 'n' : hold?.holds ? 'a' : 'bc';
      let back = null;
      if (v) {
        try {
          back = backTrace(end, id, ledger, turn.T, held());
        } catch (e) {
          back = { error: (e as Error).message };
        }
      }
      out({ kind: 'loss', src, who, arm, T: s.turnNumber, server: id, serverKind: kindOf(end, id), runPts: win.pts, extra: win.extra, corpTurn: turn.T, ends, cls, hold: hold ? { holds: hold.holds, need: hold.need, budget: hold.budget } : null, ice: v?.ice.length ?? 0, corp: end.corp.credits, back, corpMoves: turn.moves });
    },
  };
}

// ------------------------------------------------------------------------------------------------ agents and play

function treeCorp(t: Tree, onDecide?: (s: GameState) => void): Agent {
  const inner = t.createAgent('corp', 'normal');
  return new Proxy(inner, {
    get(target, prop, recv) {
      if (prop === 'chooseAction' || prop === 'chooseRez')
        return (...args: unknown[]) => {
          onDecide?.(args[0] as GameState);
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

/** The tree's own order on `s`: placement reasons and lines by action key (the probe). */
function orderOf(t: Tree, held: () => unknown) {
  return (s: GameState) => {
    G.__poState = s;
    G.__poRec = new Map();
    G.__poLines = new Map();
    try {
      t.clear();
      clearCaches();
      asSide('corp', () => t.candidates(s, getLegalActions(s, 'corp'), { held: structuredClone(held() ?? null), freeExhausted: false }));
      return { reasons: G.__poRec as Map<string, string>, lines: G.__poLines as Map<string, { line: number; behind: boolean }> };
    } finally {
      G.__poState = undefined;
    }
  };
}

/** Plays on from `s` with a tree's Corp: the rest of the Corp's turn and the Runner's next turn. */
function playOn(t: Tree, s: GameState) {
  const game = new GameRunner(structuredClone(s), { corp: treeCorp(t), runner: mainRunner() });
  const moves: string[] = [];
  let n = 0;
  try {
    while (n++ < 120 && !game.state.winner) {
      const st = game.state;
      if (st.activePlayer === 'runner') break;
      if (!game.step()) break;
      if (actingSide(st) === 'corp' && game.last && game.last.type !== 'PASS') moves.push(short(st, game.last));
    }
  } catch (e) {
    moves.push(`error: ${(e as Error).message}`);
  }
  const atEnd = game.state;
  let servers: unknown = null;
  try {
    servers = staked(atEnd);
  } catch (e) {
    servers = (e as Error).message;
  }
  const runs: { server: string; breached: boolean; pts: number; trashed: number }[] = [];
  if (!atEnd.winner) {
    let run: { server: string; breached: boolean; score: number; assets: string[] } | null = null;
    try {
      while (n++ < 400 && !game.state.winner) {
        const st = game.state;
        if (st.activePlayer === 'corp' && st.turnNumber > atEnd.turnNumber && !st.activeRun) break;
        if (!game.step()) break;
        const nx = game.state;
        if (!st.activeRun && nx.activeRun) run = { server: nx.activeRun.server, breached: false, score: st.runner.score, assets: (st.corp.servers[nx.activeRun.server]?.root ?? []).filter(c => typeOf(c) === 'asset').map(c => c.instanceId) };
        if (run && nx.activeRun?.isSuccessful) run.breached = true;
        if (run && (!nx.activeRun || nx.winner)) {
          const trashed = run.assets.filter(id => !Object.values(nx.corp.servers).some(v => v.root.some(c => c.instanceId === id))).length;
          runs.push({ server: run.server, breached: run.breached, pts: nx.runner.score - run.score, trashed });
          run = null;
        }
      }
    } catch (e) {
      runs.push({ server: `error: ${(e as Error).message}`, breached: false, pts: 0, trashed: 0 });
    }
  }
  return { moves, servers, corpEnd: atEnd.corp.credits, hqIce: atEnd.corp.hq.filter(isIce).length, runs, winner: game.state.winner ?? null };
}

async function main() {
  const dirs = makeTrees();
  const trees: Record<string, Tree> = {};
  for (const arm of ARMS) trees[arm] = await load(arm, dirs[arm]);

  /** Every Corp main-phase and prompt decision: each tree's pick on a copy. */
  const decide = (src: string, who: string, i: number, s: GameState) => {
    if (s.winner) return;
    const r: Record<string, { a: string; ms: number; asks: number; fire: number; c2: string | null; layer?: string; short: string }> = {};
    const order = [...ARMS.slice(i % ARMS.length), ...ARMS.slice(0, i % ARMS.length)];
    for (const arm of order) {
      const t = trees[arm];
      t.clear();
      clearCaches();
      const copy = structuredClone(s);
      G.__geLayer = undefined;
      G.__poFire = 0;
      G.__poC2 = null;
      const asked0 = t.stats.asked;
      const t0 = performance.now();
      let a: GameAction | null = null;
      let err: string | null = null;
      try {
        a = t.createAgent('corp', 'normal').chooseAction(copy);
      } catch (e) {
        err = `error: ${(e as Error).message}`;
      }
      const ms = performance.now() - t0;
      r[arm] = { a: err ?? key(a), ms: Math.round(ms), asks: t.stats.asked - asked0, fire: G.__poFire ?? 0, c2: G.__poC2 ?? null, layer: G.__geLayer, short: err ?? short(s, a) };
    }
    const changed = ARMS.filter(arm => arm !== 'base' && r[arm].a !== r.base.a);
    const hq = s.corp.hq;
    out({
      kind: 'decision',
      src,
      who,
      i,
      T: s.turnNumber,
      phase: s.pendingPrompts.length ? 'prompt' : 'main',
      corp: s.corp.credits,
      clicks: s.corp.clicks,
      score: [s.corp.score, s.runner.score],
      hqIce: hq.filter(isIce).length,
      hqAsset: hq.filter(c => typeOf(c) === 'asset').length,
      changed,
      picks: Object.fromEntries(ARMS.map(arm => [arm, changed.length || arm === 'base' ? r[arm].short : undefined])),
      layers: Object.fromEntries(ARMS.map(arm => [arm, changed.length ? r[arm].layer : undefined])),
      ms: Object.fromEntries(ARMS.map(arm => [arm, r[arm].ms])),
      asks: Object.fromEntries(ARMS.map(arm => [arm, r[arm].asks])),
      fire: Object.fromEntries(ARMS.map(arm => [arm, r[arm].fire])),
      c2: Object.fromEntries(ARMS.map(arm => [arm, r[arm].c2])),
    });
    if (changed.length && !s.pendingPrompts.length && !process.env.NO_CONT && s.activePlayer === 'corp') {
      for (const arm of ['base', ...changed]) {
        try {
          out({ kind: 'cont', src, who, i, T: s.turnNumber, arm, ...playOn(trees[arm], s) });
        } catch (e) {
          out({ kind: 'cont', src, who, i, T: s.turnNumber, arm, error: (e as Error).message });
        }
      }
    }
  };

  const base = trees.base;
  const playDeal = (seed: number, arm: string, ask: boolean) => {
    const t = trees[arm];
    const src = `deal:${seed}`;
    let corpAgent: Agent | null = null;
    const held = () => (corpAgent as unknown as { memory?: { heldLine?: unknown } })?.memory?.heldLine ?? null;
    const w = watcher(src, 'self', arm, orderOf(t, held));
    let i = 0;
    const inner = t.createAgent('corp', 'normal');
    corpAgent = inner;
    const corp = new Proxy(inner, {
      get(target, prop, recv) {
        if (prop === 'chooseAction' || prop === 'chooseRez')
          return (state: GameState, cards?: CardInstance[]) => {
            w.decision(state);
            if (ask && prop === 'chooseAction' && actingSide(state) === 'corp') decide(src, 'self', i++, state);
            t.clear();
            clearCaches();
            const a = prop === 'chooseRez' ? target.chooseRez!(state, cards!) : target.chooseAction(state);
            if (a && actingSide(state) === 'corp') w.move(state, a);
            return a;
          };
        return Reflect.get(target, prop, recv);
      },
    });
    const game = new GameRunner(dealState(seed), { corp, runner: mainRunner() });
    let prev = game.state;
    for (let k = 0; k < 4000 && game.step(); k++) {
      w.step(prev, game.state);
      prev = game.state;
    }
    w.end(game.state);
  };

  const sources: (() => void)[] = [
    ...deals().map(seed => () => playDeal(seed, 'base', !process.env.NO_ASK)),
    ...humanFiles().map(file => () => {
      const report = JSON.parse(readFileSync(file, 'utf8'));
      if (!report.moves?.length) return;
      const src = `human:${file.split('/').pop()}`;
      const who = report.config.ai === 'corp' ? 'person-runner' : 'person-corp';
      const w = watcher(src, who, 'base', orderOf(base, () => null));
      let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
      if (report.startStops) s = { ...s, stops: report.startStops };
      let i = 0;
      for (const move of report.moves as GameAction[]) {
        const window = s.priority;
        if (actingSide(s) === 'corp' && !s.winner) {
          w.decision(s);
          const rezWindow = window && window.holder === 'corp' && s.activePlayer === 'runner';
          if (!rezWindow && !process.env.NO_ASK) decide(src, who, i++, s);
          w.move(s, move);
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
    }),
    ...(process.env.NO_PLAY ? [] : ARMS.filter(a => a !== 'base').flatMap(arm => deals().map(seed => () => playDeal(seed, arm, false)))),
  ];
  void wantsStop;
  sources.forEach((run, k) => {
    if (k % shards !== shard) return;
    const t0 = performance.now();
    try {
      run();
    } catch (e) {
      console.error(`source ${k}: ${(e as Error).stack}`);
      out({ kind: 'error', k, message: (e as Error).message });
    }
    out({ kind: 'source', k, ms: Math.round(performance.now() - t0) });
  });
  if (existsSync(root) && !process.env.PO_KEEP) rmSync(root, { recursive: true, force: true });
}

void main();
