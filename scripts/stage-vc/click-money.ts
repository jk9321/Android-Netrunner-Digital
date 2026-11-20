/**
 * V-C checkpoint fix, Friend of a Friend's click money: the count's reading on the built tree (brief
 * /mnt/project-files/netrunner-ai/stage-vc/checkpoint/foaf-fix/brief.md rev 1, "Measurement"). Trees:
 * click-money-trees.ts (source, beta and control = the merge base's src; branch; exact, a measuring arm). The pattern of
 * scripts/stage-vc/run-term-once.ts.
 *
 * Sources (kinds kept apart: self, foafExtra, humanRunner = the person played the Runner, humanCorp):
 *  (a) the 221 deals of the g1 base 44680798149 (click-money-deals.json, that run's deals record), played by the `source`
 *      tree with a plain GameRunner, Normal v Normal, as the batch; each game's winner, cr and sc checked against the
 *      record. The source tree is never asked or cleared mid-game (found row 71b); its agents' state is copied before
 *      each step into the fresh agents that are asked. None of the batch's 13 Runner decks holds Friend of a Friend.
 *  (b) foafExtra (not in the brief; added so the class has a size): each of the two beta decks that hold Friend of a
 *      Friend (IDENTITY_TEST_DECKS lib-seb, NRDB_TEST_DECKS Kessleroid Isn't Real) against each Corp deck of the batch,
 *      one seed each (9001 + k), played the same way; no record. EXTRA=none leaves them out, EXTRA=9001,9002 picks.
 *  (c) the human files in tests/fixtures/human-games: the recorded moves replayed; at every board where either side
 *      decides, today's AI of that side is asked (fresh agents, no memory).
 *
 * Every decision (both sides) is asked of beta, control and branch in one call sequence (one-step GameRunner on a copy,
 * fresh agents with the source's agent state, hand caches cleared, tree order rotated, timed). A control answer unlike
 * beta's is a stop. Per decision: whether Friend of a Friend is installed in the Runner's rig (public), the Runner's
 * tags, and `__cmFire` on the branch (runnerEarnings read the card's entry on some board of the ask: the decision's own
 * or one in the look-ahead). Class of a branch answer unlike beta's: `board` (installed on the decision board), `look`
 * (not installed there, but the branch read it during the ask: a playout board where it is), `other` (a stop).
 * Each changed decision gets two continuations from its board (the branch's action first, beta's), both sides beta's
 * agents to the end of the game: Corp wins, Corp points, Runner points.
 *
 * Tagged boards ("Tagged boards" in the brief): at every Corp decision with Friend of a Friend installed and the Runner
 * tagged, the decision is asked of `exact` too (the card's 5 while tagged), and on the deciding Corp's view, in branch
 * and in exact: every server's hold answer ('runnerTurn'), rezMoney's keep and unholdable list, and reservedForAgenda.
 *
 * Hidden information: agents are asked only through GameRunner (their own views); the tagged measures read the
 * deciding Corp's view (corpDecisionView). The Runner's rig and tags are public.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-vc/click-money.ts
 *   ARGS="DEALS=none HUMAN=report-20 EXTRA=none" npx vite-node scripts/stage-vc/click-money.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DeckList, GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { ALL_DECKS } from '../nsg-sample-decks';
import { IDENTITY_TEST_DECKS } from '../../src/data/testDecks/identityDecks';
import { NRDB_TEST_DECKS } from '../../src/data/testDecks/nrdb';
import { TREES, Tree, loadTree, makeTrees } from './click-money-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const i = kv.indexOf('=');
  process.env[kv.slice(0, i)] = kv.slice(i + 1);
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/click-money', String(shard));
const ASKED = ['beta', 'control', 'branch'] as const;
const FOAF = '34074';
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
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && !(cur instanceof Map) && !(cur instanceof Set) && Object.getPrototypeOf(cur) !== Object.prototype) Object.assign(cur, structuredClone(v));
    else fresh[k] = structuredClone(v);
  }
  return fresh;
}
function agents(t: Tree, snaps?: { corp?: Snap; runner?: Snap }) {
  return { corp: restore(t.createAgent('corp', 'normal'), snaps?.corp), runner: restore(t.createAgent('runner', 'normal'), snaps?.runner) };
}

// ------------------------------------------------------------------------------------------------ decisions
type Cls = 'corpPrompt' | 'corpMain' | 'corpRez' | 'runnerPrompt' | 'runnerMain' | 'runnerOff';
function decisionOf(core: any, s: GameState): { side: 'corp' | 'runner'; cls: Cls } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const ask = core.wantsStop(s, side, w);
    if (ask && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, cls: 'corpRez' };
    if (ask && side === 'runner' && w.step === 'corp_action') return { side, cls: 'runnerOff' };
    return null;
  }
  return { side, cls: core.activePrompt(s) ? (`${side}Prompt` as Cls) : (`${side}Main` as Cls) };
}

interface Ask {
  a: GameAction | null;
  k: string;
  ms: number;
  fire: number;
  err?: string;
}
function ask(t: Tree, s: GameState, snaps: { corp?: Snap; runner?: Snap } | undefined): Ask {
  t.clear();
  const ag = agents(t, snaps);
  const g = new t.GameRunner(structuredClone(s), ag);
  G.__cmFire = 0;
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    const a = g.last as GameAction | null;
    return { a, k: key(a), ms, fire: G.__cmFire };
  } catch (e) {
    return { a: null, k: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at, fire: G.__cmFire, err: (e as Error).message.slice(0, 160) };
  } finally {
    G.__cmFire = 0;
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
  if (!id) return a.type + (x.server ? `>${x.server}` : x.targetServerId ? `>${x.targetServerId}` : '');
  return `${a.type} ${title(t, s, id)}${x.targetServerId ? `>${x.targetServerId}` : ''}${x.asNewRemote ? '>new' : ''}`;
}
const rig = (s: GameState) => [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
const foafIn = (s: GameState) => rig(s).filter(c => c.cardCode === FOAF).length;

/** The tagged measures on the deciding Corp's view, in one tree: every server's hold, the money kept, the reservation. */
function measures(t: Tree, s: GameState) {
  try {
    t.clear();
    const v = t.view(structuredClone(s));
    return t.inCorp(v, () => {
      const holds: Record<string, boolean> = {};
      for (const id of Object.keys(v.corp.servers)) holds[id] = !!t.hold.serverHold(v, id, { when: 'runnerTurn', corpCredits: v.corp.credits }).holds;
      const rm = t.rezMoney.rezMoney(v);
      const res = t.placement.reservedForAgenda(v);
      return { holds, keep: rm.keep, byServer: rm.byServer, unholdable: rm.unholdable, reserved: res?.id ?? null, earn: t.hold.runnerEarnings(v) };
    });
  } catch (e) {
    return { err: (e as Error).message.slice(0, 120) };
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
  try {
    for (let n = 0; n < 5000; n++) if (!g.step()) break;
  } catch (e) {
    return { winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, err: (e as Error).message.slice(0, 100) };
  }
  return { winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score };
}

// ------------------------------------------------------------------------------------------------ one decision
let rot = 0;
interface Dec {
  src: string;
  kind: 'self' | 'foafExtra' | 'humanRunner' | 'humanCorp';
  who: 'ai' | 'person';
  i: number;
  s: GameState;
  side: 'corp' | 'runner';
  cls: Cls;
  snaps?: { corp?: Snap; runner?: Snap };
}
function decide(d: Dec) {
  const t = trees.beta;
  const order = [...ASKED.slice(rot % ASKED.length), ...ASKED.slice(0, rot % ASKED.length)];
  rot++;
  const asks: Record<string, Ask> = {};
  for (const tree of order) asks[tree] = ask(trees[tree], d.s, d.snaps);
  const b = asks.beta;
  const foaf = foafIn(d.s);
  const row: Record<string, unknown> = { kind: 'd', src: d.src, sk: d.kind, who: d.who, i: d.i, T: d.s.turnNumber, side: d.side, c: d.cls, foaf, tags: d.s.runner.tags, ms: ASKED.map(x => r2(asks[x].ms)), fire: asks.branch.fire };
  if (asks.control.k !== b.k) row.controlDiffers = label(t, d.s, asks.control.a);
  for (const x of ASKED) if (asks[x].err) (row.errors ??= {} as any)[x] = asks[x].err;
  const changed = asks.branch.k !== b.k;
  if (changed) {
    row.class = foaf ? 'board' : asks.branch.fire > 0 ? 'look' : 'other';
    row.beta = label(t, d.s, b.a);
    row.branch = label(t, d.s, asks.branch.a);
  }
  // Tagged boards: the exact arm's pick and the measures both ways
  if (d.side === 'corp' && foaf && d.s.runner.tags > 0) {
    const e = ask(trees.exact, d.s, d.snaps);
    row.tagged = {
      exact: label(t, d.s, e.a),
      exactDiffers: e.k !== asks.branch.k,
      branch: measures(trees.branch, d.s),
      exactM: measures(trees.exact, d.s),
    };
  }
  out(row);
  if (changed && asks.branch.a && b.a) {
    const ca = cont(d.s, asks.branch.a, d.snaps);
    const cb = cont(d.s, b.a, d.snaps);
    out({ kind: 'c', src: d.src, sk: d.kind, who: d.who, i: d.i, T: d.s.turnNumber, side: d.side, c: d.cls, class: row.class, a: row.branch, b: row.beta, cs0: d.s.corp.score, rs0: d.s.runner.score, ca, cb });
  }
}

/** Plays one game with the source tree (a plain GameRunner, Normal v Normal) and asks every decision. */
function playSource(name: string, kind: 'self' | 'foafExtra', start: GameState) {
  const t = trees.source;
  t.clear();
  const ag = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
  const g = new t.GameRunner(start, ag);
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  const decs: Dec[] = [];
  let installedFoaf = 0;
  for (let n = 0; n < 4000; n++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    if (foafIn(s)) installedFoaf++;
    const dec = decisionOf(t.core, s);
    const copy = dec ? structuredClone(s) : null;
    const snaps = dec ? { corp: snapAgent(ag.corp), runner: snapAgent(ag.runner) } : undefined;
    if (!g.step()) break;
    if (dec && copy) decs.push({ src: name, kind, who: 'ai', i: decs.length, s: copy, side: dec.side, cls: dec.cls, snaps });
  }
  return { g, cr, sc, decs, installedFoaf };
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees(root, TREES);
  trees = {};
  for (const tree of TREES) trees[tree] = await loadTree(tree, dirs[tree]);
  const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-vc/click-money-deals.json', 'utf8'));
  const want = (process.env.DEALS ?? '').split(',').filter(Boolean);
  const dealList = want.includes('none') ? [] : record.filter(r => !want.length || want.includes(String(r.seed)));
  const hdir = 'tests/fixtures/human-games';
  const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
  const humans = hwant.includes('none')
    ? []
    : readdirSync(hdir)
        .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.startsWith(w))))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));
  const foafDecks: DeckList[] = [...IDENTITY_TEST_DECKS, ...NRDB_TEST_DECKS].filter(d => d.side === 'runner' && Object.keys(d.cards).includes('Friend of a Friend'));
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const ewant = (process.env.EXTRA ?? '').split(',').filter(Boolean);
  const extras = ewant.includes('none') ? [] : foafDecks.flatMap((r, i) => corpDecks.map((c, j) => ({ seed: 9001 + i * corpDecks.length + j, corp: c, runner: r }))).filter(x => !ewant.length || ewant.includes(String(x.seed)));
  const sources: { kind: 'deal' | 'human' | 'extra'; id: any }[] = [
    ...humans.map(f => ({ kind: 'human' as const, id: f })),
    ...extras.map(x => ({ kind: 'extra' as const, id: x })),
    ...dealList.map(r => ({ kind: 'deal' as const, id: r })),
  ];
  if (shard === 0) out({ kind: 'meta', asked: ASKED, base: process.env.BASE ?? null, foafDecks: foafDecks.map(d => d.name), corpDecks: corpDecks.length, sources: sources.length });

  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    let decisions = 0;
    let name: string;
    if (src.kind === 'deal' || src.kind === 'extra') {
      const isDeal = src.kind === 'deal';
      const rec = src.id;
      name = isDeal ? `deal:${rec.seed}` : `extra:${rec.seed}`;
      const start = isDeal ? dealState(rec.seed) : trees.source.core.createInitialGameState(trees.source.decks.deckGameSetup(rec.seed, rec.corp, rec.runner));
      const { g, cr, sc, decs, installedFoaf } = playSource(name, isDeal ? 'self' : 'foafExtra', start);
      const matches = isDeal ? (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc) : null;
      out({ kind: 'g', src: name, sk: isDeal ? 'self' : 'foafExtra', decks: isDeal ? `${rec.corpDeck} v ${rec.runnerDeck}` : `${rec.corp.name} v ${rec.runner.name}`, winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, matchesRecord: matches, cr, sc, decisions: decs.length, installedFoaf });
      for (const d of decs) decide(d);
      decisions = decs.length;
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const kind = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const aiSide = r.config.ai === 'corp' ? 'corp' : 'runner';
      name = `human:${src.id}`;
      if (!r.moves?.length) continue;
      const core = trees.beta.core;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = core.createInitialGameState(trees.beta.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      let stopped: string | null = null;
      let installedFoaf = 0;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        if (foafIn(s)) installedFoaf++;
        const dec = decisionOf(core, { ...s, stops: { corp: 'ai', runner: 'ai' } });
        if (dec) {
          decide({ src: `${name}#${j}`, kind, who: dec.side === aiSide ? 'ai' : 'person', i: decisions, s: structuredClone(s), side: dec.side, cls: dec.cls });
          decisions++;
        }
        try {
          s = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      out({ kind: 'h', src: name, sk: kind, moves: r.moves.length, decisions, stopped, installedFoaf, foafDeck: JSON.stringify(r.config.runnerDeck ?? '').includes('Friend of a Friend') });
    }
    out({ kind: 's', src: name, ms: Math.round(performance.now() - t0), decisions });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
