/**
 * F119 phase A (brief /mnt/project-files/netrunner-ai/f119-punisher-field/brief.md rev 1, final with ruling-redteam.md
 * "Rev 1, ruled"). Counts only: no src change. Started from scripts/tag-clock-input/count.ts (copied, not edited).
 * Trees (trees.ts): every one from the merge base's src by `git archive` (ARM_BASE, default beta fd22bef), dirs through
 * resolve(). RULE-SCRIPT-RULES: the tree that plays the source game is never asked or cleared.
 *   S  plays the source games: the merge base's src as it is (ARM=base) or the arm's tree switched on (step 11).
 *   B  prices: the merge base's src with the arm patches, switched per read (unset = the merge base); the record set
 *      (record-set.ts) is priced here with every switch off.
 *   L  (MODE=record) plays the legs: the merge base (B's patches, off) and the legs' REMOVE_TAG bar.
 *
 * MODE=probe (steps 2, 4, 5 a and c, 6 on every probe board, 7; POOL=people: step 10). Plays every deal of both g1 pools on S.
 *   u  the first Runner main decision of a Runner turn, every tagged one and one untagged in four with a resource: per arm
 *      (base, U, U+G) the per-turn input in both views split (trash part, use part or base's punisher term), the clock, the
 *      Corp-view price of the next tag and the Runner's tagCost (5 a, 5 c); U+G's use candidates in both views (step 2:
 *      what is usable; step 4: the damage read and the Orbital gate against the Runner view's odds); step 4's V18 term
 *      with and without the two cards' tag-gated damage; step 6's identities at tags 0 to 5 and Infinity; step 7's hand
 *      plan terms beside the clock's use term (Runner's turn).
 *   c  the first Corp main decision of a Corp turn with the Runner tagged: the filled cards usable (the gate by `from`),
 *      IP Enforcement's split, the hand plan terms against the clock's use term (step 7, Corp's turn), Greasing's HQ.
 *   g  one per game: tags given by source, clears, trash chances and trashes, the uses (record-set.ts) with their turn,
 *      Orbital scores, whether the game is the batch's (winner, cr, sc).
 * MODE=record (step 3): a unit is the first Runner main decision of a Runner turn with the Runner tagged. SEEDS legs from it
 *   (seed 0 the game's rng; k >= 1 R&D and the stack reshuffled), REMOVE_TAG barred, played on L (the merge base) to the
 *   end of the next Corp turn; the uses in the leg by record-set.ts. Beside the unit: the per-turn input and the clock under
 *   each arm, both views.
 * MODE=time (step 8, once on U+G): S plays each deal; at every decision base, ctl (the merge base again: the time control)
 *   and the patched tree under off and U+G decide on a clone. Time per caller kind, the answers that move against base,
 *   per ask: clock prices, the use part's work-outs (memo misses) by n, damageWorth and agendaWorth calls in the use part,
 *   and the hand plan's time (tagUseHandWorth) as its own kind.
 *   ARGS="MODE=probe" | ARGS="MODE=record SEEDS=2" | ARGS="MODE=time" | ARGS="MODE=probe POOL=people"
 *   (ai-script: SHARD=<k>/64; local: SHARD=0/4 npx vite-node scripts/f119-punisher-field/count.ts -- MODE=probe)
 * HIDDEN-READ (the measuring script, never an agent): reads price the real board; seed k >= 1 reshuffles.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Patch, makeTree } from '../corp-owed/trees';
import { BAR } from '../tag-clock-input/trees';
import { ARMS, Arm, MERGE_BASE, armPatches, setArm, treeRoot } from './trees';
import { UseRecorder } from './record-set';
import { CARD_LIST, FILLED, GAIN_CODES } from './card-list';
import { COUNT } from './count-patches';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const MODE = process.env.MODE ?? 'probe';
const ARM = (process.env.ARM ?? 'base') as Arm;
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const PER_POOL = Number(process.env.PER_POOL ?? 0);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const SEEDS = Number(process.env.SEEDS ?? 2);
const root = treeRoot(shard);
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: any): any => (typeof x === 'number' ? (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf') : x);
const G = globalThis as any;

// ------------------------------------------------------------------------------------------------ trees
interface T {
  name: string;
  ai: any;
  po: any;
  core: any;
  decks: any;
  ev: any;
  hv: any;
  vm: any;
  fx: any;
  pricing: any;
  plans: any;
  fr: any;
  cards: any;
  runs: any;
  clear: () => void;
}
const MODULES: [string, string][] = [
  ['ai', './ai/index'],
  ['po', './ai/playout'],
  ['core', './core/index'],
  ['decks', './data/decks'],
  ['ev', './ai/evaluate'],
  ['hv', './ai/handValues'],
  ['vm', './ai/valueModel'],
  ['fx', './ai/effectValues'],
  ['iv', './ai/iceValues'],
  ['tm', './ai/threatModel'],
  ['pricing', './ai/pricing'],
  ['plans', './ai/cardPlans'],
  ['fr', './ai/freeRez'],
  ['cards', './ai/cards/index'],
  ['runs', './ai/runs'],
];
async function load(name: string, dir: string): Promise<T> {
  const entry = join(dir, 'src', '__f119.ts');
  writeFileSync(entry, MODULES.map(([n, p]) => `export * as ${n} from '${p}';`).join('\n') + '\n');
  const m: any = await import(/* @vite-ignore */ entry);
  const { fx, iv, tm, hv, vm } = m;
  return {
    name,
    ...m,
    clear: () => {
      hv.clearHandCaches?.();
      fx.clearDamageThreats?.();
      tm.clearThreatCaches?.();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
const tree = (name: string, patches: Patch[] = []) => load(name, makeTree(join(root, name), { ref: MERGE_BASE, patches }));

let S: T; // plays
let B: T; // prices
let L: T; // legs
const off = () => setArm('B', 'base');

// ------------------------------------------------------------------------------------------------ reads on B
function inCtx<X>(s: GameState, side: 'corp' | 'runner', arm: Arm, f: (st: GameState) => X, extra: Record<string, unknown> = {}): X {
  setArm('B', arm, extra);
  B.clear();
  const st = structuredClone(s);
  try {
    return B.pricing.asSide(side, () => B.hv.inDecision(st, side, () => f(st)));
  } finally {
    off();
  }
}
/** The per-turn input split, under `arm`, as `viewer`, with n tags priced (skip 0: a Runner-turn board). */
function parts(st: GameState, viewer: 'corp' | 'runner', arm: Arm, n: number, skip = 0) {
  const cap: any = {};
  setArm('B', arm, { dbg: (x: any) => (x.part === 'punish' ? Object.assign(cap, { punish: r3(x.punish), held: r3(x.held), id: x.id }) : x.part === 'trash' ? Object.assign(cap, { cost: r3(x.cost) }) : null) });
  const loss = B.ev.tagLossPerTurn(st, viewer, skip) as number; // base: trash + punisher + identity; U, U+G: the trash part
  const use = arm === 'base' ? 0 : (B.ev.tagUsePerTurn(st, viewer, n) as number);
  setArm('B', arm);
  const punish = arm === 'base' ? (cap.punish ?? 0) + (cap.id ?? 0) : 0;
  return { perTurn: r3(loss + use), trash: r3(loss - punish), use: r3(arm === 'base' ? punish : use), held: cap.held ?? null };
}
const cands = (st: GameState, viewer: 'corp' | 'runner', n: number) =>
  (B.ev.tagUseCandidates(st, viewer, n) as any[]).map(c => ({ code: c.code, swing: r3(c.swing), p: r3(c.p), w: r3(c.worth), cost: r3(c.cost), wo: r3(c.without) }));
const title = (code: string) => {
  try {
    return S.core.getCardDefinition(code).title as string;
  } catch {
    return code;
  }
};
const withTags = (s: GameState, n: number): GameState => ({ ...s, runner: { ...s.runner, tags: n } });
const corpMain = (s: GameState) => !s.winner && s.activePlayer === 'corp' && S.core.actingSide(s) === 'corp' && !s.pendingPrompts.length && !s.activeRun && !(s.priority && s.priority.holder !== s.activePlayer);
const runnerMain = (s: GameState) => !s.winner && s.activePlayer === 'runner' && S.core.actingSide(s) === 'runner' && !s.pendingPrompts.length && !s.activeRun && !(s.priority && s.priority.holder !== s.activePlayer);
/** A trash chance (the tag clock's): tagged, a click, 2 credits, a resource, a legal trash. */
const chance = (s: GameState) => corpMain(s) && s.runner.tags > 0 && s.corp.clicks >= 1 && s.corp.credits >= 2 && s.runner.rig.resources.length > 0 && S.core.getLegalActions(s, 'corp').some((a: any) => a.type === 'TRASH_RESOURCE');
const fieldOf = (code: string) => B.cards.CARDS[code]?.tagUse;

/** Step 2: the filled cards the Corp can use now (its view), by the gate of `from` (n = the board's tags). */
function usable(s: GameState): string[] {
  const n = s.runner.tags;
  const ok = (code: string, from: string) => {
    const u = fieldOf(code);
    if (!u || u.from !== from || n < u.needs) return false;
    if (from === 'onScore') return true;
    if (s.activePlayer === 'corp' && s.corp.clicks < 1) return false;
    return from !== 'hq' || s.corp.credits >= (S.core.getCardDefinition(code).cost ?? 0);
  };
  const got = new Set<string>();
  for (const c of s.corp.hq) if (ok(c.cardCode, 'hq')) got.add(c.cardCode);
  if (ok(s.corp.identity.cardCode, 'identity')) got.add(s.corp.identity.cardCode);
  for (const c of s.runner.scoreArea) if (ok(c.cardCode, 'runnerScoreArea')) got.add(c.cardCode);
  // an installed Orbital passing the gate: the reader's own candidates say so (U+G, the Corp's view)
  for (const sv of Object.values(s.corp.servers)) for (const c of sv.root) if (fieldOf(c.cardCode)?.from === 'onScore' && n >= 1) got.add(`${c.cardCode}?`);
  return [...got];
}
/** IP Enforcement's split: an agenda in the Runner's score area it could take at the tags held. */
const ipCan = (s: GameState) => s.runner.scoreArea.some(a => {
  const p = S.core.getCardDefinition(a.cardCode).agenda_points ?? 0;
  return p >= 1 && p <= s.runner.tags;
});
const fakeCard = (code: string): CardInstance => ({ instanceId: `f119-${code}`, cardCode: code }) as any;

/** Step 7: the hand plan's term (handPlanWorth, base and H) beside the clock's use term for the card (U, the Corp's view). */
function handVsClock(s: GameState) {
  const o: any = {};
  for (const c of new Set(s.corp.hq.map(x => x.cardCode))) {
    if (!['30065', '35065', '35066'].includes(c)) continue;
    const card = s.corp.hq.find(x => x.cardCode === c)!;
    const n = Math.max(1, s.runner.tags);
    o[title(c)] = {
      plan: r3(inCtx(s, 'corp', 'base', st => B.plans.handPlanWorth(st, st.corp.hq.find((x: CardInstance) => x.instanceId === card.instanceId)) ?? null)),
      planH: r3(inCtx(s, 'corp', 'U', st => B.plans.handPlanWorth(st, st.corp.hq.find((x: CardInstance) => x.instanceId === card.instanceId)) ?? null)),
      clock: r3(inCtx(s, 'corp', 'U', st => cands(st, 'corp', n).find(x => x.code === c)?.swing ?? 0)),
    };
  }
  return o;
}

/** Step 6's identities on a board: at tags 0..5 and Infinity, the field's readers (H) against the merge base's lines. */
function identities(s: GameState) {
  const o: any = { dmg: 0, free: 0, ret: 0, inf: 0, bp: [] as any[] };
  for (const t of [0, 1, 2, 3, 4, 5, Infinity]) {
    const st0 = withTags(s, t);
    for (const code of ['34045', '30068']) {
      const a = inCtx(st0, 'corp', 'base', st => B.cards.CARDS[code].corpTurnDamage(st));
      const b = inCtx(st0, 'corp', 'H', st => B.cards.CARDS[code].corpTurnDamage(st));
      if (a !== b) o.dmg++;
    }
    if (Number.isFinite(t)) {
      if (inCtx(st0, 'corp', 'base', st => B.fr.pendingFreeRezzes(st)) !== inCtx(st0, 'corp', 'H', st => B.fr.pendingFreeRezzes(st))) o.free++;
      const ret = (arm: Arm) => inCtx(st0, 'corp', arm, st => B.plans.CARD_PLANS['30065'].hand.payoff(st, fakeCard('30065')));
      if (Math.abs(ret('base') - ret('H')) > 1e-9) o.ret++;
      if (t >= 1 && t <= 3) {
        const bp = (arm: Arm) => r3(inCtx(st0, 'corp', arm, st => B.plans.CARD_PLANS['35065'].hand.payoff(st, fakeCard('35065'))));
        o.bp.push([t, s.runner.credits, bp('base'), bp('H')]);
      }
    }
    // every does and spends finite at Infinity (finding 14), all ten cards
    if (!Number.isFinite(t))
      for (const code of FILLED) {
        const u = fieldOf(code);
        const e = u.does(st0, t);
        if (!Number.isFinite(u.spends(st0, t)) || Object.values(e).some((v: any) => (typeof v === 'number' ? !Number.isFinite(v) : Object.values(v).some((x: any) => !Number.isFinite(x))))) o.inf++;
      }
  }
  // freeRez on the board's own tags with an Unleash in HQ swapped in (the reader's only case)
  if (s.corp.hq.length) {
    const sw = structuredClone(s);
    sw.corp.hq[0] = { ...sw.corp.hq[0], cardCode: '36044' };
    for (const t of [0, 1, 2]) if (inCtx(withTags(sw, t), 'corp', 'base', st => B.fr.pendingFreeRezzes(st)) !== inCtx(withTags(sw, t), 'corp', 'H', st => B.fr.pendingFreeRezzes(st))) o.free++;
  }
  return o;
}

function readU(s: GameState, deck: DeckInfo) {
  const row: any = {
    cc: s.corp.credits,
    rc: s.runner.credits,
    rk: s.runner.clicks,
    tags: s.runner.tags,
    grip: s.runner.grip.length,
    nres: s.runner.rig.resources.length,
    hq: s.corp.hq.length,
    usable: s.runner.tags > 0 ? usable(s) : [],
    orbitalInstalled: Object.values(s.corp.servers).reduce((n, sv) => n + sv.root.filter(c => c.cardCode === '30068').length, 0),
  };
  const n = Math.max(1, s.runner.tags);
  const t1 = withTags(s, n);
  for (const arm of ARMS) {
    row[arm] = {
      c: inCtx(t1, 'corp', arm, st => ({ ...parts(st, 'corp', arm, n), clock: r3(B.ev.tagsWorth(st, 'corp')) })),
      r: inCtx(t1, 'runner', arm, st => ({ ...parts(st, 'runner', arm, n), clock: r3(B.ev.tagsWorth(st, 'runner')) })),
      nextC: r3(inCtx(s, 'corp', arm, st => (B.ev.tagsWorth(st, 'corp', st.runner.tags + 1) as number) - (B.ev.tagsWorth(st, 'corp', st.runner.tags) as number))),
      nextR: r3(inCtx(s, 'runner', arm, st => B.runs.tagCost(st))),
    };
  }
  row.candC = inCtx(t1, 'corp', 'UG', st => cands(st, 'corp', n));
  row.candR = inCtx(t1, 'runner', 'UG', st => cands(st, 'runner', n));
  if (s.runner.tags > 0 && deck.damage) {
    // step 4: V18's term (the Runner's strength, the Corp's view) with and without the two cards' tag-gated damage
    const v18 = (no: boolean) =>
      inCtx(s, 'corp', 'base', st => {
        G.__f119NoTagDamage = no;
        try {
          B.clear();
          return B.ev.sideStrength(st, 'runner', 'corp') as number;
        } finally {
          G.__f119NoTagDamage = false;
        }
      });
    row.v18 = r3(v18(true) - v18(false));
  }
  if (s.runner.tags > 0) row.hand = handVsClock(s);
  row.id = identities(s);
  return row;
}

function readC(s: GameState) {
  const row: any = { cc: s.corp.credits, ck: s.corp.clicks, tags: s.runner.tags, hq: s.corp.hq.length, usable: usable(s), ipCan: s.corp.hq.some(c => c.cardCode === '35066') ? ipCan(s) : null };
  row.cand = inCtx(s, 'corp', 'UG', st => cands(st, 'corp', st.runner.tags));
  row.hand = handVsClock(s);
  return row;
}

// ------------------------------------------------------------------------------------------------ deals
type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL: any[] = [...ALL_DECKS, ...NRDB_TEST_DECKS];
/** The g1 deal sets: batch from the tag clock merge's g1 (46008214593, beta bb3a078); NRDB from its g1 base on the same src (46012461062, beta 8080c0d). */
const RUNS: Record<string, string> = { batch: '46008214593', nrdb: '46012461062', g3: '45717969976' };
interface DeckInfo {
  filled: string[];
  gain: boolean;
  damage: boolean;
}
const TITLE_CODE = new Map(Object.entries(CARD_LIST).map(([k, v]) => [v.title, k]));
function deckInfo(name: string): DeckInfo {
  const d = DECK_POOL.find(x => x.side === 'corp' && x.name === name);
  const titles = [...Object.keys(d?.cards ?? {}), d?.identity ?? ''];
  const filled = titles.map(t => TITLE_CODE.get(t)).filter((c): c is string => !!c && CARD_LIST[c].kind === 'filled');
  return { filled, gain: filled.some(c => GAIN_CODES.includes(c)), damage: filled.includes('34045') || filled.includes('30068') };
}
function dealState(t: T, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(rec.seed, c, r));
}
const key = (a: unknown) => JSON.stringify(a ?? null);
const act = (s: GameState, a: any) => (a ? `${a.type}${a.cardInstanceId ? ':' + title(S.core.findCardAnywhere(s, a.cardInstanceId)?.cardCode ?? '?') : ''}` : 'none');
function tagSource(s: GameState, a: any): string {
  if (a?.player === 'corp' && a.cardInstanceId) return `corp:${title(S.core.findCardAnywhere(s, a.cardInstanceId)?.cardCode ?? '?')}`;
  const run = s.activeRun;
  if (run) {
    const ice = run.icePosition !== null ? s.corp.servers[run.server]?.ice[run.icePosition] : undefined;
    return ice ? `ice:${title(ice.cardCode)}` : `run:${run.server}:${a?.type ?? '?'}`;
  }
  return `${a?.player ?? '?'}:${act(s, a)}`;
}

function probeDeal(pool: string, rec: Rec) {
  const t0 = Date.now();
  S.clear();
  const s0 = dealState(S, rec);
  const deck = deckInfo(rec.corpDeck);
  const g = new S.po.GameRunner(s0, { corp: S.ai.createAgent('corp', 'normal'), runner: S.ai.createAgent('runner', 'normal') });
  const recd = new UseRecorder(B as any, off, S as any);
  const st = { chances: 0, trashes: 0, tagsGiven: 0, clears: 0, corpTurns: 0, taggedCorpTurns: 0, taggedRunnerStarts: 0, bySource: {} as Record<string, number>, orbitalScores: [] as any[] };
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let lastU = -1;
  let lastC = -1;
  let chanceTurn = -1;
  for (let n = 0; n < 8000 && !g.state.winner; n++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
      st.corpTurns++;
      if (s.runner.tags > 0) st.taggedCorpTurns++;
    }
    let row: any = null;
    let kind = '';
    try {
      if (chance(s) && s.turnNumber !== chanceTurn) {
        chanceTurn = s.turnNumber;
        st.chances++;
      }
      if (corpMain(s) && s.turnNumber !== lastC && s.runner.tags > 0 && ARM === 'base') {
        lastC = s.turnNumber;
        row = readC(s);
        kind = 'c';
      } else if (runnerMain(s) && s.turnNumber !== lastU && ARM === 'base') {
        lastU = s.turnNumber;
        if (s.runner.tags > 0) st.taggedRunnerStarts++;
        if (s.runner.tags > 0 || (s.runner.rig.resources.length > 0 && (s.turnNumber + rec.seed) % 4 === 0)) {
          row = readU(s, deck);
          kind = 'u';
        }
      }
    } catch (e) {
      row = { error: String((e as Error).stack).slice(0, 400) };
      kind = kind || 'e';
    }
    if (!g.step()) break;
    const a: any = g.last;
    recd.step(s, a, g.state);
    const dt = g.state.runner.tags - s.runner.tags;
    if (dt > 0) {
      st.tagsGiven += dt;
      const k = tagSource(s, a);
      st.bySource[k] = (st.bySource[k] ?? 0) + dt;
    }
    if (a?.type === 'REMOVE_TAG') st.clears++;
    if (a?.type === 'TRASH_RESOURCE') st.trashes++;
    const newly = g.state.corp.scoreArea.filter((c: CardInstance) => c.cardCode === '30068' && !s.corp.scoreArea.some(b => b.instanceId === c.instanceId));
    if (newly.length) st.orbitalScores.push({ T: s.turnNumber, tags: s.runner.tags });
    if (row) out({ kind, pool, seed: rec.seed, corpDeck: rec.corpDeck, runnerDeck: rec.runnerDeck, T: s.turnNumber, ...row, did: kind === 'c' ? act(s, a) : undefined });
    if (Date.now() - t0 > 900_000) break;
  }
  recd.flush(g.state);
  const matches = ARM === 'base' ? (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc) : null;
  out({ kind: 'g', pool, seed: rec.seed, corpDeck: rec.corpDeck, runnerDeck: rec.runnerDeck, arm: ARM, deck, ...st, tagsEnd: g.state.runner.tags, uses: recd.uses, winner: g.state.winner ?? null, T: g.state.turnNumber, matchesBatch: matches, ms: Date.now() - t0 });
}

// ------------------------------------------------------------------------------------------------ MODE=record
const classInstance = (v: any) => v && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype;
function fieldsOf(agent: any): any {
  const o: any = {};
  for (const k of Object.keys(agent ?? {})) {
    const v = agent[k];
    if (typeof v === 'function') continue;
    o[k] = classInstance(v) ? { ...v } : v;
  }
  return structuredClone(o);
}
function copySnap(from: any, to: any) {
  for (const k of Object.keys(from ?? {})) {
    const v = structuredClone(from[k]);
    if (classInstance(to[k]) && v && typeof v === 'object') Object.assign(to[k], v);
    else to[k] = v;
  }
}
const seedFor = (k: number, s: number) => Math.imul(s ^ (k * 0x9e3779b1), 2654435761) >>> 0 || 1;
function reseed(s0: GameState, k: number): GameState {
  const s = structuredClone(s0);
  if (k > 0) {
    // HIDDEN-READ (the measuring script): seed k reshuffles R&D and the stack and reseeds the game's rng
    s.id = `${s.id}~${k}`;
    s.rng = L.core.createRng(seedFor(k, s.rng.seed));
    L.core.shuffleInPlace(s.rng, s.corp.rd);
    L.core.shuffleInPlace(s.rng, s.runner.stack);
  }
  return s;
}
/** One leg: REMOVE_TAG barred, to the end of the next Corp turn, played by the merge base; the uses by record-set.ts. */
function leg(s0: GameState, k: number, snap: { corp: any; runner: any }) {
  const t0 = performance.now();
  const s = reseed(s0, k);
  L.clear();
  const corp: any = L.ai.createAgent('corp', 'normal');
  copySnap(snap.corp, corp);
  const runner: any = L.ai.createAgent('runner', 'normal');
  copySnap(snap.runner, runner);
  const g = new L.po.GameRunner(s, { corp, runner });
  const recd = new UseRecorder(B as any, off, S as any);
  let seenCorp = false;
  let chances = 0;
  let trashes = 0;
  let steps = 0;
  for (; steps < 6000 && !g.state.winner; steps++) {
    const before: GameState = g.state;
    if (before.activePlayer === 'corp') seenCorp = true;
    else if (seenCorp) break; // the Corp turn ended
    if (chance(before)) chances++;
    setArm('L', 'base');
    G.__owBar = true;
    let more: boolean;
    try {
      more = g.step();
    } finally {
      G.__owBar = false;
    }
    if (!more) break;
    const a: any = g.last;
    if (a?.type === 'TRASH_RESOURCE') trashes++;
    recd.step(before, a, g.state);
  }
  recd.flush(g.state);
  return { uses: recd.uses, chances, trashes, ended: !!g.state.winner, steps, ms: Math.round(performance.now() - t0) };
}
function recordDeal(pool: string, rec: Rec) {
  const t0 = Date.now();
  S.clear();
  const ag = { corp: S.ai.createAgent('corp', 'normal'), runner: S.ai.createAgent('runner', 'normal') };
  const g = new S.po.GameRunner(dealState(S, rec), ag);
  const todo: { s: GameState; snap: any }[] = [];
  let lastU = -1;
  for (let n = 0; n < 8000 && !g.state.winner; n++) {
    const s: GameState = g.state;
    if (runnerMain(s) && s.turnNumber !== lastU) {
      lastU = s.turnNumber;
      if (s.runner.tags > 0) todo.push({ s, snap: { corp: fieldsOf(ag.corp), runner: fieldsOf(ag.runner) } });
    }
    if (!g.step()) break;
  }
  for (const u of todo) {
    const s = u.s;
    const beside: any = { cc: s.corp.credits, rc: s.runner.credits, tags: s.runner.tags, nres: s.runner.rig.resources.length, hq: s.corp.hq.length, grip: s.runner.grip.length };
    try {
      for (const arm of ARMS) {
        beside[arm] = {
          c: inCtx(s, 'corp', arm, st => ({ ...parts(st, 'corp', arm, st.runner.tags), clock: r3(B.ev.tagsWorth(st, 'corp')) })),
          r: inCtx(s, 'runner', arm, st => ({ ...parts(st, 'runner', arm, st.runner.tags), clock: r3(B.ev.tagsWorth(st, 'runner')) })),
        };
      }
      beside.candC = inCtx(s, 'corp', 'UG', st => cands(st, 'corp', st.runner.tags));
    } catch (e) {
      beside.error = String((e as Error).stack).slice(0, 300);
    }
    const legs: any[] = [];
    for (let k = 0; k < SEEDS; k++) {
      try {
        legs.push({ k, ...leg(s, k, u.snap) });
      } catch (e) {
        legs.push({ k, error: String((e as Error).stack).slice(0, 400) });
      }
    }
    out({ kind: 'u', pool, seed: rec.seed, corpDeck: rec.corpDeck, runnerDeck: rec.runnerDeck, deck: deckInfo(rec.corpDeck), T: s.turnNumber, beside, legs });
  }
  out({ kind: 'g', pool, seed: rec.seed, corpDeck: rec.corpDeck, units: todo.length, winner: g.state.winner ?? null, ms: Date.now() - t0 });
}

// ------------------------------------------------------------------------------------------------ MODE=time
type Tally = Record<string, number>;
const inc = (t: Tally, k: string, n = 1) => void (t[k] = (t[k] ?? 0) + n);
type Method = 'chooseAction' | 'chooseRez' | 'chooseOffTurn';
type AskTree = 'b' | 'k' | 'X';
const ASKS: { name: string; tree: AskTree; arm?: Arm }[] = [
  { name: 'base', tree: 'b' },
  { name: 'ctl', tree: 'k' },
  { name: 'off', tree: 'X', arm: 'base' },
  { name: 'UG', tree: 'X', arm: 'UG' },
];
let TT: Partial<Record<AskTree, T>>;
function ask(t: T, side: 'corp' | 'runner', method: Method, s: GameState, from: any): string {
  t.clear();
  const agent: any = t.ai.createAgent(side, 'normal');
  copySnap(fieldsOf(from), agent);
  const st = structuredClone(s);
  const args = method === 'chooseRez' ? [st, t.po.rezCandidates(st, st.priority?.step)] : [st];
  try {
    return key(agent[method](...args));
  } catch (e) {
    return `error: ${(e as Error).message.slice(0, 100)}`;
  }
}
function timeDeal(pool: string, rec: Rec) {
  const ms: Tally = {};
  const n: Tally = {};
  const differ: Tally = {};
  const work: Tally = {};
  const first: Record<string, any> = {};
  let i = 0;
  const decide = (side: 'corp' | 'runner', method: Method, s: GameState, agent: any, own: () => unknown) => {
    const kind = method === 'chooseRez' ? 'rez' : method === 'chooseOffTurn' ? 'off' : s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    const k = `${side}:${kind}`;
    const answers: Record<string, string> = {};
    const order = ASKS.map((_, j) => ASKS[(j + i) % ASKS.length]);
    for (const a of order) {
      if (a.arm) setArm('X', a.arm);
      G.__f119Count = a.tree === 'X' ? {} : undefined;
      const t0 = performance.now();
      answers[a.name] = ask(TT[a.tree]!, side, method, s, agent);
      inc(ms, `${a.name} ${k}`, performance.now() - t0);
      if (a.tree === 'X') for (const [ck, cv] of Object.entries(G.__f119Count as Tally)) inc(work, `${ck} ${a.name} ${k}`, cv);
      G.__f119Count = undefined;
    }
    setArm('X', 'base');
    inc(n, k);
    if (s.runner.tags > 0) inc(n, `${k} tagged`);
    for (const a of ASKS.slice(1))
      if (answers[a.name] !== answers.base) {
        inc(differ, `${a.name} ${k}`);
        if (!first[a.name]) first[a.name] = { i, T: s.turnNumber, k, tags: s.runner.tags, base: answers.base.slice(0, 120), arm: answers[a.name].slice(0, 120) };
      }
    i++;
    return own();
  };
  const watched = (side: 'corp' | 'runner', agent: any) =>
    new Proxy(agent, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop !== 'chooseAction' && prop !== 'chooseRez' && prop !== 'chooseOffTurn') return v;
        return (s: GameState, ...rest: unknown[]) => decide(side, prop as Method, s, target, () => v.apply(target, [s, ...rest]));
      },
    });
  S.clear();
  const g = new S.po.GameRunner(dealState(S, rec), { corp: watched('corp', S.ai.createAgent('corp', 'normal')), runner: watched('runner', S.ai.createAgent('runner', 'normal')) });
  for (let j = 0; j < 4000; j++) if (!g.step()) break;
  const r1 = (t: Tally) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  out({ kind: 'time', pool, seed: rec.seed, corpDeck: rec.corpDeck, decisions: i, winner: g.state.winner ?? null, T: g.state.turnNumber, n, ms: r1(ms), differ, work: r1(work), first });
}

// ------------------------------------------------------------------------------------------------ POOL=people (step 10)
const PEOPLE = 'tests/fixtures/human-games';
const peopleFiles = () =>
  readdirSync(PEOPLE)
    .filter(f => f.endsWith('.json'))
    .map(f => join(PEOPLE, f))
    .filter(f => JSON.parse(readFileSync(f, 'utf8')).config?.ai === 'runner')
    .sort();
function person(file: string) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const name = file.split('/').pop()!.replace('.json', '');
  let s: GameState = S.core.createInitialGameState(S.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  if (r.startsAt === 'state') s = structuredClone(r.state);
  let replayed = 0;
  let err: string | null = null;
  let lastC = -1;
  let rows = 0;
  for (const move of r.moves as GameAction[]) {
    if (corpMain(s) && s.runner.tags > 0 && s.turnNumber !== lastC) {
      lastC = s.turnNumber;
      let row: any;
      try {
        row = readC(s);
        for (const arm of ARMS) row[arm] = inCtx(s, 'corp', arm, st => parts(st, 'corp', arm, st.runner.tags, 0));
      } catch (e) {
        row = { error: String((e as Error).stack).slice(0, 300) };
      }
      rows++;
      // what the person did this turn: the moves until the turn ends
      const turn: string[] = [];
      let t = s;
      for (const m of (r.moves as GameAction[]).slice(replayed)) {
        if (t.turnNumber !== s.turnNumber || t.winner) break;
        if ((m as any).player === 'corp' && (m as any).type !== 'RESOLVE_PROMPT') turn.push(act(t, m));
        try {
          t = S.core.executeAction(t, m);
        } catch {
          break;
        }
      }
      out({ kind: 'c', pool: 'people', src: name, corpDeck: r.config.corpDeck?.name, T: s.turnNumber, ...row, didTurn: turn });
    }
    try {
      s = S.core.executeAction(s, move);
    } catch (e) {
      err = (e as Error).message.slice(0, 120);
      break;
    }
    replayed++;
  }
  out({ kind: 'g', pool: 'people', src: name, corpDeck: r.config.corpDeck?.name, moves: r.moves.length, replayed, err, rows });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const started = Date.now();
  if (MODE === 'time') {
    S = await tree('S');
    TT = { b: await tree('b'), k: await tree('k'), X: await tree('X', [...armPatches('X'), ...COUNT]) };
    setArm('X', 'base');
  } else {
    S = await tree('S', ARM === 'base' ? [] : armPatches('S'));
    setArm('S', ARM);
    B = await tree('B', [...armPatches('B'), ...COUNT]);
    off();
    if (MODE === 'record') L = await tree('L', [...armPatches('L'), BAR]);
  }
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'people') for (const f of peopleFiles()) sources.push({ pool, id: f });
    else {
      const file = `scripts/f119-punisher-field/deals-${RUNS[pool]}.json`;
      const recs: Rec[] = JSON.parse(readFileSync(file, 'utf8'));
      const picked = recs.filter(r => !DEALS.length || DEALS.includes(String(r.seed)));
      const step = PER_POOL && process.env.SPREAD === '1' ? Math.max(1, Math.floor(picked.length / PER_POOL)) : 1;
      for (const r of PER_POOL ? picked.filter((_, i) => i % step === 0).slice(0, PER_POOL) : picked) sources.push({ pool, id: r });
    }
  }
  // interleave the pools, then a fixed shuffle by seed (a run cut short is still a fair sample of the decks)
  const hsh = (x: number) => Math.imul(x ^ 0x9e3779b1, 2654435761) >>> 0;
  const order = sources.map((x, i) => ({ x, i })).sort((a, b) => (typeof a.x.id === 'string' || typeof b.x.id === 'string' ? a.i - b.i : hsh(a.x.id.seed) - hsh(b.x.id.seed) || a.x.pool.localeCompare(b.x.pool)));
  for (const [k, { x: src }] of order.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (src.pool === 'people') person(src.id);
      else if (MODE === 'probe') probeDeal(src.pool, src.id);
      else if (MODE === 'record') recordDeal(src.pool, src.id);
      else if (MODE === 'time') timeDeal(src.pool, src.id);
      else throw new Error(`unknown MODE ${MODE}`);
    } catch (err) {
      out({ kind: 'err', pool: src.pool, src: typeof src.id === 'string' ? src.id : src.id?.seed, error: (err as Error).stack?.slice(0, 500) });
    }
  }
  out({ kind: 's', shard, mode: MODE, arm: ARM, mergeBase: MERGE_BASE, ms: Date.now() - started, rss: Math.round(process.memoryUsage().rss / 1e6) });
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
