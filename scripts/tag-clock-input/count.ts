/**
 * F114 + F110 phase A (brief /mnt/project-files/netrunner-ai/tag-clock-input/brief.md rev 2, final with ruling-redteam.md's
 * last section). Counts only: no src change. Started from the red team's probes/probe2.ts (pass 2), ported to separate
 * trees (RULE-SCRIPT-RULES: the tree that plays the source game is never asked or cleared). Trees (trees.ts): every one
 * from the merge base's src by `git archive` (ARM_BASE, default beta 3680b7f), dirs through resolve().
 *   S  plays the source games: the merge base's src as it is (ARM=base) or the arm's tree, switched on (step 9: ARM=ruled,
 *      ruling 1's arm, C1 in both views and P in the Corp's view; read beside the four phase A arms).
 *   B  prices: the merge base's src with the arm patches, switched per read (unset = the merge base); the record set
 *      (record-set.ts) is priced here with every switch off.
 *   L  (MODE=record) plays the legs: B's patches and the legs' REMOVE_TAG bar, switched to ARM.
 *
 * MODE=probe (steps 1, 2, 3, 5 a and c, 6; POOL=people: step 7). Plays every deal of both g1 pools on S. Rows:
 *   d  every Corp main decision with the Runner tagged, a click, 2 credits, a resource and a legal trash: the split of the
 *      trash's cost (click, credit slide, board), the board's change for the click alone and the 2 credits alone, the
 *      yardstick (the decision board's own change for a click and 2 credits), the Corp's candidate list (the trash's
 *      place, behind), tagLoss's parts under base / c1 / p / c1p in the Corp's view and the Runner's (read as the Runner),
 *      the identities of 1 f (new function against the two-call difference, both sides and viewers; the cost inside the
 *      frame against outside; skip 0 against 1), the cost 2 credits down (approximation 5), the last-click rise (pass 1
 *      finding 8), Rotary, and the cost on the last Runner-turn board before the Corp turn (approximation 2).
 *   u  the first Runner main decision of a Runner turn, every tagged one and one untagged in four with a resource (as
 *      probe2): per arm the per-turn input and its parts in both views, the next tag's price both views, the HQ's flagged
 *      cards with their type, the identity's term, IP Enforcement's split; against an Orbital Superiority deck (5 a):
 *      tagCost base and P, and evaluate's change for one more tag beside the clock's.
 *   g  one per game: chances, trashes, tags given by source, clears, the uses (record-set.ts) with their turn, whether
 *      the game is the batch's (winner, cr, sc).
 * MODE=record (step 4, 5 b): item 1's units (owed-counts item1.md) at horizon 1. A unit is the first Runner main decision
 *   of a Runner turn with the Runner tagged. SEEDS legs from it (seed 0 the game's rng; k >= 1 R&D and the stack
 *   reshuffled), REMOVE_TAG barred, played on L to the end of the next Corp turn; the uses in the leg by record-set.ts.
 *   Beside the unit: the per-turn input (tagLossPerTurn, uncapped) and the clock's output under each arm, both views.
 * MODE=time (1 e, and each arm's fire count, RULE-BAR-BEFORE-BATCH): S plays each deal; at every decision the merge base
 *   (base), the merge base again (ctl: the time control and the asking's noise) and the patched tree under each switch set
 *   (off, c1, p, c1p) decide on a clone (timeDeal). Time per caller kind, the answers that move against base, the keep's
 *   and tagLoss's work-outs per ask. (A lockstep of C1 against base stops at its first difference, which is the Runner's
 *   first main decision of the game in the deal tried: the Runner's price of a tag reads the Corp's credits under C1.)
 *
 * MODE=lock (phase B bars 2 and 7, ARM_BASE = the merge base): S plays each deal on the branch's own src; at every
 *   decision base (b), ctl (k), the branch (n) and the arm's tree switched to ruledn1 (X, the build as patches) decide
 *   on a clone as in MODE=time. The branch's answer against the arm's (arm-vs-branch: one is a stop), time per caller
 *   kind, and on X the clock prices by the cost they read (N1's fallback, by view).
 *   ARGS="MODE=probe" | ARGS="MODE=probe POOL=people" | ARGS="MODE=record SEEDS=2" | ARGS="MODE=time"
 *   Step 9: ARGS="MODE=probe ARM=ruled" (full games on the arm's tree; the g rows), ARGS="MODE=record ARM=ruled SEEDS=2",
 *   ARGS="MODE=time ASK=ruled PER_POOL=10" (decisions that move against base, by side and kind, the first of each deal,
 *   rezzes on the Runner's turn and credit clicks on a tagged board named apart). Summed by step9.mjs.
 *   (ai-script: SHARD=<k>/64; local: SHARD=0/4 npx vite-node scripts/tag-clock-input/count.ts -- MODE=probe)
 * HIDDEN-READ (the measuring script, never an agent): reads price the real board; seed k >= 1 reshuffles.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { makeTree } from '../corp-owed/trees';
import { ARMS, Arm, BAR, MERGE_BASE, armPatches, setArm, treeRoot } from './trees';
import { CLOCK_LINES, UseRecorder } from './record-set';

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
/** The arms read beside each board: phase A's four, and step 9's arm when it is another (ruled). */
/** ONLY=<file> (MODE=time): ask only at the listed decisions, "pool:seed:i" lines (the step 9 stop's attribution). */
const ONLY: Set<string> | null = process.env.ONLY ? new Set(readFileSync(process.env.ONLY, 'utf8').split('\n').filter(Boolean)) : null;
/** NOREAD=1 (MODE=probe): the g rows only, no d or u reads (step 9's base tags at the end). */
const NOREAD = process.env.NOREAD === '1';
const READ: Arm[] = ARMS.includes(ARM) ? ARMS : [...ARMS, ARM];
const root = treeRoot(shard);
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: any): any => (typeof x === 'number' ? (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x > 0 ? 'Inf' : '-Inf') : x);
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
  pricing: any;
  syn: any;
  runs: any;
  cand: any;
  rm: any;
  prompts: any;
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
  ['syn', './ai/synergyTags'],
  ['runs', './ai/runs'],
  ['cand', './ai/corp/candidates'],
  ['rm', './ai/corp/rezMoney'],
  ['prompts', './ai/prompts'],
];
/** One entry file, static imports in order (scripts/corp-owed/trees.ts loadTree: one module instance per file). */
async function load(name: string, dir: string): Promise<T> {
  const entry = join(dir, 'src', '__tci.ts');
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
const tree = (name: string, patches: any[] = []) => load(name, makeTree(join(root, name), { ref: MERGE_BASE, patches }));

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
/** tagLoss's parts on the board (the dbg hook), and the per-turn input. */
function parts(st: GameState, viewer: 'corp' | 'runner', arm: Arm, skip = 0, extra: Record<string, unknown> = {}) {
  const cap: any = {};
  setArm('B', arm, { ...extra, dbg: (x: any) => Object.assign(cap, x.part === 'trash' ? { nets: x.nets.map(r3), cost: r3(x.cost) } : { held: r3(x.held), punish: r3(x.punish), id: x.id }) });
  const perTurn = B.ev.tagLossPerTurn(st, viewer, skip) as number;
  setArm('B', arm, extra);
  return { perTurn: r3(perTurn), nets: cap.nets ?? null, cost: cap.cost ?? null, held: cap.held ?? null, punish: cap.punish ?? null, id: cap.id ?? null };
}
const title = (code: string) => {
  try {
    return S.core.getCardDefinition(code).title as string;
  } catch {
    return code;
  }
};
const typeOf = (code: string) => S.core.getCardDefinition(code).type_code as string;
const flagged = (code: string) => ((B.syn.cardSynergy(B.core.getCardDefinition(code)).when ?? []) as string[]).includes('ifTagged');
const down2 = (st: GameState): GameState => ({ ...st, corp: { ...st.corp, credits: st.corp.credits - 2 } });
const withTags = (s: GameState, n: number): GameState => ({ ...s, runner: { ...s.runner, tags: n } });
const corpMain = (s: GameState) => !s.winner && s.activePlayer === 'corp' && S.core.actingSide(s) === 'corp' && !s.pendingPrompts.length && !s.activeRun && !(s.priority && s.priority.holder !== s.activePlayer);
const runnerMain = (s: GameState) => !s.winner && s.activePlayer === 'runner' && S.core.actingSide(s) === 'runner' && !s.pendingPrompts.length && !s.activeRun && !(s.priority && s.priority.holder !== s.activePlayer);
/** A chance (pass 1 finding 11: past the corp_draw window, where only START_TURN is legal): tagged, a click, 2 credits, a resource, a legal trash. */
const chance = (s: GameState) => corpMain(s) && s.runner.tags > 0 && s.corp.clicks >= 1 && s.corp.credits >= 2 && s.runner.rig.resources.length > 0 && S.core.getLegalActions(s, 'corp').some((a: any) => a.type === 'TRASH_RESOURCE');
const hasRotary = (s: GameState) => s.runner.rig.hardware.some(c => c.cardCode === '36014');
/** The C1 cost read alone (trashCost), as `viewer`, on a board. */
const c1Cost = (st: GameState, viewer: 'corp' | 'runner') => (B.hv.clickPrice(st, 'corp', viewer) as number) + (B.vm.creditsLessCost(st, 'corp', viewer, 2) as number);

function readD(s: GameState, lastRunner: GameState | null, firstOfTurn: boolean) {
  const row: any = inCtx(s, 'corp', 'base', st => {
    const legal = B.core.getLegalActions(st, 'corp');
    const before = B.ev.evaluate(st, 'corp') as number;
    const credit = legal.find((a: any) => a.type === 'GAIN_CREDIT');
    const afterCredit = credit ? B.prompts.simulate(st, credit) : null;
    const creditValue = afterCredit ? (B.ev.evaluate(afterCredit, 'corp') as number) - before : 0;
    const cands = B.cand.corpCandidates(st, legal, { held: null, freeExhausted: false }) as any[];
    const tr = cands.map((c, i) => ({ c, i })).filter(x => x.c.action.type === 'TRASH_RESOURCE');
    const best = tr.slice().sort((a, b) => a.c.keys[0] - b.c.keys[0])[0];
    const after = best ? B.prompts.simulate(st, best.c.action) : null;
    const split: any = {};
    if (after) {
      split.prompt = after.pendingPrompts.length > 0;
      split.dCorp = r3(B.ev.sideStrength(after, 'corp', 'corp') - B.ev.sideStrength(st, 'corp', 'corp'));
      split.dCred = r3(B.vm.sideCreditValue(after, 'corp', 'corp') - B.vm.sideCreditValue(st, 'corp', 'corp'));
      split.dHand = r3(B.ev.handAndClicks(after, 'corp', 'corp') - B.ev.handAndClicks(st, 'corp', 'corp'));
      split.dBoard = r3(B.ev.corpBoardValue(after, 'corp') - B.ev.corpBoardValue(st, 'corp'));
      split.dClock = r3(B.ev.tagsWorth(after, 'corp') - B.ev.tagsWorth(st, 'corp'));
    }
    const st2 = { ...st, corp: { ...st.corp, credits: st.corp.credits - 2, clicks: st.corp.clicks - 1 } };
    const less1 = { ...st, corp: { ...st.corp, clicks: st.corp.clicks - 1 } };
    // 1 f: the new function against sideCreditValue's two-call difference, both sides and both viewers
    const fnDiff = (['corp', 'runner'] as const).flatMap(side =>
      (['corp', 'runner'] as const).map(viewer => {
        const dn = side === 'corp' ? down2(st) : { ...st, runner: { ...st.runner, credits: st.runner.credits - 2 } };
        return (B.vm.creditsLessCost(st, side, viewer, 2) as number) - ((B.vm.sideCreditValue(st, side, viewer) as number) - (B.vm.sideCreditValue(dn, side, viewer) as number));
      }),
    );
    return {
      cc: st.corp.credits,
      ck: st.corp.clicks,
      tags: st.runner.tags,
      nres: st.runner.rig.resources.length,
      keep: r3(B.rm.rezMoney(st).keep),
      need: r3(B.vm.creditNeed(st, 'corp')),
      reach0: r3(B.vm.moneyReach(st)),
      reach2: r3(B.vm.moneyReach(down2(st))),
      slide: r3(B.vm.sideCreditValue(st, 'corp', 'corp') - B.vm.sideCreditValue(down2(st), 'corp', 'corp')),
      fnDiffMax: r3(Math.max(...fnDiff.map(Math.abs))),
      c2dec: r3(B.ev.sideStrength(st, 'corp', 'corp') - B.ev.sideStrength(st2, 'corp', 'corp')),
      boardCred: r3(B.ev.corpBoardValue(st, 'corp') - B.ev.corpBoardValue(down2(st), 'corp')),
      boardClick: r3(B.ev.corpBoardValue(st, 'corp') - B.ev.corpBoardValue(less1, 'corp')),
      v: best ? r3(-best.c.keys[0]) : null,
      creditValue: r3(creditValue),
      // pass 1 finding 8: the clock's change on the credit click's board (the last click's rise)
      riseCredit: afterCredit && !afterCredit.winner ? r3((B.ev.tagsWorth(afterCredit, 'corp') as number) - (B.ev.tagsWorth(st, 'corp') as number)) : null,
      behind: best?.c.behind ?? null,
      trashAt: best?.i ?? null,
      trashCard: best ? title(st.runner.rig.resources.find((c: CardInstance) => c.instanceId === best.c.action.cardInstanceId)?.cardCode ?? '?') : null,
      ...split,
      hqFlag: st.corp.hq.filter((c: CardInstance) => flagged(c.cardCode)).map((c: CardInstance) => `${title(c.cardCode)}|${typeOf(c.cardCode)}`),
      idFlag: flagged(st.corp.identity.cardCode),
      rotary: hasRotary(st),
    };
  });
  for (const arm of READ) row[arm] = inCtx(s, 'corp', arm, st => ({ ...parts(st, 'corp', arm), clock: r3(B.ev.tagsWorth(st, 'corp')), skip1: parts(st, 'corp', arm, 1).perTurn }));
  // 1 f: C1's cost read inside the frame (on tagLoss's copy) against outside it
  row.c1in = inCtx(s, 'corp', 'c1', st => parts(st, 'corp', 'c1', 0, { c1in: true }), { c1in: true });
  // approximation 5: the cost at the credits now against 2 credits down
  row.c1down2 = inCtx(s, 'corp', 'c1', st => r3(c1Cost(down2(st), 'corp')));
  // the Runner's view of the same board read as the Runner (its own decision), and asked under the Corp's
  row.rv = Object.fromEntries(READ.map(arm => [arm, inCtx(s, 'runner', arm, st => parts(st, 'runner', arm))]));
  row.rvAsCorp = inCtx(s, 'corp', 'c1', st => parts(st, 'runner', 'c1'));
  row.firstOfTurn = firstOfTurn;
  // approximation 2: the cost on the last Runner-turn board before this Corp turn (the Corp's view, the Corp deciding)
  if (firstOfTurn && lastRunner) row.atRunner = inCtx(lastRunner, 'corp', 'c1', st => ({ ...parts(withTags(st, Math.max(1, st.runner.tags)), 'corp', 'c1'), cc: st.corp.credits }));
  return row;
}

function readU(s: GameState, orbitalDeck: boolean) {
  const row: any = {
    cc: s.corp.credits,
    rc: s.runner.credits,
    rk: s.runner.clicks,
    tags: s.runner.tags,
    nres: s.runner.rig.resources.length,
    hq: s.corp.hq.length,
    hqFlag: s.corp.hq.filter(c => flagged(c.cardCode)).map(c => `${title(c.cardCode)}|${typeOf(c.cardCode)}`),
    idFlag: flagged(s.corp.identity.cardCode),
    rotary: hasRotary(s),
    // IP Enforcement: the agendas in the Runner's score area by points (it takes back one of X points for X tags)
    rsAgendas: s.runner.scoreArea.map(c => S.core.getCardDefinition(c.cardCode).agenda_points ?? 0),
  };
  const t1 = withTags(s, Math.max(1, s.runner.tags));
  for (const arm of ARMS) {
    row[arm] = {
      r: inCtx(t1, 'runner', arm, st => parts(st, 'runner', arm)),
      c: inCtx(t1, 'corp', arm, st => parts(st, 'corp', arm)),
      nextR: r3(inCtx(s, 'runner', arm, st => B.runs.tagCost(st))),
      nextC: r3(inCtx(s, 'corp', arm, st => (B.ev.tagsWorth(st, 'corp', st.runner.tags + 1) as number) - (B.ev.tagsWorth(st, 'corp', st.runner.tags) as number))),
    };
  }
  if (orbitalDeck) {
    // 5 a: the Runner's price of one more tag (tagCost) against evaluate's own change for it, the clock's part beside
    row.orbital = Object.fromEntries(
      (['base', 'p'] as Arm[]).map(arm => [
        arm,
        inCtx(s, 'runner', arm, st => {
          const more = withTags(st, st.runner.tags + 1);
          return {
            tagCost: r3(B.runs.tagCost(st)),
            evalDiff: r3((B.ev.evaluate(st, 'runner') as number) - (B.ev.evaluate(more, 'runner') as number)),
            clockDiff: r3((B.ev.tagsWorth(more, 'runner') as number) - (B.ev.tagsWorth(st, 'runner') as number)),
          };
        }),
      ]),
    );
  }
  return row;
}

// ------------------------------------------------------------------------------------------------ deals
type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL: any[] = [...ALL_DECKS, ...NRDB_TEST_DECKS];
// g3 (phase B bar 6): the g3 deal set (seeds and decks; the same in every g3 run), from run 45717969976
const RUNS: Record<string, string> = { batch: '45830886377', nrdb: '45834898534', g3: '45717969976' };
function dealState(t: T, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(rec.seed, c, r));
}
const key = (a: unknown) => JSON.stringify(a ?? null);
const act = (s: GameState, a: any) => (a ? `${a.type}${a.cardInstanceId ? ':' + title(S.core.findCardAnywhere(s, a.cardInstanceId)?.cardCode ?? '?') : ''}` : 'none');
/** Where a tag came from: the Corp's card, or the ice the Runner was at during a run, or the action. */
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
  const g = new S.po.GameRunner(s0, { corp: S.ai.createAgent('corp', 'normal'), runner: S.ai.createAgent('runner', 'normal') });
  const orbitalDeck = 'Orbital Superiority' in (DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck)?.cards ?? {});
  const recd = new UseRecorder(B as any, off, S as any);
  const st = { chances: 0, trashes: 0, tagsGiven: 0, clears: 0, corpTurns: 0, taggedCorpTurns: 0, bySource: {} as Record<string, number> };
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let lastU = -1;
  let lastRunner: GameState | null = null;
  let chanceTurn = -1;
  const acts: unknown[] = [];
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
      if (chance(s)) {
        const first = s.turnNumber !== chanceTurn;
        chanceTurn = s.turnNumber;
        if (NOREAD) st.chances++;
        else {
          row = readD(s, lastRunner, first);
          kind = 'd';
        }
      } else if (runnerMain(s) && s.turnNumber !== lastU && ARM === 'base' && !NOREAD) {
        lastU = s.turnNumber;
        if (s.runner.tags > 0 || (s.runner.rig.resources.length > 0 && (s.turnNumber + rec.seed) % 4 === 0)) {
          row = readU(s, orbitalDeck);
          kind = 'u';
        }
      }
    } catch (e) {
      row = { error: String((e as Error).stack).slice(0, 400) };
      kind = kind || 'e';
    }
    if (runnerMain(s)) lastRunner = s;
    let stepped: boolean;
    try {
      stepped = g.step();
    } catch (e) {
      // CAPTURE=1 (the step 9 stop's test board): the actions so far and the board the failing step started from
      if (process.env.CAPTURE === '1') out({ kind: 'capture', pool, seed: rec.seed, corpDeck: rec.corpDeck, runnerDeck: rec.runnerDeck, n, acts, state: s });
      throw e;
    }
    if (!stepped) break;
    const a: any = g.last;
    if (process.env.CAPTURE === '1') acts.push(a);
    recd.step(s, a, g.state);
    const dt = g.state.runner.tags - s.runner.tags;
    if (dt > 0) {
      st.tagsGiven += dt;
      const k = tagSource(s, a);
      st.bySource[k] = (st.bySource[k] ?? 0) + dt;
    }
    if (a?.type === 'REMOVE_TAG') st.clears++;
    if (a?.type === 'TRASH_RESOURCE') st.trashes++;
    if (row) {
      if (kind === 'd') st.chances++;
      out({ kind, pool, seed: rec.seed, corpDeck: rec.corpDeck, runnerDeck: rec.runnerDeck, T: s.turnNumber, ...row, did: kind === 'd' ? act(s, a) : undefined });
    }
    if (Date.now() - t0 > 900_000) break;
  }
  recd.flush(g.state);
  const matches = ARM === 'base' ? (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc) : null;
  out({ kind: 'g', pool, seed: rec.seed, corpDeck: rec.corpDeck, runnerDeck: rec.runnerDeck, arm: ARM, ...st, tagsEnd: g.state.runner.tags, uses: recd.uses, winner: g.state.winner ?? null, T: g.state.turnNumber, matchesBatch: matches, ms: Date.now() - t0 });
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
/** One leg: REMOVE_TAG barred, to the end of the next Corp turn; the uses by record-set.ts, and the Corp turn's trash chances. */
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
    setArm('L', ARM);
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
    const beside: any = { cc: s.corp.credits, rc: s.runner.credits, tags: s.runner.tags, nres: s.runner.rig.resources.length, hq: s.corp.hq.length };
    try {
      for (const arm of READ) {
        beside[arm] = {
          c: inCtx(s, 'corp', arm, st => ({ ...parts(st, 'corp', arm), clock: r3(B.ev.tagsWorth(st, 'corp')) })),
          r: inCtx(s, 'runner', arm, st => ({ ...parts(st, 'runner', arm), clock: r3(B.ev.tagsWorth(st, 'runner')) })),
        };
      }
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
    out({ kind: 'u', pool, seed: rec.seed, corpDeck: rec.corpDeck, runnerDeck: rec.runnerDeck, arm: ARM, T: s.turnNumber, beside, legs, clockLines: CLOCK_LINES });
  }
  out({ kind: 'g', pool, seed: rec.seed, corpDeck: rec.corpDeck, arm: ARM, units: todo.length, winner: g.state.winner ?? null, ms: Date.now() - t0 });
}

// ------------------------------------------------------------------------------------------------ MODE=time
type Tally = Record<string, number>;
const inc = (t: Tally, k: string, n = 1) => void (t[k] = (t[k] ?? 0) + n);
type Method = 'chooseAction' | 'chooseRez' | 'chooseOffTurn';
type AskTree = 'b' | 'k' | 'X' | 'n';
/** MODE=lock (phase B bars 2 and 7): the branch's own src (n) and the arm's tree switched to ruledn1 (X), beside base and ctl. */
const LOCK_ASKS: { name: string; tree: AskTree; arm?: Arm }[] = [
  { name: 'base', tree: 'b' },
  { name: 'ctl', tree: 'k' },
  { name: 'branch', tree: 'n' },
  { name: 'arm', tree: 'X', arm: 'ruledn1' },
];
/** The asking trees: b and k the merge base as it is (k: the time control), X the patched tree asked under each switch set. */
const TIME_ASKS: { name: string; tree: AskTree; arm?: Arm }[] = [
  { name: 'base', tree: 'b' },
  { name: 'ctl', tree: 'k' },
  { name: 'off', tree: 'X', arm: 'base' },
  { name: 'c1', tree: 'X', arm: 'c1' },
  { name: 'p', tree: 'X', arm: 'p' },
  { name: 'c1p', tree: 'X', arm: 'c1p' },
  { name: 'ruled', tree: 'X', arm: 'ruled' },
  { name: 'ruledin', tree: 'X', arm: 'ruledin' },
  { name: 'ruledtag', tree: 'X', arm: 'ruledtag' },
  { name: 'ruledorc', tree: 'X', arm: 'ruledorc' },
].filter(a => !process.env.ASK || a.name === 'base' || process.env.ASK.split(',').includes(a.name)) as { name: string; tree: AskTree; arm?: Arm }[];
const ASKS = MODE === 'lock' ? LOCK_ASKS : TIME_ASKS;
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
/**
 * 1 e and the arms' fire counts: S plays each deal (its agents watched, never asked or cleared); at every decision each
 * asking tree decides on a structuredClone with a fresh Normal agent given the playing agent's fields, caches cleared, in
 * a turn that rotates. Per caller kind: ms of each ask; the answers that differ from base's (ctl against base is the
 * asking's own noise); on X, the keep's work-outs and tagLoss's work-outs per ask.
 */
function timeDeal(pool: string, rec: Rec) {
  const ms: Tally = {};
  const n: Tally = {};
  const differ: Tally = {};
  const work: Tally = {};
  const first: Record<string, any> = {};
  const inout: any[] = [];
  let i = 0;
  const decide = (side: 'corp' | 'runner', method: Method, s: GameState, agent: any, own: () => unknown) => {
    const kind = method === 'chooseRez' ? 'rez' : method === 'chooseOffTurn' ? 'off' : s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    const k = `${side}:${kind}`;
    const tagged = s.runner.tags > 0 ? ' tagged' : '';
    const answers: Record<string, string> = {};
    if (ONLY && !ONLY.has(`${pool}:${rec.seed}:${i}`)) {
      i++;
      return own();
    }
    const order = ASKS.map((_, j) => ASKS[(j + i) % ASKS.length]);
    for (const a of order) {
      if (a.arm) setArm('X', a.arm);
      G.__tciKeep = { n: 0, clock: 0 };
      G.__tciFall = {};
      const t0 = performance.now();
      answers[a.name] = ask(TT[a.tree]!, side, method, s, agent);
      inc(ms, `${a.name} ${k}`, performance.now() - t0);
      if (a.tree === 'X') {
        inc(work, `keep ${a.name} ${k}`, G.__tciKeep.n);
        inc(work, `clock ${a.name} ${k}`, G.__tciKeep.clock);
        // N1's fallback (ruling 3, reported): clock prices by the cost they read ('flat' inside a hold count, or 'c1'), by view
        for (const [fk, fn] of Object.entries(G.__tciFall as Record<string, number>)) inc(work, `cost ${fk} ${a.name} ${k}`, fn);
      }
      G.__tciKeep = undefined;
      G.__tciFall = undefined;
    }
    setArm('X', 'base');
    // bar 2 (MODE=lock): the branch against the arm's scratch tree, answer for answer; one difference is a stop
    if (answers.branch !== undefined && answers.arm !== undefined && answers.branch !== answers.arm) {
      inc(differ, `arm-vs-branch ${k}`);
      inout.push({ i, T: s.turnNumber, k, active: s.activePlayer, tags: s.runner.tags, cc: s.corp.credits, branch: answers.branch.slice(0, 200), arm: answers.arm.slice(0, 200) });
    }
    // the cost read inside the frame against outside, answer for answer (step 9's nrdb 1281)
    if (answers.ruled !== undefined && answers.ruledin !== undefined && answers.ruled !== answers.ruledin) {
      inc(differ, `ruledin-vs-ruled ${k}`);
      // every one, with its board (the deal and the decision index: replayed by the step 9 stop's attribution)
      inout.push({ i, T: s.turnNumber, k, active: s.activePlayer, tags: s.runner.tags, cc: s.corp.credits, ruled: answers.ruled.slice(0, 200), ruledin: answers.ruledin.slice(0, 200), ...(answers.ruledtag !== undefined ? { tagSame: answers.ruledtag === answers.ruledin, orcSame: answers.ruledorc === answers.ruledin } : {}) });
      if (!first['ruledin-vs-ruled']) first['ruledin-vs-ruled'] = { i, T: s.turnNumber, k, tags: s.runner.tags, base: answers.ruled.slice(0, 160), arm: answers.ruledin.slice(0, 160) };
    }
    inc(n, k);
    if (tagged) inc(n, k + tagged);
    for (const a of ASKS.slice(1))
      if (answers[a.name] !== answers.base) {
        inc(differ, `${a.name} ${k}`);
        if (tagged) inc(differ, `${a.name} ${k}${tagged}`);
        // step 9 (finding 11): rezzes on the Runner's turn and credit clicks on a tagged board, named apart
        if (kind === 'rez' && s.activePlayer === 'runner') inc(differ, `${a.name} rez on the Runner's turn`);
        if (tagged && (answers.base.includes('GAIN_CREDIT') || answers[a.name].includes('GAIN_CREDIT'))) inc(differ, `${a.name} credit click tagged`);
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
  // approximation 4: Corp turns that start (the first main decision) tagged, with a resource, under 2 credits; trashes that turn
  const turns: { T: number; cc: number; trashes: number }[] = [];
  let lastT = -1;
  for (let j = 0; j < 4000; j++) {
    const s: GameState = g.state;
    if (corpMain(s) && s.turnNumber !== lastT) {
      lastT = s.turnNumber;
      if (s.runner.tags > 0 && s.runner.rig.resources.length > 0 && s.corp.credits < 2) turns.push({ T: s.turnNumber, cc: s.corp.credits, trashes: 0 });
    }
    if (!g.step()) break;
    const t = turns[turns.length - 1];
    if ((g.last as any)?.type === 'TRASH_RESOURCE' && t && t.T === s.turnNumber) t.trashes++;
  }
  const r1 = (t: Tally) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  out({ kind: 'time', pool, seed: rec.seed, corpDeck: rec.corpDeck, decisions: i, winner: g.state.winner ?? null, T: g.state.turnNumber, n, ms: r1(ms), differ, work, first, turns, inout });
}

// ------------------------------------------------------------------------------------------------ POOL=people (step 7)
const PEOPLE = 'tests/fixtures/human-games';
/** The human-game fixtures where the person was the Corp (config.ai is the AI's side). */
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
  let chanceTurn = -1;
  let chances = 0;
  for (const move of r.moves as GameAction[]) {
    if (chance(s)) {
      chances++;
      const first = s.turnNumber !== chanceTurn;
      chanceTurn = s.turnNumber;
      let row: any;
      try {
        row = { cc: s.corp.credits, ck: s.corp.clicks, tags: s.runner.tags, nres: s.runner.rig.resources.length };
        for (const arm of ARMS) row[arm] = inCtx(s, 'corp', arm, st => parts(st, 'corp', arm));
        row.hqFlag = s.corp.hq.filter(c => flagged(c.cardCode)).map(c => `${title(c.cardCode)}|${typeOf(c.cardCode)}`);
      } catch (e) {
        row = { error: String((e as Error).stack).slice(0, 300) };
      }
      out({ kind: 'd', pool: 'people', src: name, corpDeck: r.config.corpDeck?.name, T: s.turnNumber, firstOfTurn: first, ...row, did: act(s, move) });
    }
    try {
      s = S.core.executeAction(s, move);
    } catch (e) {
      err = (e as Error).message.slice(0, 120);
      break;
    }
    replayed++;
  }
  out({ kind: 'g', pool: 'people', src: name, corpDeck: r.config.corpDeck?.name, moves: r.moves.length, replayed, err, chances });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const started = Date.now();
  if (process.env.STACK) Error.stackTraceLimit = 100000;
  if (MODE === 'lock') {
    // S plays on the branch's own src (makeTree with no ref copies the checkout's src), n is the branch asked
    S = await load('S', makeTree(join(root, 'S'), {}));
    TT = { b: await tree('b'), k: await tree('k'), n: await load('n', makeTree(join(root, 'n'), {})), X: await tree('X', armPatches('X')) };
    setArm('X', 'base');
  } else if (MODE === 'time') {
    S = await tree('S');
    TT = { b: await tree('b'), k: await tree('k'), X: await tree('X', armPatches('X')) };
    setArm('X', 'base');
  } else {
    S = await tree('S', ARM === 'base' ? [] : armPatches('S'));
    setArm('S', ARM);
    B = await tree('B', armPatches('B'));
    off();
    if (MODE === 'record') L = await tree('L', [...armPatches('L'), BAR]);
  }
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'people') for (const f of peopleFiles()) sources.push({ pool, id: f });
    else {
      const recs: Rec[] = JSON.parse(readFileSync(`scripts/corp-owed/deals-${RUNS[pool]}.json`, 'utf8'));
      const picked = recs.filter(r => !DEALS.length || DEALS.includes(String(r.seed)));
      // SPREAD=1: PER_POOL deals spread evenly through the pool's file (its decks in order), not its first PER_POOL
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
      else if (MODE === 'time' || MODE === 'lock') timeDeal(src.pool, src.id);
      else throw new Error(`unknown MODE ${MODE}`);
    } catch (err) {
      out({ kind: 'err', pool: src.pool, src: typeof src.id === 'string' ? src.id : src.id?.seed, error: (err as Error).stack?.slice(0, 500) });
      // STACK=1: the whole stack, as frame counts by function (a deep recursion shows as one name many times)
      if (process.env.STACK) {
        const fr: Record<string, number> = {};
        for (const l of ((err as Error).stack ?? '').split('\n').slice(1)) {
          const m = l.match(/at (\S+) \((.*\/src\/)?([^:)]+)/);
          const k = m ? `${m[1]} ${m[3]}` : l.trim().slice(0, 80);
          fr[k] = (fr[k] ?? 0) + 1;
        }
        out({ kind: 'stack', frames: Object.entries(fr).sort((a, b) => b[1] - a[1]).slice(0, 40) });
      }
    }
  }
  out({ kind: 's', shard, mode: MODE, arm: ARM, mergeBase: MERGE_BASE, ms: Date.now() - started, rss: Math.round(process.memoryUsage().rss / 1e6) });
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
