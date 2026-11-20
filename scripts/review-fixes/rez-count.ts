/**
 * Review fixes 2026-11-19, bundle R (rez and rez money), count step. Brief:
 * /mnt/project-files/netrunner-ai/review-fixes-1119/rez-count/brief.md. Scripts only: nothing in src or tests.
 * Trees and arms: rez-count-trees.ts (each a patched copy of this checkout's src, its own module graph). Built from
 * placement-wiring.ts (sources, asks, continuations).
 *
 * Sources (kinds kept apart everywhere: self, humanRunner = the person played the Runner, humanCorp):
 *  (a) the 221 deals of the g1 base (scripts/stage-d/post-pick-deals.json, the record of 44381468776; the g1 base of
 *      daffc389, 44633584479, is identical to it on 221 of 221 deals): each game's winner, cr and sc checked against it,
 *      played by the `source` tree with a plain GameRunner, Normal v Normal. The source tree is never asked or cleared
 *      mid-game; its agents' state is copied (structuredClone) before each step into the fresh agents that are asked.
 *  (b) the human files in tests/fixtures/human-games: the recorded moves replayed; at every board where the Corp decides,
 *      today's AI Corp is asked (fresh agents, no memory).
 *
 * Every Corp decision (main phase, prompt, rez window) is asked of beta, control and each arm: a one-step GameRunner on a
 * copy of the board with fresh agents of that tree, hand caches cleared first, the order of the trees rotated per
 * decision, timed. A control answer unlike beta's is a stop. Runner decisions are not asked (no arm's patch is read by
 * the Runner's own decisions except through rezMoney, which the Runner AI does not call: corpPorts.keep is read only
 * with the Corp acting).
 * Measures (the beta tree, untimed, on the deciding Corp's own view): at every decision the board's B numbers
 * (agendasUnseen, R&D's rez money); at every rez window `__rzMeasureAt` (A: LEO and the stoppers at the server; C: per
 * approached ice countedRez's exit, the hold owner's need both ways, line 98's handed credits both ways, spendsKept, the
 * priced rez's gain and, where it is above 0, the trace T).
 * C's `real`: at every approach-ice window where countedRez reaches spendsKept (R3t, R4t) or leaves at the free gate,
 * both worlds are played by the beta tree's GameRunner from the real board (copied agents; the Corp's rezzes forced to
 * the world's set: this ice in the rez world, nothing else rezzed; the Runner is the Normal AI): the Runner's credits as
 * it has passed the last rezzed ice of that world (the approached ice in the rez world, the rezzed ice further in),
 * 'out' where the run ends first. spentApart: spendsKept asked again on the deciding Corp's view with `real` for both
 * worlds ('out' keeps the handed number).
 * Continuations: for each arm's changed decision (capped at CAP a source and arm), from the board on the beta tree
 * (fresh agents, copied state), the arm's action first against beta's, beta's agents both sides to the end of the game;
 * spentApart's changed answers the same (its action: the rez where beta passed, the pass where beta rezzed).
 * D: each Corp rez window carries its deal, turn and the index of its run among the Runner's turn's runs (as count 3's
 * turn records count them), so the sums match the 37 rows of rez-d-list.json.
 *
 * Hidden information: agents are asked only through GameRunner (their own views); the measures read the deciding
 * Corp's view. The `real` playout and the continuations run on the real board, as a batch game does (the Runner AI
 * decides on its own view). This measuring script reads the score areas, the runs and the credits (public).
 *
 *   SHARD=0/64 npx vite-node scripts/review-fixes/rez-count.ts
 *   ARGS="DEALS=1001 HUMAN=none CAP=8" npx vite-node scripts/review-fixes/rez-count.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { ARMS, Arm, RZ_ARMS, Tree, loadTree, makeTrees } from './rez-count-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/rez-count', String(shard));
const CAP = Number(process.env.CAP ?? 8);
const MAXDEC = Number(process.env.MAXDEC ?? Infinity);
const ASKED: Arm[] = ['beta', 'control', ...(process.env.ARMS_ASK ? (process.env.ARMS_ASK.split(',') as Arm[]) : RZ_ARMS)];
const ASKED_ARMS = ASKED.slice(2);
const G = globalThis as any;
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r2 = (x: number) => Math.round(x * 100) / 100;

let trees: Record<string, Tree> = {};

// ------------------------------------------------------------------------------------------------ agents
type Snap = Record<string, unknown>;
function snapAgent(agent: any): Snap {
  const s: Snap = {};
  for (const [k, v] of Object.entries(agent)) {
    if (typeof v === 'function') continue;
    try {
      s[k] = structuredClone(v);
    } catch {
      /* not cloneable: left as the fresh agent has it */
    }
  }
  return s;
}
function restore(fresh: any, snap: Snap | undefined) {
  if (!snap) return fresh;
  for (const [k, v] of Object.entries(snap)) {
    const cur = fresh[k];
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && !(cur instanceof Map) && !(cur instanceof Set) && Object.getPrototypeOf(cur) !== Object.prototype)
      Object.assign(cur, structuredClone(v));
    else fresh[k] = structuredClone(v);
  }
  return fresh;
}
function agents(t: Tree, snaps?: { corp?: Snap; runner?: Snap }) {
  return {
    corp: restore(t.createAgent('corp', 'normal'), snaps?.corp),
    runner: restore(t.createAgent('runner', 'normal'), snaps?.runner),
  };
}

// ------------------------------------------------------------------------------------------------ decisions
type Cls = 'corpPrompt' | 'corpMain' | 'corpRez';
function decisionOf(core: any, s: GameState): { side: 'corp' | 'runner'; cls: Cls } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const ask = core.wantsStop(s, side, w);
    if (ask && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, cls: 'corpRez' };
    return null;
  }
  if (side !== 'corp') return null;
  return { side, cls: core.activePrompt(s) ? 'corpPrompt' : 'corpMain' };
}

interface Ask {
  a: GameAction | null;
  k: string;
  ms: number;
  fire: Record<string, number>;
  dec: any;
  m: any;
  view: GameState | null;
  err?: string;
}
function resetG() {
  G.__rzTop = false;
  G.__rzInTop = false;
  G.__rzFire = {};
  G.__rzDec = null;
  G.__rzM = null;
  G.__rzView = null;
  G.__rzReal = undefined;
}
function ask(t: Tree, s: GameState, snaps: { corp?: Snap; runner?: Snap } | undefined, measure = false): Ask {
  t.clear();
  const ag = agents(t, snaps);
  const g = new t.GameRunner(structuredClone(s), ag);
  resetG();
  G.__rzMeasure = measure;
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    const a = g.last as GameAction | null;
    return { a, k: key(a), ms, fire: G.__rzFire ?? {}, dec: G.__rzDec, m: G.__rzM, view: G.__rzView };
  } catch (e) {
    return { a: null, k: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at, fire: G.__rzFire ?? {}, dec: null, m: null, view: null, err: (e as Error).message.slice(0, 160) };
  } finally {
    G.__rzMeasure = false;
    resetG();
  }
}

function title(t: Tree, s: GameState, id: string): string {
  const c = t.core.findCardAnywhere(s, id);
  return c ? `${t.core.cardDef(c).type_code}:${t.core.cardDef(c).title}` : id;
}
function label(t: Tree, s: GameState, a: GameAction | null | undefined): string {
  if (!a) return 'none';
  const x = a as any;
  if (a.type === 'RESOLVE_PROMPT') {
    const c = x.choice;
    if (c.kind === 'effect_choice') return `prompt:${c.optionId}`;
    if (c.kind === 'effect_cards') return `prompt:[${c.cardInstanceIds.map((id: string) => title(t, s, id)).join(', ')}]`;
    return `prompt:${c.kind}`;
  }
  const id = x.cardInstanceId;
  const to = a.type === 'INSTALL_CARD' ? `>${x.asNewRemote || !x.targetServerId ? 'new' : x.targetServerId}${x.trashFirst?.length ? '(trash)' : ''}` : x.targetServerId ? `>${x.targetServerId}` : '';
  if (!id) return a.type + to;
  return `${a.type} ${title(t, s, id)}${to}`;
}

// ------------------------------------------------------------------------------------------------ C: the real credits
/**
 * The Runner's credits once it has passed the last rezzed ice of the world (the approached ice rezzed in 'rez', left
 * unrezzed in 'pass'; nothing else rezzed), played by the beta tree's GameRunner from the real board; 'out' when the run
 * ends first. gained: credits the Runner gained on the way (increases between steps, with the move).
 */
function realCredits(s0: GameState, snaps: { corp?: Snap; runner?: Snap } | undefined, iceId: string, world: 'rez' | 'pass'): { real: number | 'out'; gained: { n: number; by: string }[]; steps: number; err?: string } {
  const t = trees.beta;
  const run = s0.activeRun!;
  const ice = s0.corp.servers[run.server].ice;
  const pos = run.icePosition!;
  let last = -1;
  for (let i = pos; i >= 0; i--) if ((i === pos && world === 'rez') || (i < pos && ice[i].isRezzed)) last = i;
  if (last < 0) return { real: s0.runner.credits, gained: [], steps: 0 };
  t.clear();
  const ag = agents(t, snaps);
  const corp = new Proxy(ag.corp, {
    get(o, p) {
      if (p === 'chooseRez') return (_s: GameState, cards: any[]) => (world === 'rez' && cards.some(c => c.instanceId === iceId) ? { type: 'REZ_CARD', player: 'corp', cardInstanceId: iceId } : null);
      const v = o[p];
      return typeof v === 'function' ? v.bind(o) : v;
    },
  });
  const g = new t.GameRunner(structuredClone(s0), { corp, runner: ag.runner });
  const gained: { n: number; by: string }[] = [];
  try {
    for (let n = 0; n < 400; n++) {
      const prev: GameState = g.state;
      if (!g.step()) return { real: 'out', gained, steps: n };
      const st: GameState = g.state;
      if (st.runner.credits > prev.runner.credits) gained.push({ n: st.runner.credits - prev.runner.credits, by: label(t, prev, g.last) });
      const r = st.activeRun;
      if (!r || r.server !== run.server || st.turnNumber !== s0.turnNumber || st.winner) return { real: 'out', gained, steps: n + 1 };
      if (r.icePosition === null || r.icePosition < last) return { real: st.runner.credits, gained, steps: n + 1 };
    }
    return { real: 'out', gained, steps: 400, err: 'no end in 400 steps' };
  } catch (e) {
    return { real: 'out', gained, steps: -1, err: (e as Error).message.slice(0, 100) };
  }
}

// ------------------------------------------------------------------------------------------------ continuations
interface Cont {
  winner: string | null;
  T: number;
  cs: number;
  rs: number;
  err?: string;
}
function cont(s0: GameState, first: GameAction, snaps: { corp?: Snap; runner?: Snap } | undefined): Cont {
  const t = trees.beta;
  t.clear();
  const none: Cont = { winner: null, T: 0, cs: 0, rs: 0 };
  let s: GameState;
  try {
    if (!t.core.isLegalAction(s0, first)) return { ...none, err: 'not legal' };
    s = t.core.executeAction(structuredClone(s0), first);
  } catch (e) {
    return { ...none, err: (e as Error).message.slice(0, 100) };
  }
  const g = new t.GameRunner(s, agents(t, snaps));
  const done = (err?: string): Cont => ({ winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, ...(err ? { err } : {}) });
  try {
    for (let n = 0; n < 5000; n++) if (!g.step()) break;
  } catch (e) {
    return done((e as Error).message.slice(0, 100));
  }
  return done();
}

// ------------------------------------------------------------------------------------------------ one decision
let rot = 0;
interface Dec {
  src: string;
  kind: 'self' | 'humanRunner' | 'humanCorp';
  who: 'ai' | 'person';
  i: number;
  s: GameState;
  cls: Cls;
  snaps?: { corp?: Snap; runner?: Snap };
  played?: GameAction | null;
  run?: number;
}
function decide(d: Dec, perSrc: Record<string, number>) {
  const t = trees.beta;
  const order = [...ASKED.slice(rot % ASKED.length), ...ASKED.slice(0, rot % ASKED.length)];
  rot++;
  const asks: Record<string, Ask> = {};
  for (const arm of order) asks[arm] = ask(trees[arm], d.s, d.snaps);
  const b = asks.beta;
  const changed = ASKED_ARMS.filter(a => asks[a].k !== b.k);
  const row: Record<string, unknown> = {
    kind: 'd',
    src: d.src,
    sk: d.kind,
    who: d.who,
    i: d.i,
    T: d.s.turnNumber,
    c: d.cls,
    cr: d.s.corp.credits,
    cl: d.s.corp.clicks,
    ms: ASKED.map(a => r2(asks[a].ms)),
  };
  const fires = ASKED.map(a => asks[a].fire);
  if (fires.some(f => Object.keys(f).length)) row.fire = fires;
  if (asks.control.k !== b.k) row.controlDiffers = true;
  if (d.played !== undefined) row.fresh = key(d.played) === b.k;
  for (const a of ASKED) if (asks[a].err) (row.errors ??= {} as any)[a] = asks[a].err;
  row.beta = label(t, d.s, b.a);
  if (d.cls === 'corpRez') {
    row.run = d.run ?? null;
    row.dec = b.dec;
    const m = ask(t, d.s, d.snaps, true);
    if (m.k !== b.k) row.measureDiffers = true;
    row.m = m.m;
    // C: the real credits both worlds, and spendsKept with them (spentApart)
    for (const ice of (m.m?.ice ?? []) as any[]) {
      if (!['R3t', 'R4t', 'free'].includes(ice.at)) continue;
      const rr = realCredits(d.s, d.snaps, ice.id, 'rez');
      const rp = realCredits(d.s, d.snaps, ice.id, 'pass');
      ice.realRez = rr.real;
      ice.realPass = rp.real;
      ice.gainedRez = rr.gained;
      ice.gainedPass = rp.gained;
      if (rr.err || rp.err) ice.realErr = [rr.err ?? null, rp.err ?? null];
      if (m.view) {
        const real: { rez?: number; pass?: number } = {};
        if (typeof rr.real === 'number') real.rez = rr.real;
        if (typeof rp.real === 'number') real.pass = rp.real;
        try {
          ice.spendsReal = t.inCorp(m.view, () => t.rez.__rzSpent(m.view, ice.id, real));
        } catch (e) {
          ice.spendsRealErr = (e as Error).message.slice(0, 100);
        }
      }
      // spentApart: countedRez's answer moves only at R3t/R4t, where spendsKept decides
      if ((ice.at === 'R3t' || ice.at === 'R4t') && ice.spendsReal !== undefined && ice.spendsReal !== ice.spends) {
        const rezA: GameAction = { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.id } as GameAction;
        const passA: GameAction = { type: 'PASS', player: 'corp' } as GameAction;
        const alt = ice.spendsReal ? passA : rezA;
        if (b.a && key(alt) !== b.k) (row.changed ??= {} as any).spentApart = label(t, d.s, alt);
        (row as any).__alt = alt;
      }
    }
  } else {
    // B: the board's numbers on the deciding Corp's view
    try {
      const v = t.view(structuredClone(d.s));
      row.bb = t.inCorp(v, () => t.rez.__rzBoard(v));
    } catch (e) {
      row.bbErr = (e as Error).message.slice(0, 100);
    }
  }
  if (changed.length) {
    row.changed = { ...((row.changed as any) ?? {}), ...Object.fromEntries(changed.map(a => [a, label(t, d.s, asks[a].a)])) };
    row.armDec = Object.fromEntries(changed.map(a => [a, asks[a].dec]));
    if (changed.includes('rdStakeUnseen') && d.cls !== 'corpRez') {
      try {
        const tr = trees.rdStakeUnseen;
        const v = tr.view(structuredClone(d.s));
        row.bbArm = tr.inCorp(v, () => tr.rez.__rzBoard(v));
      } catch (e) {
        row.bbArmErr = (e as Error).message.slice(0, 100);
      }
    }
  }
  const alt = (row as any).__alt as GameAction | undefined;
  delete (row as any).__alt;
  out(row);
  // Continuations of the changed decisions (one per distinct action: arms that agree share it)
  const conts = new Map<string, Cont>();
  const contOf = (a: GameAction) => conts.get(key(a)) ?? conts.set(key(a), cont(d.s, a, d.snaps)).get(key(a))!;
  const pairs: [string, GameAction | null][] = changed.map(a => [a, asks[a].a]);
  if (alt && (row.changed as any)?.spentApart) pairs.push(['spentApart', alt]);
  for (const [arm, a] of pairs) {
    if (!a || !b.a) continue;
    const n = (perSrc[arm] = (perSrc[arm] ?? 0) + 1);
    if (n > CAP) continue;
    out({ kind: 'c', src: d.src, sk: d.kind, who: d.who, i: d.i, T: d.s.turnNumber, arm, c: d.cls, a: label(t, d.s, a), b: label(t, d.s, b.a), cs0: d.s.corp.score, rs0: d.s.runner.score, ca: contOf(a), cb: contOf(b.a) });
  }
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const used = ARMS.filter(a => a === 'source' || ASKED.includes(a) || a === 'rdStakeUnseen');
  const dirs = makeTrees(root, used);
  trees = {};
  for (const arm of used) trees[arm] = await loadTree(arm, dirs[arm]);
  if (shard === 0) out({ kind: 'meta', asked: ASKED });
  const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(
    readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'),
  );
  const want = (process.env.DEALS ?? '').split(',').filter(Boolean);
  const dealList = want.includes('none') ? [] : record.filter(r => !want.length || want.includes(String(r.seed)));
  const hdir = 'tests/fixtures/human-games';
  const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
  const humans = hwant.includes('none')
    ? []
    : readdirSync(hdir)
        .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.startsWith(w))))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));
  const sources: { kind: 'deal' | 'human'; id: any }[] = [...humans.map(f => ({ kind: 'human' as const, id: f })), ...dealList.map(r => ({ kind: 'deal' as const, id: r }))];

  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    const perSrc: Record<string, number> = {};
    let decisions = 0;
    if (src.kind === 'deal') {
      const rec = src.id as (typeof record)[number];
      const name = `deal:${rec.seed}`;
      const t = trees.source;
      t.clear();
      const ag = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
      const g = new t.GameRunner(dealState(rec.seed), ag);
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      let runTurn = -1;
      let runIdx = -1;
      const decs: Dec[] = [];
      for (let n = 0; n < 4000; n++) {
        const s: GameState = g.state;
        if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
          cr.push(s.corp.credits);
          sc.push(s.corp.score);
          lastTurn = s.turnNumber;
        }
        const dec = decisionOf(t.core, s);
        const copy = dec ? structuredClone(s) : null;
        const snaps = dec ? { corp: snapAgent(ag.corp), runner: snapAgent(ag.runner) } : undefined;
        if (!g.step()) break;
        const nx: GameState = g.state;
        // count 3's run index: runs begun on the Runner's turn (the Runner's own turn record)
        if (!s.activeRun && nx.activeRun && nx.activePlayer === 'runner') {
          if (runTurn !== nx.turnNumber) {
            runTurn = nx.turnNumber;
            runIdx = -1;
          }
          runIdx++;
        }
        if (dec && copy) decs.push({ src: name, kind: 'self', who: 'ai', i: decs.length, s: copy, cls: dec.cls, snaps, played: g.last ?? null, run: copy.activeRun && copy.activePlayer === 'runner' && runTurn === copy.turnNumber ? runIdx : undefined });
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({
        kind: 'g',
        src: name,
        decks: `${rec.corpDeck} v ${rec.runnerDeck}`,
        winner: g.state.winner ?? null,
        T: g.state.turnNumber,
        cs: g.state.corp.score,
        rs: g.state.runner.score,
        matchesBatch: matches,
        ...(matches ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }),
        decisions: decs.length,
      });
      for (const d of decs.slice(0, MAXDEC)) decide(d, perSrc);
      decisions = Math.min(decs.length, MAXDEC);
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const kind = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const name = `human:${src.id}`;
      if (!r.moves?.length) continue;
      const core = trees.beta.core;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = core.createInitialGameState(trees.beta.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      let stopped: string | null = null;
      const boards: GameState[] = [];
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        boards.push(s);
        try {
          s = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      for (const [j, b0] of boards.entries()) {
        if (decisions >= MAXDEC) break;
        const dec = decisionOf(core, { ...b0, stops: { corp: 'ai', runner: 'ai' } });
        if (!dec) continue;
        decide({ src: `${name}#${j}`, kind, who: kind === 'humanRunner' ? 'ai' : 'person', i: decisions, s: structuredClone(b0), cls: dec.cls, played: kind === 'humanRunner' ? r.moves[j] : undefined }, perSrc);
        decisions++;
      }
      out({ kind: 'h', src: name, sk: kind, moves: r.moves.length, decisions, stopped });
    }
    out({ kind: 's', src: src.kind === 'deal' ? `deal:${src.id.seed}` : `human:${src.id}`, ms: Math.round(performance.now() - t0), decisions, pairs: perSrc });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
