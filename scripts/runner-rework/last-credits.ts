/**
 * R-14h: the Runner's last credits (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/r14h-last-credits-count.md
 * rev 0a, issue #65). Counts only: no src change, nothing fixed, no fix proposed. Built on R-14e's trash-readers.ts (copied,
 * that script is not edited): the same unit, classes and pairs, on beta f256a24's tree (O1b: the price is runs.ts trashNet).
 *
 * Unit: one access by the deciding Normal Runner, at the top level of a game, of a root card with a trash cost it can pay;
 * class Z (Z1: the trash leaves it under its cheapest unpaid grip card's cost with a click left; Z2: 0 or 1 credits after).
 * Every unit access is recorded (all classes), so the Z counts sit beside the others. Pools, apart: batch (the 221 deals
 * of g1 45574713678), nrdb (the 110 of NRDB=1 g1 45593231799), people (tests/fixtures/human-games, the person is the
 * Runner), fixtures (#58, #65, #67: evidence a class exists, never a rate).
 *
 * Added to R-14e's record (Part A item 2): the grip part split in two (evaluate's hand term, itself split into the clicks'
 * price and the hand's own worth; scoreOutcome's 0.5 keep term), the rig part split (coverage, each card's own term, the
 * plans), the grip cards the trash prices out (cost within the keep board's credits, over the trash board's), the price
 * as the run reads it (trashNet) beside R-14e's raw reading, and the tipping test: every part worked out again on the same
 * board with 5 more credits (decision context noted on that board), and which single part, set to that value, turns the
 * trash-or-keep answer.
 * Part A item 3 (CORP=1): at each Corp decision of the source games, the chosen answer against the next best (prompts:
 * scoreOutcome as the fall-through scores; main actions: the one-step board score, a proxy, the Corp picks by its planner)
 * where the two differ in leaving the Corp at 0 or 1 credits, and whether the hand terms tip that order.
 *
 * MODE=count (default) writes `a` records (Runner accesses) and `c` records (Corp decisions). MODE=pairs as R-14e's, with
 * the Runner's credits less the Corp's two and four turns on.
 *
 * Trees (last-credits-trees.ts): `play` (src unchanged) plays the source games; `eval` is asked on structuredClones;
 * `pairs` (src unchanged) plays the answers on. HIDDEN-READ (the measuring script, never an agent): the deciding Runner's
 * memory is read and copied for the asks and the pairs; the pairs' seeds k >= 1 reshuffle R&D and the stack (both arms
 * alike).
 *
 *   SHARD=0/64 POOL=batch,nrdb,people,fixtures CORP=1 npx vite-node scripts/runner-rework/last-credits.ts
 *   ARGS="MODE=pairs PAIRS=scripts/runner-rework/last-credits-pairs.json SEEDS=n"
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from './facts-trees';
import { makeTrees } from './last-credits-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const MODE = process.env.MODE ?? 'count';
const POOLS = (process.env.POOL ?? 'batch,nrdb,people,fixtures').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const FILES = (process.env.FILES ?? '').split(',').filter(Boolean);
const SEEDS = Number(process.env.SEEDS ?? 3);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/last-credits', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number | null | undefined): number | string | null =>
  x === null || x === undefined ? null : Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x > 0 ? 'Inf' : '-Inf';
const key = (a: unknown) => JSON.stringify(a ?? null);
const G = globalThis as any;

let PL: Tree; // play: plays the source games
let E: Tree & { prompts: any; planner: any; reply: any; profiles: any; plans: any; vm: any }; // eval: asked on copies
let P: Tree; // pairs: plays the answers on
const timing: Record<string, number> = {};
const timed = <X>(k: string, f: () => X): X => {
  const t0 = performance.now();
  try {
    return f();
  } finally {
    timing[k] = (timing[k] ?? 0) + performance.now() - t0;
  }
};
const asRunner = <X>(s: GameState, f: () => X): X =>
  E.pricing.asSide('runner', () => {
    E.handValues.decisionContext(s, 'runner');
    return f();
  });
const def = (t: Tree, c: CardInstance | string) => t.core.getCardDefinition(typeof c === 'string' ? c : c.cardCode);

/** The unit's test: a Runner access_trash prompt with the trash offered, on a card in a server's root. */
function unitPrompt(t: Tree, s: GameState): { p: any; card: CardInstance; server: string } | null {
  const p = t.core.activePrompt(s);
  if (!p || p.kind !== 'access_trash' || p.side !== 'runner' || p.trashCost == null) return null;
  for (const v of Object.values(s.corp.servers) as any[]) {
    const card = v.root.find((c: CardInstance) => c.instanceId === p.cardInstanceId);
    if (card) return { p, card, server: v.id };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ the readings (eval tree)
const answerTrashes = (a: any) => !!a?.choice?.trash || !!a?.choice?.alternativeId;

/** One answer's scoreOutcome on `board` with its parts (the eval tree's capture), as the fall-through scores it. */
function scored(board: GameState, action: GameAction, memory: Map<string, string>) {
  const after = E.prompts.simulate(board, action);
  if (!after) return null;
  const cap: any = { active: false };
  G.__trCap = cap;
  try {
    const total = E.prompts.scoreOutcome(board, after, 'runner', memory, true) as number;
    return { total, cap, after };
  } finally {
    G.__trCap = undefined;
  }
}

/** The parts of trash less keep (each the difference between the trash board's term and the keep board's), signed as they enter the Runner's score. */
function parts(t: any, k: any, cardId: string) {
  const d = (f: (c: any) => number) => f(t.cap) - f(k.cap);
  const missing: string[] = [];
  for (const [n, c] of [['trash', t.cap], ['keep', k.cap]] as const) {
    if (!c.runner || !c.corp) missing.push(`${n}:evaluate(${c.evaluate === 1000 || c.evaluate === -1000 ? 'gameEnd' : 'noParts'})`);
  }
  if (missing.length) return { missing, total: r3(t.total - k.total) };
  const cardT = t.cap.corp.boardCards.get(cardId) ?? 0;
  const cardK = k.cap.corp.boardCards.get(cardId) ?? 0;
  const p: Record<string, number> = {
    card: -(cardT - cardK),
    corpBoardRest: -(d(c => c.corp.board) - (cardT - cardK)),
    credits: d(c => c.runner.credits),
    rig: d(c => c.runner.rig),
    grip: d(c => c.runner.handClicks) + d(c => c.handKeep ?? 0),
    tagsRunner: -d(c => c.runner.tags),
    tagsCorp: -d(c => c.corp.tags),
    damage: -d(c => c.runner.core) - d(c => c.runner.clock),
    runRest: d(c => c.runRest ?? 0),
    corpCredits: -d(c => c.corp.credits),
    corpHand: -d(c => c.corp.handClicks),
    other: d(c => c.runner.points) - d(c => c.corp.points + c.corp.agendaCounters + c.corp.idPower),
  };
  const sum = Object.values(p).reduce((n, v) => n + v, 0);
  const total = t.total - k.total;
  const res: any = Object.fromEntries(Object.entries(p).map(([n, v]) => [n, r3(v)]));
  res.total = r3(total);
  res.adds = Math.abs(sum - total) <= 0.001;
  if (!res.adds) res.gap = r3(total - sum);
  return res;
}

/** What the trash did besides removing the card: the engine's two boards after the answers (the real state). */
function consequence(s: GameState, prompt: any, card: CardInstance) {
  const t = E.prompts.simulate(s, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: prompt.id, choice: { kind: 'access_trash', trash: true } });
  const k = E.prompts.simulate(s, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: prompt.id, choice: { kind: 'access_trash', trash: false } });
  if (!t || !k) return { kinds: ['unknown'], err: 'simulate' };
  const kinds: string[] = [];
  const gripCost = Number(E.core.getCardScript?.(card.cardCode)?.trashGripCost ?? 0);
  const dTags = t.runner.tags - k.runner.tags;
  const dGrip = t.runner.grip.length - k.runner.grip.length + gripCost;
  const dCore = (t.runner.coreDamage ?? 0) - (k.runner.coreDamage ?? 0);
  const dCorpCr = t.corp.credits - k.corp.credits;
  const dHq = t.corp.hq.length - k.corp.hq.length;
  const dScore = t.corp.score - k.corp.score;
  const dRunnerCr = t.runner.credits - k.runner.credits + Number(prompt.trashCost);
  if (dTags > 0) kinds.push('tag');
  const dmgLines = t.log.slice(s.log.length).filter((e: any) => /did \d+ (net|meat|core|brain) damage/i.test(e.message ?? '')).length - k.log.slice(s.log.length).filter((e: any) => /did \d+ (net|meat|core|brain) damage/i.test(e.message ?? '')).length;
  if (dGrip < 0 || dCore > 0 || dmgLines > 0 || (t.winner === 'corp' && k.winner !== 'corp')) kinds.push('damage');
  if (dCorpCr > 0 || dHq > 0 || dScore > 0) kinds.push('corpGain');
  // Log lines of the trash board that are not the keep board's and do not name the trashed card: another card's trigger
  // (a line is the keep board's too when its first three words are: the same effect on other cards, Corp did 4 net damage, ...)
  const head = (m: string) => (m ?? '').split(/\s+/).slice(0, 3).join(' ');
  const kl = new Set(k.log.slice(s.log.length).map((e: any) => head(e.message)));
  const title = def(E, card).title as string;
  // (the engine's bookkeeping is left out: an emptied remote going away, credits paid from a card)
  const bookkeeping = (m: string) => / no longer exists\.$/.test(m) || /\[credit\] paid from /.test(m);
  const extra = t.log.slice(s.log.length).filter((e: any) => !kl.has(head(e.message)) && !(e.message ?? '').includes(title) && e.cardCode !== card.cardCode && !bookkeeping(e.message ?? ''));
  if (extra.length) kinds.push('trigger');
  const pt = E.core.activePrompt(t);
  const pk = E.core.activePrompt(k);
  if ((pt?.kind ?? null) !== (pk?.kind ?? null) || (pt && 'source' in pt && pk && 'source' in pk && pt.source.cardCode !== pk.source.cardCode)) kinds.push('prompt');
  return {
    kinds: kinds.length ? kinds : ['nothing'],
    dTags,
    dGrip,
    dCore,
    dCorpCr,
    dHq,
    dScore,
    dRunnerCrBeyondCost: dRunnerCr,
    lines: extra.slice(0, 4).map((e: any) => (e.message ?? '').slice(0, 100)),
    prompt: pt && pt !== pk ? { kind: pt.kind, card: 'source' in pt ? def(E, pt.source.cardCode).title : null } : null,
  };
}

/** The Runner's cheapest grip card it could pay before the trash (its printed cost; 0-cost cards left out). */
function cheapestPlan(s: GameState): number | null {
  const costs = s.runner.grip.map((c: CardInstance) => Number(def(E, c).cost ?? 0)).filter(x => x > 0 && x <= s.runner.credits);
  return costs.length ? Math.min(...costs) : null;
}

// ------------------------------------------------------------------------------------------------ R-14h's finer parts
const rigOf = (st: GameState) => [...st.runner.rig.programs, ...st.runner.rig.hardware, ...st.runner.rig.resources];

/** One answer's board, the pieces under evaluate's hand and rig terms (eval tree, the same pricing context as the score). */
function finer(after: GameState) {
  const hc = E.evaluate.handAndClicks(after, 'runner', 'runner') as number;
  const clicks = (E.handValues.clickPrice(after, 'runner', 'runner') as number) * after.runner.clicks;
  const cards = new Map<string, number>();
  let cardsSum = 0;
  for (const c of rigOf(after)) {
    const v = E.evaluate.addRigCard(after, c, 0) as number;
    cards.set(c.instanceId, v);
    cardsSum += v;
  }
  const plans = E.plans.boardPlansWorth(after, 'runner') as number;
  const rig = E.evaluate.runnerRigValue(after) as number;
  return { hc, clicks, own: hc - clicks, cards, plans, coverage: rig - cardsSum - plans, rig };
}

/** R-14e's parts with the grip and rig parts split; `fineGap` is what the split leaves against the captured terms. */
function fineParts(t: any, k: any, cardId: string, board: GameState) {
  const base = parts(t, k, cardId);
  if (base.missing) return base;
  const ft = finer(t.after);
  const fk = finer(k.after);
  const byCard: Record<string, number> = {};
  for (const c of rigOf(k.after)) {
    const v = (ft.cards.get(c.instanceId) ?? 0) - (fk.cards.get(c.instanceId) ?? 0);
    if (Math.abs(v) > 1e-9) byCard[`${def(E, c).title} ${c.instanceId}`] = v;
  }
  const fine: Record<string, number> = {
    card: base.card,
    corpBoardRest: base.corpBoardRest,
    credits: base.credits,
    rigCoverage: ft.coverage - fk.coverage,
    rigCards: [...ft.cards.values()].reduce((n, v) => n + v, 0) - [...fk.cards.values()].reduce((n, v) => n + v, 0),
    rigPlans: ft.plans - fk.plans,
    gripClicks: ft.clicks - fk.clicks,
    gripOwn: ft.own - fk.own,
    gripKeep: (t.cap.handKeep ?? 0) - (k.cap.handKeep ?? 0),
    tagsRunner: base.tagsRunner,
    tagsCorp: base.tagsCorp,
    damage: base.damage,
    runRest: base.runRest,
    corpCredits: base.corpCredits,
    corpHand: base.corpHand,
    other: base.other,
  };
  // The split against the captured terms (the same calls, so 0 unless a cache answered differently)
  const fineGap = { rig: fine.rigCoverage + fine.rigCards + fine.rigPlans - Number(base.rig), hand: fine.gripClicks + fine.gripOwn - dd(t, k, c => c.runner.handClicks) };
  // The grip cards the trash prices out: payable on the keep board, not on the trash board (heldWorth's SOON.now to .later)
  const out: { card: string; cost: number; held: number }[] = [];
  for (const c of k.after.runner.grip as CardInstance[]) {
    const cost = Number(def(E, c).cost ?? 0);
    if (cost <= k.after.runner.credits && cost > t.after.runner.credits) out.push({ card: def(E, c).title, cost, held: (E.handValues.heldWorth(t.after, c, 'runner') as number) - (E.handValues.heldWorth(k.after, c, 'runner') as number) });
  }
  void board;
  // The deck's average card (cardRate: drawWorth, heldWorth's SOON on the stack) on each board: the channel by which the
  // credits reach draw cards' and payout cards' worth in the rig and a click's worth
  const cardRate = { trash: E.vm.cardRate(t.after, 'runner') as number, keep: E.vm.cardRate(k.after, 'runner') as number };
  return { base, fine, byCard, fineGap, pricedOut: out, cardRate };
}
const dd = (t: any, k: any, f: (c: any) => number) => f(t.cap) - f(k.cap);

/** Both answers scored again on the same board with 5 more credits (decision context noted on it); its fine parts. */
function plus5(board: GameState, real: GameState, memory: Map<string, string>, cardId: string) {
  const b5 = structuredClone(board);
  b5.runner.credits += 5;
  const pr = E.core.activePrompt(b5);
  E.handValues.decisionContext(b5, 'runner');
  try {
    const t = scored(b5, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: pr.id, choice: { kind: 'access_trash', trash: true } } as any, memory);
    const k = scored(b5, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: pr.id, choice: { kind: 'access_trash', trash: false } } as any, memory);
    if (!t || !k) return null;
    const fp: any = fineParts(t, k, cardId, b5);
    return { margin: t.total - k.total, fine: fp.fine ?? null, cardRate: fp.cardRate ?? null };
  } finally {
    E.handValues.decisionContext(real, 'runner');
  }
}

/** Which single fine part, set to its +5 value, turns the trash-or-keep answer (margin's sign). */
function tipping(margin: number, fine: Record<string, number>, fine5: Record<string, number>) {
  const tips: string[] = [];
  for (const n of Object.keys(fine)) {
    const m = margin - fine[n] + fine5[n];
    if (m > 0 !== margin > 0) tips.push(n);
  }
  return tips;
}
const r3all = (o: Record<string, number> | null | undefined) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r3(v)])) : null);

/** Every reading of one access, on a copy of `s0` (the board with the prompt), and its class. */
function read(s0: GameState, memory: Map<string, string>) {
  const s = structuredClone(s0);
  const u = unitPrompt(E, s)!;
  const { p, card } = u;
  const d = def(E, card);
  E.clear();
  return asRunner(s, () => {
    // The board the decision answers on: as HeuristicRunnerAI.promptAnswer (the view, unless the prompt names a card the
    // view may have changed; then the real state); decided-twice.ts accessScores's rule
    const view = E.planner.runnerDecisionView(s, memory);
    const shown = JSON.stringify(p);
    const { ice, root, loose } = E.reply.runnerUnknownSlots(s, memory);
    const onReal = [...s.runner.stack, ...ice, ...root, ...loose].some((c: CardInstance) => shown.includes(`"${c.instanceId}"`));
    const board = onReal || view === s ? s : view;
    const bp = E.core.activePrompt(board);
    const bcard = E.core.findCardAnywhere(board, card.instanceId) ?? card;
    // The price's reading (runs.ts serverWorth's two trash lines), on the decision's board
    const trash = Number(d.trash_cost ?? p.trashCost);
    const cvLeft = E.evaluate.corpCardValue(bcard, board, 'runner', true) as number;
    const cvDefault = E.evaluate.corpCardValue(bcard, board, 'runner', false) as number;
    const cost = E.runs.creditCost(board, trash) as number;
    const raw = cvLeft - cost;
    const payable = d.trash_cost != null && d.trash_cost <= board.runner.credits;
    const floored = payable ? (card.isRezzed ? Math.max(0.5, raw) : Math.max(0, raw)) : 0;
    // The decision's reading: every legal answer scored; trash and keep with their parts
    const answers = (E.core.getLegalActions(board, 'runner') as GameAction[]).filter(a => a.type === 'RESOLVE_PROMPT');
    let best: any = null;
    let bestScore = -Infinity;
    const scores: any[] = [];
    let tS: any = null;
    let kS: any = null;
    for (const a of answers) {
      const sc = scored(board, a, memory);
      if (!sc) continue;
      const ch: any = (a as any).choice;
      if (ch?.trash === true && !ch.alternativeId) tS = sc;
      if (ch?.trash === false && !ch.alternativeId) kS = sc;
      scores.push({ a: ch?.alternativeId ? `alt:${ch.alternativeId}` : ch?.trash ? 'trash' : 'keep', s: r3(sc.total) });
      if (sc.total > bestScore) {
        bestScore = sc.total;
        best = a;
      }
    }
    const pt = tS && kS ? parts(tS, kS, card.instanceId) : null;
    // The rig term split by rig card (each card's own term, trash board less keep board; the rest is coverage and plans),
    // on accesses whose trash gives a tag (coordinator 02:37Z addition 3, for the Corp side's F104 c count)
    let rigSplit: any = null;
    if (tS && kS && pt && !pt.missing && tS.after.runner.tags > kS.after.runner.tags) {
      const rigOf = (st: GameState) => [...st.runner.rig.programs, ...st.runner.rig.hardware, ...st.runner.rig.resources];
      const by: Record<string, number> = {};
      for (const c of rigOf(kS.after)) {
        const ct = rigOf(tS.after).find(x => x.instanceId === c.instanceId);
        const v = (ct ? (E.evaluate.addRigCard(tS.after, ct, 0) as number) : 0) - (E.evaluate.addRigCard(kS.after, c, 0) as number);
        const name = `${def(E, c).title} ${c.instanceId}`;
        if (Math.abs(v) > 1e-9) by[name] = r3(v) as number;
      }
      const sumCards = Object.values(by).reduce((n, v) => n + Number(v), 0);
      rigSplit = { byCard: by, rest: r3(Number(pt.rig) - sumCards) };
    }
    const margin = tS && kS ? tS.total - kS.total : null;
    // R-14h: the fine parts, the price as the run reads it (trashNet, since O1b), the +5 board and the tipping part
    const fp: any = tS && kS ? fineParts(tS, kS, card.instanceId, board) : null;
    const engineCost = Number(p.trashCost);
    const creditCostEngine = E.runs.creditCost(board, engineCost) as number;
    const trashNet = E.runs.trashNet(board, bcard) as number;
    const p5 = fp && fp.fine && margin !== null ? plus5(board, s, memory, card.instanceId) : null;
    const tips = p5?.fine && margin !== null ? tipping(margin, fp.fine, p5.fine) : null;
    const decisionTrash = answerTrashes(best);
    const priceTrash = trashNet > 0; // the run's price since O1b (R-14e read `raw > 0`, kept below as priceTrashRaw)
    // What the trash did besides removing the card (the real state, not the view)
    const conseq = consequence(s, p, card);
    // Credits after the trash: the trash board's (the engine paid it)
    const creditsAfter = tS ? tS.after.runner.credits : s.runner.credits - trash;
    const cheapest = cheapestPlan(s);
    const z1 = cheapest !== null && s.runner.clicks >= 1 && creditsAfter < cheapest;
    const z2 = creditsAfter <= 1;
    const profiled = !!E.profiles.profileOf(card.cardCode);
    const hosted = Number(card.tokens?.credit ?? 0);
    const lGap = Math.abs(cvLeft - cvDefault);
    const L = profiled && card.isRezzed && hosted === 0 && margin !== null && lGap > Math.abs(margin);
    const cKinds = conseq.kinds.filter((k: string) => k === 'tag' || k === 'damage' || k === 'corpGain');
    const cls = cKinds.length ? 'C' : z1 || z2 ? 'Z' : L ? 'L' : raw < 0.5 ? 'F' : 'R';
    const sub = cls === 'C' ? cKinds.join('+') : cls === 'Z' ? (z1 && z2 ? 'Z1+Z2' : z1 ? 'Z1' : 'Z2') : undefined;
    return {
      card: d.title,
      code: card.cardCode,
      rezzed: card.isRezzed,
      trashCost: trash,
      hosted,
      profiled,
      server: u.server,
      credits: s.runner.credits,
      clicks: s.runner.clicks,
      tags: s.runner.tags,
      grip: s.runner.grip.length,
      phase: s.activeRun?.phase ?? null,
      alternatives: (p.alternatives ?? []).length,
      board: board === s ? 'real' : 'view',
      promptOnBoard: !!bp,
      price: { cvLeft: r3(cvLeft), cvDefault: r3(cvDefault), creditCost: r3(cost), raw: r3(raw), floored: r3(floored), floor: card.isRezzed && payable && raw < 0.5 },
      // Brief item 2 (added 02:28Z): the printed trash cost the price reads and the engine's (the prompt's: Mahkota Langit
      // Grid adds 2), and what each reader holds one credit at here: the Runner's slide per credit of the trash (the
      // price's creditCost, and the decision's credit term), the Corp's worth as left per hosted credit (cards with hosted
      // credits only; null otherwise: no face count to divide by)
      printedCost: d.trash_cost ?? null,
      engineCost: p.trashCost,
      costDiffers: d.trash_cost !== p.trashCost,
      perCredit: {
        priceRunner: r3(trash > 0 ? cost / trash : null),
        decisionRunner: r3(pt && !pt.missing && Number(p.trashCost) > 0 ? -Number(pt.credits) / Number(p.trashCost) : null),
        corpLeftPerHosted: r3(hosted > 0 ? cvLeft / hosted : null),
      },
      decision: { trash: r3(tS?.total), keep: r3(kS?.total), margin: r3(margin), pick: best ? ((best as any).choice?.alternativeId ? 'alt' : (best as any).choice?.trash ? 'trash' : 'keep') : null, scores },
      parts: pt,
      priceRun: { trashNet: r3(trashNet), creditCostEngine: r3(creditCostEngine), perCreditPrice: r3(engineCost > 0 ? creditCostEngine / engineCost : null), perCreditDecision: r3(pt && !pt.missing && engineCost > 0 ? -Number(pt.credits) / engineCost : null) },
      priceTrashRaw: raw > 0,
      fine: r3all(fp?.fine),
      rigByCard: r3all(fp?.byCard),
      fineGap: fp?.fineGap ? r3all(fp.fineGap) : null,
      pricedOut: fp?.pricedOut?.map((x: any) => ({ ...x, held: r3(x.held) })) ?? null,
      cardRate: r3all(fp?.cardRate),
      plus5: p5 ? { margin: r3(p5.margin), fine: r3all(p5.fine), cardRate: r3all(p5.cardRate) } : null,
      tips,
      rigSplit,
      conseq,
      creditsAfter,
      cheapest,
      z1,
      z2,
      lGap: r3(lGap),
      cls,
      sub,
      priceTrash,
      decisionTrash,
      agree: priceTrash === decisionTrash,
      dir: priceTrash === decisionTrash ? (priceTrash ? 'bothTrash' : 'bothKeep') : priceTrash ? 'priceTrash/decisionKeep' : 'priceKeep/decisionTrash',
    };
  });
}

// ------------------------------------------------------------------------------------------------ Part A item 3: the Corp's side
const CORP = process.env.CORP === '1';
let corpIdx = 0;
/**
 * One Corp decision of a source game (the move the playing Corp made at `s`): every legal answer (a prompt) or main action
 * scored on a copy, prompts as the fall-through scores them (scoreOutcome, synergy on; followChain and freeRezSaving left
 * out), main actions by the one-step board score (evaluate after less before: a proxy, the Corp picks main actions by its
 * planner). A record only where the chosen move and the best other one differ in leaving the Corp at 0 or 1 credits.
 */
function corpAsk(pool: string, src: string, s0: GameState, made: GameAction) {
  const s = structuredClone(s0);
  const prompt = E.core.activePrompt(s);
  const isPrompt = !!prompt && prompt.side === 'corp';
  if (prompt && !isPrompt) return;
  const all = E.core.getLegalActions(s, 'corp') as GameAction[];
  const legal = isPrompt ? all.filter(a => a.type === 'RESOLVE_PROMPT') : all.filter(a => a.type !== 'RESOLVE_PROMPT');
  if (legal.length < 2) return;
  E.clear();
  E.pricing.asSide('corp', () => {
    E.handValues.decisionContext(s, 'corp');
    const afters = legal.map(a => ({ a, after: E.prompts.simulate(s, a) as GameState | null })).filter(x => x.after) as { a: GameAction; after: GameState }[];
    const chosen = afters.find(x => key(x.a) === key(made));
    const low = (x: { after: GameState }) => x.after.corp.credits <= 1;
    if (!chosen) return out({ kind: 'c', pool, src, i: corpIdx++, T: s.turnNumber, prompt: isPrompt, unmatched: true });
    if (!afters.some(x => low(x) !== low(chosen))) return;
    const scoreOf = (after: GameState) => {
      const cap: any = { active: !isPrompt };
      G.__trCap = cap;
      try {
        const total = isPrompt ? (E.prompts.scoreOutcome(s, after, 'corp', undefined, true) as number) : (E.evaluate.evaluate(after, 'corp') as number);
        const hand = cap.corp?.handClicks ?? null;
        const clicks = (E.handValues.clickPrice(after, 'corp', 'corp') as number) * after.corp.clicks;
        return { total, hand, clicks, keep: isPrompt ? cap.handKeep ?? 0 : 0, credits: after.corp.credits };
      } finally {
        G.__trCap = undefined;
      }
    };
    const sc = afters.map(x => ({ ...x, s: scoreOf(x.after) }));
    const ch = sc.find(x => x.a === chosen.a)!;
    const others = sc.filter(x => x !== ch).sort((a, b) => b.s.total - a.s.total);
    const other = others[0];
    const top = sc.reduce((b, x) => (x.s.total > b.s.total ? x : b), sc[0]);
    if (low(other) === low(ch)) return;
    const margin = ch.s.total - other.s.total;
    const hand = ch.s.hand !== null && other.s.hand !== null ? ch.s.hand - other.s.hand : null;
    const keepD = ch.s.keep - other.s.keep;
    const own = hand === null ? null : hand - (ch.s.clicks - other.s.clicks);
    const tip = (part: number | null) => (part === null ? null : margin - part > 0 !== margin > 0);
    const name = (a: GameAction) => {
      const x: any = a;
      const id = x.cardInstanceId ?? x.choice?.optionId ?? x.choice?.cardInstanceIds?.join('+') ?? '';
      const c = typeof id === 'string' && id.startsWith('inst-') ? E.core.findCardAnywhere(s, id) : null;
      return `${x.type}${x.choice?.kind ? ':' + x.choice.kind : ''}${c ? ' ' + def(E, c).title : id ? ' ' + id : ''}${x.serverId ? '@' + x.serverId : ''}`;
    };
    out({
      kind: 'c',
      pool,
      src,
      i: corpIdx++,
      T: s.turnNumber,
      prompt: isPrompt,
      promptKind: isPrompt ? prompt.kind : null,
      credits: s.corp.credits,
      n: sc.length,
      chosen: { a: name(ch.a), low: low(ch), credits: ch.s.credits, total: r3(ch.s.total) },
      other: { a: name(other.a), low: low(other), credits: other.s.credits, total: r3(other.s.total) },
      chosenIsTop: top === ch,
      margin: r3(margin),
      handEval: r3(hand),
      handOwn: r3(own),
      keep: r3(keepD),
      tipsHand: tip(hand === null ? null : hand + keepD),
      tipsHandEval: tip(hand),
      tipsKeep: isPrompt ? tip(keepD) : null,
      tipsOwn: tip(own),
    });
  });
}

// ------------------------------------------------------------------------------------------------ the pairs (pairs tree)
function seedFor(k: number, base: number): number {
  let h = (2166136261 ^ base) >>> 0;
  h = Math.imul(h ^ (k * 0x9e3779b1), 16777619) >>> 0;
  return h;
}

/** One answer forced on a copy of `s0` and both sides played on by their Normal agents to the end of the game. */
function playOn(s0: GameState, trash: boolean, k: number, memory: Map<string, string>, cardId: string, cardCode: string) {
  let s = structuredClone(s0);
  if (k > 0) {
    // HIDDEN-READ (the measuring script): seed k reshuffles R&D and the stack and reseeds the game's rng, both arms alike
    const seed = seedFor(k, s.rng.seed);
    s.id = `${s.id}~${k}`;
    s.rng = P.core.createRng(seed);
    P.core.shuffleInPlace(s.rng, s.corp.rd);
    P.core.shuffleInPlace(s.rng, s.runner.stack);
  }
  const p = P.core.activePrompt(s);
  s = P.core.executeAction(s, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'access_trash', trash } });
  P.clear();
  const runner: any = P.createAgent('runner', 'normal');
  runner.memory = new Map(memory);
  const g = new P.GameRunner(s, { runner, corp: P.createAgent('corp', 'normal') });
  const T = s0.turnNumber;
  const logAt = s.log.length;
  let at2: any = null;
  let at4: any = null; // R-14h: four turns on as well (the Corp side's case 3a)
  let steps = 0;
  // The card's payouts taken (an approximation, said so in the hand-off): credits that left its hosted credits, plus the
  // Corp's credit gain on a step whose action names the card (its click ability), until the snapshot
  const installed = (st: GameState): CardInstance | undefined => (Object.values(st.corp.servers) as any[]).flatMap(v => v.root).find((c: CardInstance) => c.instanceId === cardId);
  let paid = 0;
  const snap = (st: GameState) => {
    const lines = st.log.slice(logAt).filter((e: any) => e.cardCode === cardCode && e.player === 'corp');
    return { T: st.turnNumber, cc: st.corp.credits, rc: st.runner.credits, cs: st.corp.score - s0.corp.score, rs: st.runner.score - s0.runner.score, cardLines: lines.length, payout: paid, still: !!installed(st) };
  };
  for (; steps < 8000 && !g.state.winner; steps++) {
    if (!at2 && g.state.turnNumber > T + 2) at2 = snap(g.state);
    if (!at4 && g.state.turnNumber > T + 4) at4 = snap(g.state);
    const before = g.state;
    const h0 = Number(installed(before)?.tokens?.credit ?? 0);
    if (!g.step()) break;
    if (!at2) {
      const c1 = installed(g.state);
      const h1 = Number(c1?.tokens?.credit ?? 0);
      const named = (g.last as any)?.cardInstanceId === cardId && g.last?.player === 'corp';
      if (c1 && h1 < h0) paid += h0 - h1;
      else if (named) paid += Math.max(0, g.state.corp.credits - before.corp.credits);
    }
  }
  if (!at2) at2 = snap(g.state);
  if (!at4) at4 = snap(g.state);
  return { w: g.state.winner ?? null, cp: g.state.corp.score, rp: g.state.runner.score, at2, at4, steps, T: g.state.turnNumber };
}

function pairs(s0: GameState, memory: Map<string, string>, rec: any) {
  const u = unitPrompt(P, s0)!;
  const res: any[] = [];
  for (let k = 0; k < SEEDS; k++) {
    const t = timed('pairs', () => playOn(s0, true, k, memory, u.card.instanceId, u.card.cardCode));
    const kk = timed('pairs', () => playOn(s0, false, k, memory, u.card.instanceId, u.card.cardCode));
    res.push({ k, trash: t, keep: kk });
  }
  out({ kind: 'p', ...rec, pairs: res });
}

// ------------------------------------------------------------------------------------------------ sources
type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(rec.seed, c, r));
}

let wanted: Map<string, any> | null = null; // MODE=pairs: access key -> its count record

/** One unit access seen in a source game (count: read it; pairs: play it on if selected). */
function unit(pool: string, src: string, idx: number, s: GameState, answer: GameAction | null, memory: Map<string, string>, extra: Record<string, unknown> = {}) {
  const k = `${src}#${idx}`;
  if (MODE === 'pairs') {
    const w = wanted!.get(k);
    if (w) {
      // A re-read (an access the count run read before a field was added): its full record again, kind 'a2'
      if (w.reread) {
        try {
          const r = timed('read', () => read(s, new Map(memory)));
          const made = answer ? ((answer as any).choice?.alternativeId ? 'alt' : (answer as any).choice?.trash ? 'trash' : 'keep') : null;
          out({ kind: 'a2', pool, src, idx, T: s.turnNumber, key: k, ...extra, answer: made, answerTrash: answer ? answerTrashes(answer) : null, pickMatches: made === null ? null : r.decision.pick === made, ...r });
        } catch (err) {
          out({ kind: 'err', pool, src, idx, error: (err as Error).stack?.slice(0, 400) });
        }
      }
      if (w.pairs === false) {
        wanted!.delete(k);
        return;
      }
      try {
        pairs(s, new Map(memory), { pool, src, idx, T: s.turnNumber, cls: w.cls, dir: w.dir, card: w.card, rezzed: w.rezzed, control: !!w.control });
      } catch (err) {
        out({ kind: 'err', pool, src, idx, error: (err as Error).stack?.slice(0, 400) });
      }
      wanted!.delete(k);
    }
    return;
  }
  let r: any;
  try {
    r = timed('read', () => read(s, new Map(memory)));
  } catch (err) {
    out({ kind: 'err', pool, src, idx, T: s.turnNumber, error: (err as Error).stack?.slice(0, 400) });
    return;
  }
  const made = answer ? ((answer as any).choice?.alternativeId ? 'alt' : (answer as any).choice?.trash ? 'trash' : 'keep') : null;
  out({ kind: 'a', pool, src, idx, T: s.turnNumber, key: k, ...extra, answer: made, answerTrash: answer ? answerTrashes(answer) : null, pickMatches: made === null ? null : r.decision.pick === made, ...r });
}
const pendingIn = (src: string) => wanted === null || [...wanted.keys()].some(k => k.startsWith(`${src}#`));

/** A self-play deal on the play tree, watched from outside (nothing patched in the tree that plays). */
function deal(pool: string, rec: Rec, plain?: Tree) {
  const t0 = performance.now();
  const src = `${pool}:${rec.seed}`;
  if (!pendingIn(src)) return;
  PL.clear();
  const ag = { corp: PL.createAgent('corp', 'normal'), runner: PL.createAgent('runner', 'normal') };
  const g = new PL.GameRunner(dealStateOf(PL, rec), ag);
  let pg: any = null;
  if (plain) {
    plain.clear();
    pg = new plain.GameRunner(dealStateOf(plain, rec), { corp: plain.createAgent('corp', 'normal'), runner: plain.createAgent('runner', 'normal') });
  }
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let idx = 0;
  let firstDiff: number | null = null;
  corpIdx = 0;
  let steps = 0;
  for (let n = 0; n < 4000; n++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const u = unitPrompt(PL, s);
    const more = g.step();
    if (MODE === 'count' && CORP && more && g.last?.player === 'corp') {
      try {
        timed('corp', () => corpAsk(pool, src, s, g.last!));
      } catch (err) {
        out({ kind: 'err', pool, src, at: 'corp', error: (err as Error).stack?.slice(0, 300) });
      }
    }
    if (pg) {
      const pm = pg.step();
      if (firstDiff === null && (pm !== more || key(pg.last) !== key(g.last))) firstDiff = n;
    }
    if (!more) break;
    steps++;
    if (u && g.last?.player === 'runner') {
      // HIDDEN-READ: the deciding Runner's memory, copied for the asks
      unit(pool, src, idx++, s, g.last, (ag.runner as any).memory ?? new Map());
      if (MODE === 'pairs' && !pendingIn(src)) return;
    }
  }
  const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
  if (MODE === 'count') out({ kind: 'g', pool, src, steps, units: idx, matchesBatch: matches, ...(plain ? { plainSame: firstDiff === null, firstDiff } : {}), ms: Math.round(performance.now() - t0) });
}

/** A person's game (the person is the Runner): replayed; at each unit access the AI is asked on a copy, the person's answer recorded. */
function person(file: string) {
  const t0 = performance.now();
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const name = file.split('/').pop()!.replace('.json', '');
  const src = `people:${name}`;
  if (!pendingIn(src)) return;
  let s: GameState = PL.core.createInitialGameState(PL.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  if (r.startsAt === 'state') s = structuredClone(r.state);
  // A Normal Runner that watched every board: its memory only (it never plays)
  const watcher: any = PL.createAgent('runner', 'normal');
  let idx = 0;
  let answers = 0;
  for (const [j, move] of (r.moves as GameAction[]).entries()) {
    watcher.observe?.(s);
    const u = unitPrompt(PL, s);
    if ((move as any).type === 'RESOLVE_PROMPT' && (move as any).choice?.kind === 'access_trash') answers++;
    if (u && move.player === 'runner' && move.type === 'RESOLVE_PROMPT') {
      unit('people', src, idx++, s, move, watcher.memory ?? new Map(), { move: j, file: name, hardCorp: name === 'report-33' });
      if (MODE === 'pairs' && !pendingIn(src)) return;
    }
    try {
      s = PL.core.executeAction(s, move);
    } catch (e) {
      out({ kind: 'err', pool: 'people', src: name, at: j, error: (e as Error).message.slice(0, 120) });
      break;
    }
  }
  if (MODE === 'count') out({ kind: 'h', pool: 'people', src, units: idx, accessAnswers: answers, ms: Math.round(performance.now() - t0) });
}

/** The three fixtures: the pins' boards, a fresh Normal Runner that watched every board plays on (against a Normal Corp). */
function fixture(name: string) {
  const t0 = performance.now();
  const src = `fixtures:${name}`;
  if (!pendingIn(src)) return;
  const spec: Record<string, { file: string; until: number; at: (s: GameState, m: GameAction, j: number) => boolean }> = {
    // tests/runnerDecidedTwice.test.ts boardAt(58, 3): the first Runner run of T3; played to the end of T6
    '58': { file: 'tests/fixtures/runner-facts/issues/issue-58.json', until: 6, at: (s, m) => s.turnNumber === 3 && s.activePlayer === 'runner' && m.type === 'INITIATE_RUN' },
    // tests/runnerIssues64to66.test.ts boardAtRunnerTurnStart('issue-66', 4): T4's start; played to the end of T4
    '65': { file: 'tests/fixtures/runner-issues/issue-66.json', until: 4, at: s => s.turnNumber === 4 && s.activePlayer === 'runner' },
    // tests/runnerIssues67to68.test.ts boardBefore(67, 130); played to the end of T8
    '67': { file: 'tests/fixtures/runner-issues/issue-67.json', until: 8, at: (_s, _m, j) => j === 130 },
  };
  const f = spec[name];
  const r = JSON.parse(readFileSync(f.file, 'utf8'));
  let s: GameState = PL.core.createInitialGameState(PL.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  const runner: any = PL.createAgent('runner', 'normal');
  let start: GameState | null = null;
  for (const [j, move] of (r.moves as GameAction[]).entries()) {
    if (f.at(s, move, j)) {
      // As the pins: #67's board is observed before play, the others as their helpers do
      if (name !== '58') runner.observe?.(s);
      start = structuredClone(s);
      break;
    }
    runner.observe?.(s);
    s = PL.core.executeAction(s, move);
  }
  if (!start) throw new Error(`fixture ${name}: board not found`);
  PL.clear();
  const g = new PL.GameRunner(start, { runner, corp: PL.createAgent('corp', 'normal') });
  let idx = 0;
  for (let k = 0; k < 4000 && g.state.turnNumber <= f.until && !g.state.winner; k++) {
    const before = g.state;
    const u = unitPrompt(PL, before);
    if (!g.step()) break;
    if (u && g.last?.player === 'runner') {
      unit('fixtures', src, idx++, before, g.last, runner.memory ?? new Map());
      if (MODE === 'pairs' && !pendingIn(src)) return;
    }
  }
  if (MODE === 'count') out({ kind: 'h', pool: 'fixtures', src, units: idx, ms: Math.round(performance.now() - t0) });
}

async function main() {
  const dirs = makeTrees(root);
  PL = await loadTree('play', dirs.play);
  const e = await loadTree('eval', dirs.eval);
  const m = (p: string) => import(/* @vite-ignore */ join(dirs.eval, 'src', p));
  E = Object.assign(e, { prompts: await m('ai/prompts.ts'), planner: await m('ai/turnPlanner.ts'), reply: await m('ai/runnerReply.ts'), profiles: await m('ai/cardProfiles.ts'), plans: await m('ai/cardPlans.ts'), vm: await m('ai/valueModel.ts') });
  P = MODE === 'pairs' ? await loadTree('pairs', dirs.pairs) : (undefined as any);
  const plain = process.env.IDENT === '1' ? await loadTree('pairs', dirs.pairs) : undefined;
  if (MODE === 'pairs') {
    const list: any[] = JSON.parse(readFileSync(process.env.PAIRS ?? 'scripts/runner-rework/last-credits-pairs.json', 'utf8'));
    // Shard by access (each shard replays the sources of its own accesses)
    wanted = new Map(list.filter((_, i) => i % shards === shard).map(x => [x.key, x]));
  }
  const started = Date.now();
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch' || pool === 'nrdb') {
      const run = pool === 'batch' ? '45574713678' : '45593231799';
      const recs: Rec[] = JSON.parse(readFileSync(`scripts/runner-rework/last-credits-deals-${run}.json`, 'utf8'));
      for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, id: r });
    } else if (pool === 'people') {
      const dir = 'tests/fixtures/human-games';
      for (const f of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
        const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        if (r.config?.ai !== 'corp' || !r.moves?.length) continue;
        if (!FILES.length || FILES.some(x => f.includes(x))) sources.push({ pool, id: join(dir, f) });
      }
    } else if (pool === 'fixtures') {
      for (const n of ['58', '65', '67']) if (!FILES.length || FILES.includes(n)) sources.push({ pool, id: n });
    } else throw new Error(`unknown pool ${pool}`);
  }
  // count: shard by source; pairs: every shard walks the sources that hold its accesses
  for (const [k, src] of sources.entries()) {
    if (MODE === 'count' && k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (src.pool === 'people') person(src.id);
      else if (src.pool === 'fixtures') fixture(src.id);
      else deal(src.pool, src.id, plain);
    } catch (err) {
      out({ kind: 'err', pool: src.pool, src: typeof src.id === 'string' ? src.id : src.id.seed, error: (err as Error).stack?.slice(0, 500) });
    }
  }
  if (wanted?.size) out({ kind: 'err', missing: [...wanted.keys()] });
  const tm: Record<string, number> = {};
  for (const [k2, v] of Object.entries(timing)) tm[k2] = Math.round(v);
  out({ kind: 's', shard, mode: MODE, timing: tm, ms: Date.now() - started });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
