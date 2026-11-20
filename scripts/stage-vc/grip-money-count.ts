/**
 * V-C item 5 (F2, the grip money risk), count step. Brief: /mnt/project-files/netrunner-ai/stage-vc/item5-grip-money/brief.md.
 * Scripts only, NO ARM: nothing in src or tests, no AI is asked a decision. Starts from the Stage D count
 * (scripts/stage-d/grip-money-fire.ts on the parked branch ai-grip-money: its commit tracker, outcome classes) and the
 * V-C harness (scripts/stage-vc/held-op.ts: the 259 sources, the source check against the g1 record).
 *
 * Sources (kinds apart: self, humanRunner = a person played the Runner, humanCorp = a person played the Corp):
 *  (a) the 221 deals of the g1 base, played by this checkout's src (the SOURCE graph: a plain GameRunner, Normal v Normal,
 *      never asked anything else and never cleared mid-game: found row 71b). Each game's winner, cr and sc are checked
 *      against scripts/stage-d/post-pick-deals.json (the record of 44381468776; V-C item 1 moved 6 deals since);
 *  (b) the human files in tests/fixtures/human-games, the recorded moves replayed by the engine.
 * Every measuring call (serverHold, stealOdds, runScore) goes to the MEASURE graph: a copy of src in its own module graph,
 * cleared before each call, so no cache of the source game is touched. Its one patch (measuring only, read by nothing in
 * play): with `__gmCreditsOnly` set, passOdds compares iceCreditNeed (credits only) instead of iceCost (credits plus
 * value) with the Runner's credits, under its own memo key (brief rule 3's caution, RM-PASSODDS-UNITS).
 *
 * Rows (JSON lines): `m` an agenda move (a Corp install or advance of an agenda into or in a remote): owner 1
 * (serverHold 'runnerTurn' with the Corp's credits after it, on the Corp's decision view of the board after the move),
 * owner 2 (stealOdds of that server on the same view, and the credits-only variant), the Corp's known grip cards (Q4);
 * then the recorded next Runner turn: breach, steal, the cards played or installed from the grip before the breach, the
 * money made before the run that got in and by what, what started that run, runs that turn and the first server, and
 * the Runner's runScore of that server on its own view at the start of the turn. `src` per source (the check).
 * Q3 (PARTS=pin): the F2 pin's fixture.
 *
 * HIDDEN READS (measuring only, the oracle columns; no AI reads them): the recorded grip (which card was played or
 * installed before the breach, whether it was drawn that turn, the money events really in the grip: `gripMoney`).
 * Owner 1, owner 2 and runScore are called on the side's own decision view (corpDecisionView / runnerDecisionView).
 * The Runner's view is built without the agent's access memory (not read from the source's agent).
 *
 *   SHARD=0/64 npx vite-node scripts/stage-vc/grip-money-count.ts
 *   ARGS="DEALS=1321 HUMAN=none" npx vite-node scripts/stage-vc/grip-money-count.ts
 *   ARGS="PARTS=pin" npx vite-node scripts/stage-vc/grip-money-count.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { deckGameSetup } from '../../src/data/decks';
import { dealState } from '../stage-a/harness';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/grip-money', String(shard));
const PART = process.env.PARTS ?? 'count';
const G = globalThis as any;
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const key = (a: unknown) => JSON.stringify(a ?? null);

// ------------------------------------------------------------------------------------------------ the measure graph
const PATCHES: [string, string, string][] = [
  ['ai/effectValues.ts', 'const cost = iceCost(state, ice);', 'const cost = (globalThis as any).__gmCreditsOnly ? iceCreditNeed(state, ice) : iceCost(state, ice);'],
  ['ai/effectValues.ts', '`stealOdds:${serverId}:${run}:${coming}`', '`stealOdds${(globalThis as any).__gmCreditsOnly ? "C" : ""}:${serverId}:${run}:${coming}`'],
];
interface Measure {
  hold: any;
  ev: any;
  runs: any;
  tp: any;
  pricing: any;
  hv: any;
  vm: any;
  clear: () => void;
}
async function loadMeasure(): Promise<Measure> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dir = join(root, 'measure');
  cpSync('src', join(dir, 'src'), { recursive: true });
  for (const [f, at, to] of PATCHES) {
    const p = join(dir, 'src', f);
    const text = readFileSync(p, 'utf8');
    if (text.split(at).length !== 2) throw new Error(`measure patch does not match once in ${f}: ${at}`);
    writeFileSync(p, text.replace(at, () => to));
  }
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/corp/hold.ts', 'ai/effectValues.ts', 'ai/runs.ts', 'ai/turnPlanner.ts', 'ai/pricing.ts', 'ai/handValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts']) mods.push(await m(p));
  const [, hold, effv, runs, tp, pricing, hv, vm, iv] = mods;
  return {
    hold,
    ev: effv,
    runs,
    tp,
    pricing,
    hv,
    vm,
    clear: () => {
      hv.clearHandCaches();
      effv.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
let M: Measure;

/** f on the side's own decision view of s, in that side's pricing context (as rankMainActions does). */
function asSide<T>(side: 'corp' | 'runner', s: GameState, f: (view: GameState) => T): T {
  M.clear();
  return M.pricing.asSide(side, () => {
    const view = side === 'corp' ? M.tp.corpDecisionView(s) : M.tp.runnerDecisionView(s);
    M.hv.decisionContext(view, side);
    return f(view);
  });
}
/** Owner 1 and owner 2 for `server` on the Corp's view of the board after the move. */
function owners(s: GameState, server: string) {
  try {
    return asSide('corp', s, view => {
      const h = M.hold.serverHold(view, server, { when: 'runnerTurn', corpCredits: view.corp.credits });
      const so = M.ev.stealOdds(view, server);
      G.__gmCreditsOnly = true;
      let soC: number;
      try {
        soC = M.ev.stealOdds(view, server);
      } finally {
        G.__gmCreditsOnly = false;
      }
      return { holds: !!h.holds, margin: r1(h.margin), need: r1(h.need), budget: r1(h.budget), rez: h.rez, steal: r3(so), stealCr: r3(soC) };
    });
  } catch (e) {
    return { err: (e as Error).message.slice(0, 120) };
  }
}

// ------------------------------------------------------------------------------------------------ board helpers
const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
const installedCorp = (s: GameState) => Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice]);
const serverOf = (s: GameState, id: string) => Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id))?.id;
const rigOf = (s: GameState) => [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
const runnerInstalled = (s: GameState) => [...rigOf(s), ...[...rigOf(s), ...installedCorp(s)].flatMap(c => c.hostedCards ?? [])].filter(c => cardDef(c).side_code === 'runner');
/**
 * The money events: the Stage D arms' list (grip-money-arms.mjs GRIP_EVENTS: Sure Gamble, Creative Commission, Strike
 * Fund, Overclock, Trick Shot, Sell Out), the events that give credits before or during a run. A printed gain paid
 * only after a successful run (Clean Getaway, Transfer of Wealth) cannot pay the way in and is not counted.
 */
const MONEY_CODES = new Set(['30030', '30020', '34001', '30029', '34087', '36011']);
const isMoney = (c: CardInstance) => MONEY_CODES.has(c.cardCode);
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
function agendaMoveOf(before: GameState, a: GameAction, after: GameState) {
  const id = 'cardInstanceId' in a ? ((a as any).cardInstanceId as string | undefined) : undefined;
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
const title = (c: CardInstance) => cardDef(c).title;

// ------------------------------------------------------------------------------------------------ the tracker
type Kind = 'self' | 'humanRunner' | 'humanCorp';
interface Open {
  line: Record<string, any>;
  id: string;
  server: string;
  phase: 'corp' | 'runner';
  gripAtStart?: Set<string>;
  rigAtStart?: Set<string>;
  plays: { code: string; title: string; how: string; drawn: boolean; money: boolean; breaker: boolean }[];
  breached: boolean;
  runs: number;
  stolen: boolean;
  rezSet: string[] | null;
}
/** One Runner turn's record (shared by the exposures it answers): credit moves outside runs, run starts. */
interface TurnLog {
  creditsAtStart: number;
  made: { by: string; n: number }[];
  runs: { server: string; by: string; credits: number; madeBefore: Record<string, number> }[];
}
function tracker(src: string, kind: Kind) {
  let open: Open[] = [];
  let mi = 0;
  let turn: TurnLog | null = null;
  const flush = (o: Open, why: string) => {
    const t = turn;
    const runAt = t && o.breached ? t.runs.find(r => r.server === o.server && r === o.line._run) : undefined;
    const { _run, ...line } = o.line;
    void _run;
    out({
      ...line,
      outcome: why,
      plays: o.plays,
      breached: o.breached,
      runs: o.runs,
      stolen: o.stolen,
      turn: t && o.phase === 'runner' ? { runs: t.runs.map(r => r.server), first: t.runs[0]?.server ?? null, n: t.runs.length, creditsAtStart: t.creditsAtStart } : null,
      paid: runAt ? { by: runAt.by, creditsAtRunStart: runAt.credits, madeBefore: runAt.madeBefore } : null,
    });
  };
  return {
    feed(before: GameState, a: GameAction | null, after: GameState) {
      if (!a) return;
      // An agenda move by the Corp on its turn
      if (a.player === 'corp' && before.activePlayer === 'corp') {
        const m = agendaMoveOf(before, a, after);
        if (m?.server?.startsWith('remote')) {
          const own = owners(after, m.server);
          // Q4: grip cards the Corp has seen (state.runner.knownToCorp, still in the grip), money events among them
          const known = (after.runner.knownToCorp ?? []).filter((e: any) => typeof e === 'object' && after.runner.grip.some(c => c.instanceId === e.id));
          const knownMoney = known.filter((e: any) => {
            const c = after.runner.grip.find(x => x.instanceId === e.id)!;
            return isMoney(c);
          }).length;
          const line = {
            kind: 'm', src, sk: kind, mi: mi++, aid: m.id, T: before.turnNumber, act: m.act, agenda: m.code, server: m.server, ...own,
            grip: after.runner.grip.length, rCredits: after.runner.credits, cCredits: after.corp.credits, known: known.length, knownMoney, knownCodes: known.map((e: any) => e.code),
            // HIDDEN READ (measuring only): the money events really in the grip
            gripMoney: after.runner.grip.filter(isMoney).map(c => c.cardCode),
          };
          open = open.filter(o => {
            if (o.id !== m.id || o.phase !== 'corp') return true;
            flush(o, 'superseded');
            return false;
          });
          open.push({ line, id: m.id, server: m.server, phase: 'corp', plays: [], breached: false, runs: 0, stolen: false, rezSet: (own as any).rez ?? null });
        }
      }
      // The Corp's turn ends: the board at the Runner's turn start
      if (before.activePlayer === 'corp' && after.activePlayer === 'runner') {
        turn = { creditsAtStart: after.runner.credits, made: [], runs: [] };
        for (const o of open.filter(x => x.phase === 'corp')) {
          o.phase = 'runner';
          o.gripAtStart = new Set(after.runner.grip.map(c => c.instanceId));
          o.rigAtStart = new Set(runnerInstalled(after).map(c => c.instanceId));
          const at = placeOf(after, o.id);
          const h = at === o.server ? owners(after, o.server) : null;
          o.line.atRunnerTurn = { at, holds: (h as any)?.holds ?? null, margin: (h as any)?.margin ?? null, steal: (h as any)?.steal ?? null };
          o.rezSet = (h as any)?.rez ?? o.rezSet;
          // (i) the Runner's own runScore of the server on its view at the start of the turn, and the credits its ice takes
          if (at === o.server) {
            let rs: Record<string, unknown>;
            try {
              rs = asSide('runner', after, view => {
                const worth = M.runs.runScore(view, o.server);
                const budget = M.runs.runBudget(view);
                const spend = (view.corp.servers[o.server]?.ice ?? []).filter((c: CardInstance) => c.isRezzed).reduce((n: number, c: CardInstance) => n + Math.min(M.runs.iceCreditNeed(view, c), budget), 0);
                return { worth: r1(worth), spend: r1(spend), budget: r1(budget) };
              });
            } catch (e) {
              rs = { err: (e as Error).message.slice(0, 80) };
            }
            o.line.runScore = rs;
          }
        }
      }
      // The Runner's turn
      if (before.activePlayer === 'runner' && turn) {
        const delta = after.runner.credits - before.runner.credits;
        const ev = a.type === 'PLAY_OPERATION_OR_EVENT' ? before.runner.grip.find(c => c.instanceId === (a as any).cardInstanceId) : undefined;
        const by = a.type === 'GAIN_CREDIT' ? 'click' : ev ? `event:${title(ev)}` : a.type === 'START_TURN' ? 'turnStart' : `card:${a.type}`;
        if (!before.activeRun && delta > 0) turn.made.push({ by, n: delta });
        if (after.runsThisTurn.length > before.runsThisTurn.length) {
          const madeBefore: Record<string, number> = {};
          for (const x of turn.made) madeBefore[x.by] = (madeBefore[x.by] ?? 0) + x.n;
          turn.runs.push({ server: after.runsThisTurn[after.runsThisTurn.length - 1].server, by: a.type === 'INITIATE_RUN' ? 'click' : ev ? `event:${title(ev)}` : `card:${a.type}`, credits: before.runner.credits, madeBefore });
        }
      }
      for (const o of open.filter(x => x.phase === 'runner')) {
        if (after.runsThisTurn.length > before.runsThisTurn.length && after.runsThisTurn[after.runsThisTurn.length - 1].server === o.server) o.runs++;
        if (!o.breached) {
          const played = a.type === 'PLAY_OPERATION_OR_EVENT' ? before.runner.grip.find(c => c.instanceId === (a as any).cardInstanceId) : undefined;
          const fresh = runnerInstalled(after).filter(c => !o.rigAtStart!.has(c.instanceId));
          for (const c of fresh) o.rigAtStart!.add(c.instanceId);
          // HIDDEN READ (measuring only): which grip card, drawn this turn or held
          for (const [c, how] of [...(played ? [[played, 'event'] as const] : []), ...fresh.map(c => [c, 'install'] as const)]) {
            o.plays.push({ code: c.cardCode, title: title(c), how, drawn: !o.gripAtStart!.has(c.instanceId), money: isMoney(c), breaker: /Icebreaker/.test(cardDef(c).keywords ?? '') });
          }
          const ok = (s: GameState) => s.runsThisTurn.filter(x => x.server === o.server && x.successful).length;
          const breach = ok(after) > ok(before) || (!!after.activeRun?.breached && after.activeRun.server === o.server && !(before.activeRun?.breached && before.activeRun.server === o.server));
          if (breach) {
            o.breached = true;
            const ice = after.corp.servers[o.server]?.ice ?? before.corp.servers[o.server]?.ice ?? [];
            o.line.atBreach = { unrezzed: ice.filter(c => !c.isRezzed).length, rezSetUnrezzed: (o.rezSet ?? []).filter(id => ice.some(c => c.instanceId === id && !c.isRezzed)).length, credits: before.runner.credits };
            o.line._run = turn?.runs.filter(r => r.server === o.server).slice(-1)[0];
          }
        }
        if (after.runner.scoreArea.some(c => c.instanceId === o.id)) o.stolen = true;
      }
      if ((before.activePlayer === 'runner' && after.activePlayer === 'corp') || after.winner) {
        for (const o of open) flush(o, o.phase === 'runner' ? 'answered' : 'game over');
        open = after.winner ? [] : open.filter(x => x.phase === 'corp');
        turn = null;
      }
    },
    end() {
      for (const o of open) flush(o, 'source end');
      open = [];
    },
  };
}

// ------------------------------------------------------------------------------------------------ sources
const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'));
const hdir = 'tests/fixtures/human-games';

function playDeal(seed: number) {
  const rec = record.find(r => r.seed === seed)!;
  const src = `deal:${seed}`;
  const tr = tracker(src, 'self');
  const g = new GameRunner(dealState(seed), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  for (let n = 0; n < 4000; n++) {
    const before = g.state;
    if (before.turnNumber !== lastTurn && before.activePlayer === 'corp') {
      cr.push(before.corp.credits);
      sc.push(before.corp.score);
      lastTurn = before.turnNumber;
    }
    if (!g.step()) break;
    tr.feed(before, g.last, g.state);
  }
  tr.end();
  const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
  out({ kind: 'src', src, sk: 'self', decks: `${rec.corpDeck} v ${rec.runnerDeck}`, winner: g.state.winner ?? null, T: g.state.turnNumber, matchesRecord: matches });
}
function playHuman(file: string) {
  const r = JSON.parse(readFileSync(join(hdir, file), 'utf8'));
  if (!r.moves?.length) return;
  const kind: Kind = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
  const src = `human:${file}`;
  let s: GameState;
  if (r.startsAt === 'state') s = structuredClone(r.state);
  else {
    s = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    if (r.startStops) s = { ...s, stops: r.startStops };
  }
  const tr = tracker(src, kind);
  let stopped: string | null = null;
  for (const [j, move] of (r.moves as GameAction[]).entries()) {
    const before = s;
    try {
      s = executeAction(s, move);
    } catch (e) {
      stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
      break;
    }
    tr.feed(before, move, s);
  }
  tr.end();
  out({ kind: 'src', src, sk: kind, moves: r.moves.length, stopped });
}

// ------------------------------------------------------------------------------------------------ Q3: the fixture
function partPin() {
  const s0: GameState = JSON.parse(readFileSync('tests/fixtures/adversarial/stage-c-f2-grip-money.json', 'utf8'));
  const remotes = (s: GameState) => Object.values(s.corp.servers).filter(v => v.isRemote).map(v => v.id);
  const cc = s0.runner.grip.find(c => c.cardCode === '30020');
  const ccNet = cc ? M.vm.moneyGain(cc) : null;
  const income = (s: GameState, server: string, n: number) => asSide('corp', s, view => r3(M.ev.stealOdds(view, server, M.ev.STEAL.run, n)));
  out({ kind: 'pin', at: 'before', runnerCredits: s0.runner.credits, corpCredits: s0.corp.credits, grip: s0.runner.grip.map(title), STEAL: M.ev.STEAL, creativeCommissionNet: ccNet, servers: Object.fromEntries(remotes(s0).map(id => [id, { ...owners(s0, id), stealWithEventIncome: ccNet ? income(s0, id, ccNet) : null }])) });
  const g = new GameRunner(s0, { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 100 && g.state.activePlayer === 'corp' && !g.state.winner; i++) {
    const before = g.state;
    if (!g.step()) break;
    const m = g.last ? agendaMoveOf(before, g.last, g.state) : null;
    if (m?.server) out({ kind: 'pin', at: `after ${m.act} ${m.code}`, server: m.server, ...owners(g.state, m.server), stealWithEventIncome: ccNet ? income(g.state, m.server, ccNet) : null });
  }
  const b = g.state;
  out({ kind: 'pin', at: 'end of the Corp turn', runnerCredits: b.runner.credits, corpCredits: b.corp.credits, servers: Object.fromEntries(remotes(b).map(id => [id, { root: b.corp.servers[id].root.map(title), ice: b.corp.servers[id].ice.map(c => `${title(c)}${c.isRezzed ? '' : ' (u)'}`), ...owners(b, id), stealWithEventIncome: ccNet ? income(b, id, ccNet) : null }])) });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  M = await loadMeasure();
  if (PART === 'pin') partPin();
  else {
    const want = (process.env.DEALS ?? '').split(',').filter(Boolean);
    const dealList = want.includes('none') ? [] : record.filter(r => !want.length || want.includes(String(r.seed))).map(r => r.seed);
    const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
    const humans = hwant.includes('none')
      ? []
      : readdirSync(hdir)
          .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.startsWith(w))))
          .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));
    const sources = [...humans.map(f => () => playHuman(f)), ...dealList.map(seed => () => playDeal(seed))];
    sources.forEach((run, k) => {
      if (k % shards === shard) run();
    });
  }
  rmSync(root, { recursive: true, force: true });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
