/**
 * R-A A-log: every place the Runner and the Corp read the same card fact differently (spec r-a.md, lines L1 to L12;
 * brief a-log.md rev 2, lines L13 and L14). Counts only: no src change, nothing fixed, nothing decided.
 * Spec: /mnt/project-files/netrunner-ai/runner-rework/specs/r-a.md; brief: ../briefs/a-log.md (rev 2).
 * Rewritten from Gemini's draft (branch gemini-runner-facts-log 14f44f3): its replay skeleton and pool switch are kept;
 * every line's reading is replaced (the draft's L3, L4, L7 and L12 counted by construction, its L9 money flag explained
 * every board, its L6 money pattern never matched, its L10 sampled after the turn's flags were reset).
 *
 * Sources (pool, kept apart everywhere):
 *  batch  the 221 deals of the g1 base 45086908053 (facts-deals-45086908053.json, winner/cr/sc checked: 'g' lines);
 *  nrdb   the 110 deals of the NRDB=1 g1 45198090232 (facts-deals-45198090232.json; same check);
 *  human  tests/fixtures/human-games (38 files), replayed move by move; `sk` humanRunner (a person ran) or humanCorp;
 *  issues the saved games of issues #58 and #59 (tests/fixtures/runner-facts/issues/), replayed as the human files.
 * The source games are played by the `source` tree (a plain GameRunner, never asked or cleared mid-game); every reader is
 * asked on the `eval` tree (facts-trees.ts: an export-only copy) on a structuredClone of the board.
 *
 * Boards (the brief's rev 2 point 7): a Runner turn-start board (the Runner's first main-phase decision of its turn):
 * L1 to L9, L12, L13 (every server); a run-start board (the board before the action that began a run): L9, L13, L14 for
 * the run's server; a turn-end board (the last board of a turn, before its flags reset): L10.
 *
 * HIDDEN-READ: the measuring script reads the Corp's unrezzed ice (L5: what the walk assumes for the same ice; L9 (a):
 * the ice priced exactly), the Runner's memory (L14: read, never asked) and the log of the Corp's gains (L14). No agent
 * reads them; every place is marked HIDDEN-READ.
 *
 *   SHARD=0/64 POOL=batch npx vite-node scripts/runner-rework/facts-log.ts
 *   ARGS="POOL=human LIMIT=10" npx vite-node scripts/runner-rework/facts-log.ts
 *   ARGS="POOL=batch,nrdb,human,issues" (several pools, one shard set)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree, makeTrees } from './facts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb,human,issues').split(',');
/** Stop after this many measured boards (any kind) in this shard: the timed sample of step 0. */
const LIMIT = Number(process.env.LIMIT ?? 0);
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const HUMAN = (process.env.HUMAN ?? '').split(',').filter(Boolean);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/facts-log', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number | null | undefined) => (x === null || x === undefined ? null : Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x > 0 ? 'Inf' : '-Inf');
const key = (a: unknown) => JSON.stringify(a ?? null);

let T: Tree; // eval tree
let boards = 0;
const timing: Record<string, number> = {};
const timed = <X>(k: string, f: () => X): X => {
  const t0 = performance.now();
  try {
    return f();
  } finally {
    timing[k] = (timing[k] ?? 0) + performance.now() - t0;
  }
};

// ------------------------------------------------------------------------------------------------ card codes
const SEVEN: Record<string, string> = {
  '30004': 'Botulus',
  '30017': 'Tranquilizer',
  '34082': 'Physarum Entangler',
  '30054': 'Funhouse',
  '34035': 'Jaguarundi',
  '34118': 'Seraph',
  '36052': 'Paywall',
};
const MYCOWEB = '35053';
const MALANDRAGEM = '34081';

/** The 25 card codes of count 1's B3 (its "26" counts Botulus and Tranquilizer's shared line twice), the seven cards' other three, and Mycoweb (L12). */
export const CASE_CODES: Record<string, string> = {
  '34077': 'Window of Opportunity',
  '30028': 'Jailbreak',
  '36022': 'Read-Write Share',
  '30004': 'Botulus',
  '30017': 'Tranquilizer',
  '30032': 'Mayfly',
  '35068': 'BANGUN',
  '35008': 'Hantu',
  '34004': 'Audrey v2',
  '34005': 'Banner',
  '34090': 'Lobisomem',
  '34092': 'Pressure Spike',
  '36004': 'Corsair',
  '34026': 'Slap Vandal',
  '34082': 'Physarum Entangler',
  '30054': 'Funhouse',
  '34012': 'S-Dobrado',
  '34078': 'Alarm Clock',
  '30042': 'Manegarm Skunkworks',
  '35061': 'Idiosyncresis',
  '34081': 'Malandragem',
  '34016': 'Laser Pointer',
  '34015': 'Curupira',
  '35021': 'Fransofia Ward',
  '36001': 'Chain Reaction',
  '34035': 'Jaguarundi',
  '34118': 'Seraph',
  '36052': 'Paywall',
  '35053': 'Mycoweb',
};
/** The case codes where a reader can read them on this board: the identities, the Runner's rig and grip, the Corp's installed cards the Runner knows. */
function metCodes(s: GameState): string[] {
  const here = [
    s.corp.identity,
    s.runner.identity,
    ...rigOf(s),
    ...s.runner.grip,
    ...Object.values(s.corp.servers)
      .flatMap(sv => [...sv.ice, ...sv.root])
      .filter(c => c.isRezzed || c.runnerKnows || c.faceUp),
  ];
  return [...new Set(here.filter(c => c && CASE_CODES[c.cardCode]).map(c => c.cardCode))];
}

// ------------------------------------------------------------------------------------------------ helpers
const rigOf = (s: GameState) => [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
const allIce = (s: GameState) => Object.values(s.corp.servers).flatMap(sv => sv.ice);
const def = (c: CardInstance | string) => T.core.getCardDefinition(typeof c === 'string' ? c : c.cardCode);
const asRunner = <X>(s: GameState, f: () => X): X =>
  T.pricing.asSide('runner', () => {
    T.handValues.decisionContext(s, 'runner');
    return f();
  });
const asCorp = <X>(s: GameState, f: () => X): X =>
  T.pricing.asSide('corp', () => {
    T.handValues.decisionContext(s, 'corp');
    return f();
  });
const safe = <X>(f: () => X, dflt: X): X => {
  try {
    return f();
  } catch {
    return dflt;
  }
};
/** The board with every installed Corp card's identity public (L9: rule-free, the Runner's price reads its own facts). */
function publicBoard(s: GameState): GameState {
  const b = structuredClone(s);
  for (const sv of Object.values(b.corp.servers)) for (const c of [...sv.ice, ...sv.root]) c.runnerKnows = true;
  return b;
}

/**
 * The credits the Runner's grip can make this turn (the walk does not model the grip: plan section 5 (a)): events whose
 * text is "Gain N credits" (Sure Gamble, Creative Commission...), net of their cost, one a click after the run's click,
 * best first, each affordable when played. The rest of the turn's clicks are runnerEarnings' (the walk's money).
 */
function gripMoney(s: GameState, clicksForMoney: number): { credits: number; cards: number } {
  const nets = s.runner.grip
    .map(c => {
      const d = def(c);
      const m = d.type_code === 'event' ? /\bgain (\d+) credits\b/i.exec(d.stripped_text ?? '') : null;
      return m ? { cost: d.cost ?? 0, net: Number(m[1]) - (d.cost ?? 0) } : null;
    })
    .filter((x): x is { cost: number; net: number } => !!x && x.net > 0)
    .sort((a, b) => b.net - a.net);
  let credits = s.runner.credits;
  let gained = 0;
  let used = 0;
  for (const n of nets) {
    if (used >= clicksForMoney) break;
    if (n.cost > credits) continue;
    credits += n.net;
    gained += n.net;
    used++;
  }
  return { credits: gained, cards: nets.length };
}

// ------------------------------------------------------------------------------------------------ L1, L2, L4: subroutines
const alwaysEnds = (f: any) => !f.when && !f.unless && (!!f.orEndRun || f.does.some((e: any) => e.kind === 'endRun' && !e.if));
const anyEnds = (f: any) => !!f.orEndRun || f.does.some((e: any) => e.kind === 'endRun') || f.does.some((e: any) => e.kind === 'corpMayTrashHqToEndRun');
const nOf = (n: any, s: GameState) => (n === 'runnerTags' ? s.runner.tags : Number(n));
/** The damage SUB_RULES' first matching price rule reads from the label (the number its own pattern captures). */
function subRulesDamage(s: GameState, label: string): number | null {
  for (const [re, price] of T.runs.__SUB_RULES as [RegExp, (st: GameState, m: RegExpMatchArray) => unknown, unknown][]) {
    const m = label.match(re);
    if (!m) continue;
    const p = price(s, m);
    if (typeof p === 'symbol') continue; // NEXT
    if (!/damage/.test(re.source)) return 0;
    if (/do x net damage/.test(re.source)) return s.runner.tags;
    if (/if the runner has at least 2 tags/.test(re.source)) return s.runner.tags >= 2 ? 2 : 0;
    if (/core damage/.test(re.source)) return Number(m[1] ?? 1);
    return Number(m[1]);
  }
  return null; // no rule knows it (priced 2)
}
function factsDamage(s: GameState, f: any): number {
  let d = 0;
  for (const e of f.does) if (e.kind === 'damage') d += nOf(e.n, s);
  if (f.unless?.netDamage) d += f.unless.netDamage;
  return d;
}

interface SubRead {
  ice: string;
  code: string;
  i: number;
  label: string;
}
function subsOf(s: GameState): (SubRead & { ref: CardInstance })[] {
  const list: (SubRead & { ref: CardInstance })[] = [];
  for (const ice of allIce(s)) {
    if (!ice.isRezzed && !ice.runnerKnows) continue;
    const subs = safe(() => T.ice.iceSubroutines(s, ice.isRezzed ? ice : { ...ice, isRezzed: true }), [] as any[]);
    subs.forEach((sub: any, i: number) =>
      list.push({
        ice: ice.instanceId,
        code: ice.cardCode,
        i,
        label: sub.label,
        ref: ice,
      })
    );
  }
  return list;
}

function lSubs(s: GameState) {
  const l1: any[] = [];
  const l2: any[] = [];
  const l4: any[] = [];
  let l1Met = 0;
  let l2Met = 0;
  let l4Met = 0;
  const hasProgram = s.runner.rig.programs.length > 0;
  for (const r of subsOf(s)) {
    const f = T.runs.subroutineFacts(r.label);
    // L1: the five encodings of "this subroutine ends the run"
    const e = {
      blocks: asRunner(s, () => T.runs.subroutineBlocks(s, r.label)) as boolean, // SUB_RULES' third column (board-read)
      factsAlways: alwaysEnds(f), // subroutineFacts, read by the walk as "always ends"
      factsAny: anyEnds(f), // subroutineFacts, any end (conditional or the Corp's choice)
      hasEtr: /end the run/i.test(r.label), // corp/rez.ts hasEndTheRun's test, per subroutine
      literal: /^end the run\.?$/i.test(r.label.trim()), // breakPlans' all-ETR barrier test and Banner's (runnerAI encounterAction): the same regex
    };
    l1Met++;
    const vals = [e.blocks, e.factsAlways, e.factsAny, e.hasEtr, e.literal];
    if (!vals.every(v => v === vals[0])) l1.push({ ...pick(r), e: vals.map(v => (v ? 1 : 0)).join('') });
    // L2: the damage a subroutine does, three readers
    const d1 = T.runs.__subroutineDamage(r.label, s.runner.tags) as number;
    const d2 = subRulesDamage(s, r.label);
    const d3 = factsDamage(s, f);
    if (d1 > 0 || (d2 ?? 0) > 0 || d3 > 0) {
      l2Met++;
      if (d1 !== d3 || (d2 !== null && d2 !== d1))
        l2.push({
          ...pick(r),
          tags: s.runner.tags,
          sub: d1,
          rules: d2,
          facts: d3,
        });
    }
    // L4: "X or end the run" and like choices: the Runner's price against the walk's answer (the end, ruling 6)
    if (f.orEndRun || /\bor end the run\b/i.test(r.label)) {
      l4Met++;
      const price = asRunner(s, () => T.runs.subroutineCost(s, r.label)) as number;
      const runnerEnds = price === Infinity;
      const walkEnds = !!f.orEndRun; // the walk takes the end where facts say orEndRun
      if (runnerEnds !== walkEnds)
        l4.push({
          ...pick(r),
          program: hasProgram,
          price: r3(price),
          walkEnds,
        });
    }
  }
  return { l1Met, l1, l2Met, l2, l4Met, l4 };
}
const pick = (r: SubRead) => ({
  ice: r.ice,
  code: r.code,
  i: r.i,
  label: r.label.slice(0, 90),
});

// ------------------------------------------------------------------------------------------------ L3: the seven cards
function hostOf(s: GameState, c: CardInstance): CardInstance | undefined {
  return c.hostedOnId ? allIce(s).find(i => i.instanceId === c.hostedOnId) : undefined;
}
function lSeven(s: GameState) {
  const rows: any[] = [];
  const hf = (code: string) => T.cards[code]?.holdFacts;
  for (const c of s.runner.rig.programs) {
    if (!SEVEN[c.cardCode] || !c.hostedOnId) continue;
    const host = hostOf(s, c);
    if (!host) continue;
    const f = hf(c.cardCode);
    if (c.cardCode === '30004') {
      // Botulus: the walk breaks one subroutine a hosted counter of the fact's kind; the Runner's botulusBreaks reads virus counters
      const walk = f?.breaksHostSubroutine ? T.effects.counters(c, f.breaksHostSubroutine.counter) : 0;
      const runner = T.runs.botulusBreaks(s, host) as number;
      const hostedSame = T.runs.hostedTrojans(s, host, '30004').reduce((n: number, x: CardInstance) => n + T.effects.counters(x, 'virus'), 0);
      rows.push({
        code: c.cardCode,
        fact: 'subroutines broken on the host',
        walk: walk,
        runner: hostedSame === walk ? runner : runner,
        perCard: walk,
        factSame: !!f?.breaksHostSubroutine,
        numSame: runner === hostedSame && walk === T.effects.counters(c, 'virus'),
        hostRezzed: host.isRezzed,
      });
    } else if (c.cardCode === '30017') {
      // Tranquilizer: the walk derezzes its host at the Runner's turn start once it holds derezHostAt counters; the Runner's
      // price of it (trojanHostValue) reads no counter: a flat 1 + 0.15 x min(iceStop, iceCost), less 3 a second copy
      const at = f?.runnerTurnStart?.derezHostAt ?? null;
      const n = T.effects.counters(c, 'virus');
      const walkDerezNext = at !== null && n + (f?.runnerTurnStart?.counters?.n ?? 0) >= at;
      rows.push({
        code: c.cardCode,
        fact: 'derez the host at N counters',
        walk: at,
        runner: 'none read (trojanHostValue: flat, runnerAI.ts)',
        counters: n,
        walkDerezNext,
        factSame: false,
        numSame: null,
        hostRezzed: host.isRezzed,
      });
    } else if (c.cardCode === '34082') {
      // Physarum: hostBypass { creditsPerSubroutine, unlessSubtype } against physarumCost (1 a subroutine, not a barrier, within runBudget)
      const subs = host.isRezzed ? (T.runs.plannedSubroutines(s, host) as any[]).length : null;
      const barrier = (T.ice.iceSubtypes(host, s) as string[]).includes(f?.hostBypass?.unlessSubtype ?? 'barrier');
      const walk = host.isRezzed && f?.hostBypass && !barrier ? f.hostBypass.creditsPerSubroutine * (subs ?? 0) : null;
      const runner = asRunner(s, () => T.runs.physarumCost(s, host)) ?? null;
      rows.push({
        code: c.cardCode,
        fact: 'bypass the host for credits a subroutine',
        walk,
        runner,
        budget: asRunner(s, () => T.runs.runBudget(s)),
        factSame: f?.hostBypass?.unlessSubtype === 'barrier' && f?.hostBypass?.creditsPerSubroutine === 1,
        numSame: walk === runner,
        hostRezzed: host.isRezzed,
      });
    }
  }
  for (const ice of allIce(s)) {
    if (!SEVEN[ice.cardCode] || !(ice.isRezzed || ice.runnerKnows)) continue;
    const f = hf(ice.cardCode)?.encounter;
    if (ice.cardCode === '30054') {
      // Funhouse: the walk's toll (the run ends unless 1 tag) against the Runner's plainIcePrice tagCost (its worth of a tag)
      const tag = asRunner(s, () => T.runs.tagCost(s)) as number;
      rows.push({
        code: ice.cardCode,
        fact: 'on encounter: a tag or the run ends',
        walk: f ? { toll: f.toll, unless: f.unless } : null,
        runner: { tagWorth: r3(tag), tags: 1 },
        factSame: !!f?.toll?.endRun && f?.unless?.tags === 1,
        numSame: f?.unless?.tags === 1,
        rezzed: ice.isRezzed,
      });
    } else {
      // Jaguarundi, Seraph, Paywall: encounter effects; the Runner prices only their subroutines (SUB_RULES text patterns):
      // the encounter clause is read by no Runner reader (its icePrice holds no term for it)
      const subLabels = (safe(() => T.ice.iceSubroutines(s, ice.isRezzed ? ice : { ...ice, isRezzed: true }), [] as any[]) as any[]).map(x => x.label);
      const encounterText = /when the runner encounters this ice[^.]*\./i.exec(def(ice).stripped_text ?? '')?.[0] ?? null;
      const runnerReads = subLabels.some(l => encounterText && l.toLowerCase().includes(encounterText.toLowerCase().slice(0, 30)));
      rows.push({
        code: ice.cardCode,
        fact: 'on encounter',
        walk: f ?? null,
        runner: runnerReads ? 'a subroutine pattern' : 'none read',
        text: encounterText?.slice(0, 120),
        threat: safe(() => T.effects.threatLevel(s), null),
        factSame: runnerReads,
        numSame: null,
        rezzed: ice.isRezzed,
      });
    }
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ L5: unrezzed ice
function lUnrezzed(s: GameState) {
  const rows: any[] = [];
  for (const sv of Object.values(s.corp.servers)) {
    for (const ice of sv.ice) {
      if (ice.isRezzed) continue;
      const flat = asRunner(s, () => T.runs.icePrice(s, ice)) as {
        credits: number;
        value: number;
      };
      const risk = asRunner(s, () => T.runs.unrezzedDamageRisk(s, ice)) as number;
      // HIDDEN-READ: the ice as the walk meets it (its identity, rezzed on approach when the Corp pays: ruling 6)
      const rezzed = { ...ice, isRezzed: true };
      const exact = asRunner(s, () => T.runs.icePrice(s, rezzed)) as {
        credits: number;
        value: number;
      };
      const canRez = s.corp.credits >= safe(() => T.effects.rezCost(s, ice), Infinity);
      const kind = !canRez
        ? 'corpCannotRez'
        : exact.credits === Infinity
          ? 'exactBlocks'
          : Math.abs(exact.credits - flat.credits) < 1e-9
            ? 'sameCredits'
            : exact.credits > flat.credits
              ? 'exactMore'
              : 'exactLess';
      rows.push({
        ice: ice.instanceId,
        code: ice.cardCode,
        known: !!ice.runnerKnows,
        flat: r3(flat.credits),
        risk: r3(risk),
        exact: r3(exact.credits),
        exactValue: r3(exact.value),
        canRez,
        kind,
      });
    }
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ L6: money
function lMoney(s: GameState) {
  const runBudget = asRunner(s, () => T.runs.runBudget(s)) as number; // runScore's budget (credits now + run-only hosted)
  const from = T.hold.restOfTurn(s);
  const walk = T.hold.runnerBudget(s, from) as number; // the walk's: credits + runnerEarnings over the clicks but the run's
  const iceStopFlat = s.runner.credits + T.iceValues.RUNNER_TURN_INCOME; // iceStop's flat 4 a turn
  const locked = s.runner.rig.resources.concat(s.runner.rig.hardware).some(c => /\bAircheck\b|\bWhitespace\b/i.test(def(c).title));
  const grip = gripMoney(s, Math.max(0, s.runner.clicks - 1));
  return {
    credits: s.runner.credits,
    runBudget: r3(runBudget),
    walk: r3(walk),
    iceStopFlat,
    gripMoney: grip.credits,
    gripMoneyCards: grip.cards,
    locked,
  };
}

// ------------------------------------------------------------------------------------------------ L7: run-begin cards
function lRunBegin(s: GameState) {
  const rows: any[] = [];
  const runBudget = asRunner(s, () => T.runs.runBudget(s)) as number;
  for (const c of rigOf(s)) {
    const f = T.cards[c.cardCode]?.holdFacts;
    if (!f || !(f.runBeginCredits || f.firstRunTrashForCost || f.counterCredits)) continue;
    // The walk's reading of the card on a run (its holdFacts), and what the Runner's price of the same run reads of it
    const walk = f.counterCredits ? T.hold.counterCredits(c) : f.runBeginCredits ? f.runBeginCredits.place : f.firstRunTrashForCost ? 'trash for printed cost' : null;
    const inRunBudget = !!T.core.getCardScript(c.cardCode)?.paysDuringRuns;
    rows.push({
      code: c.cardCode,
      field: Object.keys(f)
        .filter(k => ['runBeginCredits', 'firstRunTrashForCost', 'counterCredits'].includes(k))
        .join('+'),
      walk,
      runnerReads: inRunBudget ? 'runBudget (paysDuringRuns)' : 'nothing',
      runBudgetOver: r3(runBudget - s.runner.credits),
    });
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ L8, L9: per server
/** The Runner's feasibility (red team A6): runScore's price part with the breach's worth set aside. */
function runnerCanGetIn(s: GameState, id: string, budgetOverride?: number): { can: boolean; why: string; known: number; budget: number } {
  const server = s.corp.servers[id];
  const bypassed = T.runs.runBypasses(s, id) as {
    ids: Set<string>;
    price: number;
  };
  const prices = T.runs.__runPrices(
    s,
    server.ice.filter((ice: CardInstance) => !bypassed.ids.has(ice.instanceId))
  ) as Map<string, any> | null;
  const budget = budgetOverride ?? (T.runs.runBudget(s) as number);
  if (!prices) return { can: false, why: 'flatline', known: Infinity, budget };
  let known = 0;
  for (const ice of server.ice) {
    if (bypassed.ids.has(ice.instanceId)) continue;
    const p = prices.get(ice.instanceId) ?? T.runs.icePrice(s, ice);
    if (p.credits + p.value === Infinity) return { can: false, why: 'block', known: Infinity, budget };
    if (ice.isRezzed) known += p.credits;
  }
  if (known > budget) return { can: false, why: 'credits', known, budget };
  const approach = T.runs.approachCost(s, id, s.runner.clicks - 1 - T.runs.bioroidClicks(s, server.ice), budget - known);
  if (!approach) return { can: false, why: 'approach', known, budget };
  return { can: true, why: 'in', known, budget };
}
/** The board with these unrezzed ice rezzed (a structuredClone: L9's policy (a) and (b) boards; HIDDEN-READ, the identities). */
function withRezzed(s: GameState, ids: Set<string>): GameState {
  const b = structuredClone(s);
  for (const sv of Object.values(b.corp.servers)) for (const c of sv.ice) if (ids.has(c.instanceId)) c.isRezzed = true;
  return b;
}

function lServer(s: GameState, id: string, pub: GameState, money: { gripMoney: number }) {
  const sv = s.corp.servers[id];
  const res: any = {
    id,
    ice: sv.ice.length,
    rezzed: sv.ice.filter(c => c.isRezzed).length,
    root: sv.root.length,
  };
  // L8: rig bypasses: the Runner's price (runBypasses on the board) against the walk's (runBypasses on its rez set's board, its clicks)
  const rb = asRunner(s, () => T.runs.runBypasses(s, id)) as {
    ids: Set<string>;
    price: number;
  };
  // L9: feasibility both sides, on the board with every identity public
  T.clear();
  const runner = asRunner(pub, () => runnerCanGetIn(pub, id));
  T.clear();
  T.hold.CHECK.runnerExtra = money.gripMoney; // the walk given the Runner's real grip money (brief: "the walk given the Runner's real grip money")
  let hold: any;
  try {
    hold = asCorp(pub, () =>
      T.hold.serverHold(pub, id, {
        when: 'restOfTurn',
        corpCredits: pub.corp.credits,
      })
    );
  } finally {
    T.hold.CHECK.runnerExtra = 0;
  }
  const walkSet: string[] = hold.holds ? (hold.rez ?? []) : (hold.rezMost ?? []);
  // The walk's bypasses on its own set's board (as runTarget reads them: the set rezzed, the turn's clicks but the run's)
  const setBoard = withRezzed(s, new Set(walkSet));
  const walkByp = asCorp(setBoard, () => T.runs.runBypasses(setBoard, id)) as {
    ids: Set<string>;
  };
  if (rb.ids.size || walkByp.ids.size)
    res.l8 = {
      runner: [...rb.ids],
      runnerPrice: r3(rb.price),
      walk: [...walkByp.ids],
      walkSet,
      same: key([...rb.ids].sort()) === key([...walkByp.ids].sort()),
    };
  res.l9 = {
    runner: runner.can,
    why: runner.why,
    known: r3(runner.known),
    budget: r3(runner.budget),
    holds: hold.holds,
    need: r3(hold.need),
    walkBudget: r3(hold.budget),
    walkSet,
  };
  if (runner.can === hold.holds) {
    // a difference: the Runner says it gets in and the walk says it holds, or the Runner says no and the walk says it gets in
    const unrezzed = new Set(sv.ice.filter(c => !c.isRezzed).map(c => c.instanceId));
    const explain: Record<string, boolean> = {};
    // (a) the ice priced exactly: every unrezzed ice the Corp could rez, as rezzed (the flat guess removed)
    const canRez = new Set(
      [...unrezzed].filter(x => {
        const c = sv.ice.find(i => i.instanceId === x)!;
        return pub.corp.credits >= safe(() => T.effects.rezCost(pub, c), Infinity);
      })
    );
    T.clear();
    explain.unrezzedFlat = unrezzed.size > 0 && asRunner(pub, () => runnerCanGetIn(withRezzed(pub, canRez), id)).can !== hold.holds;
    // (b) the walk's rez set given to the Runner's reading
    T.clear();
    explain.rezChoice = asRunner(pub, () => runnerCanGetIn(withRezzed(pub, new Set(walkSet)), id)).can !== hold.holds;
    // (c) the Runner's reading given the walk's money (runnerEarnings over the turn, plus the grip money the walk was given,
    // plus the run-only hosted credits runBudget counts and the walk's runCredits adds itself)
    T.clear();
    const runOnly = (asRunner(pub, () => T.runs.runBudget(pub)) as number) - pub.runner.credits;
    explain.money = asRunner(pub, () => runnerCanGetIn(pub, id, hold.budget + runOnly)).can !== hold.holds;
    res.l9.explain = explain;
    res.l9.unexplained = !explain.unrezzedFlat && !explain.rezChoice && !explain.money;
  }
  return res;
}

// ------------------------------------------------------------------------------------------------ L13: bioroid clicks
function lBioroid(s: GameState, id: string): any {
  const sv = s.corp.servers[id];
  const bios = sv.ice.filter(c => c.isRezzed && T.ice.isBioroid(c));
  if (!bios.length) return null;
  const bypassed = asRunner(s, () => T.runs.runBypasses(s, id)) as {
    ids: Set<string>;
  };
  const prices = asRunner(s, () =>
    T.runs.__runPrices(
      s,
      sv.ice.filter(c => !bypassed.ids.has(c.instanceId))
    )
  ) as Map<string, any> | null;
  let sum = 0;
  const each: any[] = [];
  for (const ice of bios) {
    if (bypassed.ids.has(ice.instanceId) || !prices) continue;
    const price = prices.get(ice.instanceId);
    const subs = (T.runs.plannedSubroutines(s, ice) as any[]).length - (T.runs.botulusBreaks(s, ice) as number);
    const self = asRunner(s, () => T.runs.__selfBreakPrice(s, ice, Math.max(0, subs))) as { credits: number; value: number };
    // The price takes the click-break when its chosen way past is the self-break (credits 0, the same value)
    const byClicks = !!price && price.credits === 0 && self.credits === 0 && Number.isFinite(self.value) && Math.abs(price.value - self.value) < 1e-9 && !price.damage;
    const clicks = byClicks ? T.runs.bioroidBreakClicks(ice, Math.max(0, subs)) : 0;
    sum += clicks;
    each.push({ code: ice.cardCode, clicks, byClicks });
  }
  const after = s.runner.clicks - 1;
  if (sum === 0) return { sum, after, each };
  const score = asRunner(s, () => T.runs.runScore(s, id)) as number;
  const feas = asRunner(s, () => runnerCanGetIn(s, id));
  return {
    sum,
    after,
    over: sum > after,
    scoreFinite: Number.isFinite(score),
    score: r3(score),
    feasible: feas.can,
    each,
  };
}

// ------------------------------------------------------------------------------------------------ L12: Mycoweb's lenders
function lMycoweb(s: GameState): any[] {
  const rows: any[] = [];
  for (const sv of Object.values(s.corp.servers)) {
    for (const my of sv.ice) {
      if (my.cardCode !== MYCOWEB || !my.isRezzed) continue;
      for (const subtype of ['sentry', 'code gate']) {
        // The card's text (the engine, rezzedOfSubtype): a rezzed ice of that subtype with subroutines, "another" for code gate
        const engine = allIce(s)
          .filter(c => c.isRezzed && c !== my && (T.ice.iceSubtypes(c, s) as string[]).includes(subtype) && (T.ice.iceSubroutines(s, c) as any[]).length > 0)
          .filter(c => !(subtype === 'code gate' && c.instanceId === my.instanceId))
          .map(c => c.instanceId);
        // The engine's rezzedOfSubtype compares `c !== except` (the object): Mycoweb itself is a lender unless excepted; the
        // sentry sub has no except. Kept as the engine reads it: the code gate sub excepts the Mycoweb resolving it.
        const runnerSubs = asRunner(s, () => T.runs.__borrowedSubroutines(s, subtype)) as any[];
        const runner = allIce(s)
          .filter(
            c =>
              c.isRezzed &&
              (T.ice.iceSubtypes(c, s) as string[]).includes(subtype) &&
              (T.ice.iceSubroutines(s, c) as any[]).some((x: any) => !/resolve 1 subroutine on/i.test(x.label))
          )
          .map(c => c.instanceId);
        // The walk's lenders at the turn's start: rezzed, less the ice its start derezzes (Tranquilizer's host at its count, Lycian)
        const start = safe(() => T.hold.walkStart(s, true, false), null as any);
        const derezzed: Set<string> = start?.derezzed ?? new Set();
        const walk = allIce(s)
          .filter(c => c.isRezzed && !derezzed.has(c.instanceId) && (T.ice.iceSubtypes(c, s) as string[]).includes(subtype))
          .map(c => c.instanceId);
        const unrezzedOfType = allIce(s).filter(c => !c.isRezzed && (T.ice.iceSubtypes(c, s) as string[]).includes(subtype)).length;
        const same = key(engine.sort()) === key(runner.sort()) && key(runner) === key(walk.sort());
        rows.push({
          mycoweb: my.instanceId,
          subtype,
          engine,
          runner,
          walk,
          runnerSubs: runnerSubs.length,
          unrezzedOfType,
          derezzedLender: walk.length < runner.length,
          same,
        });
      }
    }
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ L10: once-per-turn flags
function lOnce(s: GameState, side: string) {
  const mine = new Map([...rigOf(s), ...(s.runner.identity ? [s.runner.identity] : [])].map(c => [c.instanceId, c]));
  const rows: any[] = [];
  for (const k of Object.keys(s.turnFlags ?? {})) {
    const m = /^(once|ability):(inst-\d+)(?::(\d+))?$/.exec(k);
    if (!m) continue;
    const card = mine.get(m[2]);
    if (!card) continue;
    const style = m[1] === 'ability' ? 'ability:<inst>:<idx>' : m[3] !== undefined ? 'once:<inst>:<n>' : 'once:<inst>';
    const holdSees = /^once:(.+?)(?::\d+)?$/.test(k); // corp/hold.ts nextTurnBoard: the once: forms only
    const runsSees = card.cardCode === MALANDRAGEM && k === `once:${card.instanceId}:0`; // runs.ts runBypasses' Malandragem flag
    const money = T.cards[card.cardCode]?.clickMoney;
    // runnerEarnings reads no flag: from the rest of a turn it counts a once-per-turn click use already spent (Telework Contract)
    const earningsCounts = !!money && (T.hold.runnerEarnings(s, T.hold.restOfTurn(s)) as number[]).length > 0 && money.once === true;
    rows.push({
      code: card.cardCode,
      flag: k.replace(card.instanceId, '<inst>'),
      style,
      side,
      holdSees,
      runsSees,
      earningsReadsFlag: false,
      clickMoneyOnce: !!money?.once,
      earningsCounts,
    });
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ L14: the trash priced, the trash declined
function trashCandidates(s: GameState, id: string, memory: Map<string, string>): any[] {
  const sv = s.corp.servers[id];
  if (!sv) return [];
  const out2: any[] = [];
  for (const card of sv.root) {
    const d = def(card);
    if (d.trash_cost == null || d.type_code === 'agenda') continue;
    // HIDDEN-READ (the memory, read): the branches of serverWorth that add a trash: a rezzed card, or one the Runner accessed
    if (!card.isRezzed && !memory.has(card.instanceId)) continue;
    if (d.trash_cost > s.runner.credits) continue;
    const without = structuredClone(s);
    without.corp.servers[id].root = without.corp.servers[id].root.filter(c => c.instanceId !== card.instanceId);
    T.clear();
    const w1 = asRunner(s, () => T.runs.serverValue(s, id, 0, memory, false)) as number;
    T.clear();
    const w0 = asRunner(without, () => T.runs.serverValue(without, id, 0, memory, false)) as number;
    if (w1 - w0 > 1e-9)
      out2.push({
        id: card.instanceId,
        code: card.cardCode,
        worth: r3(w1 - w0),
        trash: d.trash_cost,
      });
  }
  return out2;
}

// ------------------------------------------------------------------------------------------------ the watchers
interface RunRec {
  src: string;
  pool: string;
  sk: string;
  T: number;
  n: number;
  server: string;
  l13: any;
  l14: any[];
  clicksAtStart: number;
  bioroidBreaks: number;
  jackedOut?: boolean;
  answers: any[];
}

class Watch {
  run: RunRec | null = null;
  runN = 0;
  seenTurnStart = new Set<number>();
  declined = new Map<
    string,
    {
      code: string;
      title: string;
      server: string;
      T: number;
      declines: number;
      reaccess: number;
      paid: number;
      left: boolean;
    }
  >();
  constructor(
    public src: string,
    public pool: string,
    public sk: string
  ) {}

  /** A transition: `s` the board before `a`, `next` after. `memory` the Runner's memory at `s` (read only). */
  see(s: GameState, a: GameAction | null, next: GameState, memory: Map<string, string>) {
    if (LIMIT && boards >= LIMIT) return;
    const core = T.core;
    const side = core.actingSide(s);
    // Turn-start board: the Runner's first main-phase decision of its turn
    if (
      side === 'runner' &&
      s.activePlayer === 'runner' &&
      !s.activeRun &&
      !core.activePrompt(s) &&
      !(s.priority && s.priority.holder !== s.activePlayer) &&
      s.runsThisTurn.length === 0 &&
      s.runner.clicks === s.runner.maxClicks &&
      !this.seenTurnStart.has(s.turnNumber)
    ) {
      this.seenTurnStart.add(s.turnNumber);
      this.turnStart(structuredClone(s));
    }
    // Run-start board
    if (!s.activeRun && next.activeRun && s.activePlayer === 'runner') {
      this.runStart(structuredClone(s), next, memory);
    }
    if (this.run && s.activeRun) {
      const r = this.run;
      if (a?.type === 'BIOROID_BREAK') r.bioroidBreaks++;
      if (a?.type === 'JACK_OUT') r.jackedOut = true;
      const p = core.activePrompt(s);
      if (a?.type === 'RESOLVE_PROMPT' && p?.kind === 'access_trash') {
        const cand = r.l14.find(c => c.id === p.cardInstanceId);
        if (cand) {
          const choice = (a as any).choice;
          cand.offered = true;
          cand.trashCost = p.trashCost;
          cand.trashed = !!choice?.trash || !!choice?.alternativeId;
          cand.creditsAtAccess = s.runner.credits;
          if (!cand.trashed) cand.cause = this.cause(s, p, cand);
        }
      }
    }
    if (this.run && s.activeRun && !next.activeRun) this.runEnd(next);
    // Turn-end board (L10): the last board of a turn, before the hand-over resets its flags
    if (next.activePlayer !== s.activePlayer || next.turnNumber !== s.turnNumber) {
      const rows = lOnce(s, s.activePlayer);
      if (rows.length)
        out({
          kind: 'te',
          src: this.src,
          pool: this.pool,
          sk: this.sk,
          T: s.turnNumber,
          side: s.activePlayer,
          rows,
        });
    }
    // L14's later life of a declined card: re-accesses (a later successful run on its server while it is there) and the
    // Corp's gains its log lines name (HIDDEN-READ: the log)
    if (this.declined.size) {
      for (const e of next.log.slice(s.log.length)) {
        for (const d of this.declined.values()) {
          if (d.left) continue;
          if (e.player === 'corp' && (e.cardCode === d.code || e.message.includes(`(${d.title})`))) {
            const g = /gain(?:s|ed)? (\d+) (?:\[credit\]|credits?)/i.exec(e.message);
            if (g) d.paid += Number(g[1]);
          }
        }
      }
      for (const [id, d] of this.declined) {
        if (d.left) continue;
        const still = next.corp.servers[d.server]?.root.some(c => c.instanceId === id);
        if (!still) d.left = true;
      }
    }
  }

  cause(s: GameState, p: any, cand: any): string {
    if (p.trashCost === null || p.trashCost === undefined) return 'credits';
    // A cost on trash: trash it on a copy and see what it does to the Runner beyond the credits (Public Access Plaza's tag)
    try {
      const after = T.core.executeAction(structuredClone(s), {
        type: 'RESOLVE_PROMPT',
        player: 'runner',
        promptId: p.id,
        choice: { kind: 'access_trash', trash: true },
      });
      const tags = after.runner.tags - s.runner.tags;
      const grip = s.runner.grip.length - after.runner.grip.length;
      const lost = s.runner.credits - after.runner.credits - p.trashCost;
      cand.onTrash = { tags, grip, credits: lost };
      if (tags > 0 || grip > 0 || lost > 0) return 'costOnTrash';
    } catch {
      /* the copy could not trash it */
    }
    return 'other';
  }

  turnStart(s: GameState) {
    boards++;
    const t0 = performance.now();
    T.clear();
    const subs = timed('L1L2L4', () => lSubs(s));
    const seven = timed('L3', () => lSeven(s));
    const unrez = timed('L5', () => lUnrezzed(s));
    const money = timed('L6', () => lMoney(s));
    const runBegin = timed('L7', () => lRunBegin(s));
    const myco = timed('L12', () => lMycoweb(s));
    const pub = publicBoard(s);
    const servers = Object.keys(s.corp.servers).map(id =>
      timed('L8L9', () => {
        try {
          const r = lServer(s, id, pub, money);
          T.clear();
          r.l13 = timed('L13', () => lBioroid(s, id));
          return r;
        } catch (e) {
          return { id, err: (e as Error).message.slice(0, 160) };
        }
      })
    );
    out({
      kind: 'b',
      at: 'turnStart',
      src: this.src,
      pool: this.pool,
      sk: this.sk,
      T: s.turnNumber,
      rk: s.runner.clicks,
      rc: s.runner.credits,
      cc: s.corp.credits,
      grip: s.runner.grip.length,
      met: metCodes(s),
      ...subs,
      seven,
      unrez,
      money,
      runBegin,
      myco,
      servers,
      ms: Math.round(performance.now() - t0),
    });
  }

  runStart(s: GameState, next: GameState, memory: Map<string, string>) {
    boards++;
    const t0 = performance.now();
    const id = next.activeRun!.server;
    T.clear();
    const pub = publicBoard(s);
    const money = lMoney(s);
    let server: any;
    try {
      server = timed('R:L9', () => lServer(s, id, pub, money));
    } catch (e) {
      server = { id, err: (e as Error).message.slice(0, 160) };
    }
    T.clear();
    const l13 = timed('R:L13', () => safe(() => lBioroid(s, id), null));
    T.clear();
    const l14 = timed('R:L14', () => safe(() => trashCandidates(s, id, memory), [] as any[]));
    this.run = {
      src: this.src,
      pool: this.pool,
      sk: this.sk,
      T: s.turnNumber,
      n: this.runN++,
      server: id,
      l13,
      l14,
      clicksAtStart: next.runner.clicks,
      bioroidBreaks: 0,
      answers: [],
    };
    // A later run on a server whose declined card is still there: a re-access when it succeeds (counted at the run's end)
    out({
      kind: 'r',
      src: this.src,
      pool: this.pool,
      sk: this.sk,
      T: s.turnNumber,
      n: this.run.n,
      server: id,
      rk: s.runner.clicks,
      rc: s.runner.credits,
      met: metCodes(s),
      l9: server.l9 ?? null,
      l8: server.l8 ?? null,
      err: server.err,
      money,
      ms: Math.round(performance.now() - t0),
    });
  }

  runEnd(next: GameState) {
    const r = this.run!;
    const last = next.runsThisTurn[next.runsThisTurn.length - 1];
    const successful = !!last?.successful;
    const jackedOut = !!r.jackedOut;
    const ended = successful ? 'successful' : jackedOut ? 'jackedOut' : 'ended';
    // A declined card accessed again: a later successful run on its server while it is still there (the first decline opens the record)
    for (const [id, d] of this.declined) if (!d.left && d.server === r.server && successful && next.corp.servers[d.server]?.root.some(c => c.instanceId === id)) d.reaccess++;
    for (const c of r.l14) {
      if (!c.offered || c.trashed) continue;
      const d = this.declined.get(c.id);
      if (d) d.declines++;
      else
        this.declined.set(c.id, {
          code: c.code,
          title: def(c.code).title,
          server: r.server,
          T: r.T + r.n / 1000,
          declines: 1,
          reaccess: 0,
          paid: 0,
          left: false,
        });
    }
    out({
      kind: 'run',
      src: r.src,
      pool: r.pool,
      sk: r.sk,
      T: r.T,
      n: r.n,
      server: r.server,
      ended,
      clicksAtStart: r.clicksAtStart,
      clicksAtEnd: next.runner.clicks,
      bioroidBreaks: r.bioroidBreaks,
      l13: r.l13,
      l14: r.l14,
    });
    this.run = null;
  }

  end(final: GameState) {
    for (const [id, d] of this.declined)
      out({
        kind: 'declined',
        src: this.src,
        pool: this.pool,
        sk: this.sk,
        id,
        ...d,
        final: final.turnNumber,
      });
  }
}

// ------------------------------------------------------------------------------------------------ sources
type Rec = {
  seed: number;
  corpDeck: string;
  runnerDeck: string;
  winner: string | null;
  cr: number[];
  sc: number[];
};
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(src: Tree, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return src.core.createInitialGameState(src.decks.deckGameSetup(rec.seed, c, r));
}

async function main() {
  const dirs = makeTrees(root);
  const source = await loadTree('source', dirs.source);
  T = await loadTree('eval', dirs.eval);
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch' || pool === 'nrdb') {
      const run = pool === 'batch' ? '45086908053' : '45198090232';
      const recs: Rec[] = JSON.parse(readFileSync(`scripts/runner-rework/facts-deals-${run}.json`, 'utf8'));
      for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, id: r });
    } else {
      const dir = pool === 'human' ? 'tests/fixtures/human-games' : 'tests/fixtures/runner-facts/issues';
      for (const f of readdirSync(dir)
        .filter(x => x.endsWith('.json'))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b)))
        if (!HUMAN.length || HUMAN.some(h => f.startsWith(h))) sources.push({ pool, id: join(dir, f) });
    }
  }
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (LIMIT && boards >= LIMIT) break;
    const t0 = performance.now();
    if (src.pool === 'batch' || src.pool === 'nrdb') {
      const rec = src.id as Rec;
      const name = `${src.pool}:${rec.seed}`;
      source.clear();
      const ag = {
        corp: source.createAgent('corp', 'normal'),
        runner: source.createAgent('runner', 'normal'),
      };
      const g = new source.GameRunner(dealStateOf(source, rec), ag);
      const w = new Watch(name, src.pool, 'self');
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      for (let n = 0; n < 4000; n++) {
        const s: GameState = g.state;
        if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
          cr.push(s.corp.credits);
          sc.push(s.corp.score);
          lastTurn = s.turnNumber;
        }
        if (!g.step()) break;
        // HIDDEN-READ: the source Runner's memory, read (never asked); the measuring copies it
        const memory = new Map((ag.runner as any).memory ?? []) as Map<string, string>;
        timed('watch', () => w.see(s, g.last ?? null, g.state, memory));
      }
      w.end(g.state);
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({
        kind: 'g',
        src: name,
        pool: src.pool,
        decks: `${rec.corpDeck} v ${rec.runnerDeck}`,
        matchesBatch: matches,
        ...(matches
          ? {}
          : {
              cr,
              sc,
              recCr: rec.cr,
              recSc: rec.sc,
              winner: g.state.winner,
              recWinner: rec.winner,
            }),
        ms: Math.round(performance.now() - t0),
      });
    } else {
      const file = src.id as string;
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const sk = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const name = `${src.pool}:${file.split('/').pop()}`;
      if (!r.moves?.length) continue;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = T.core.createInitialGameState(T.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      // The Runner's memory as the Normal Runner would have kept it, watching every board (count 3's watcher: observe reads only)
      const watcher: any = T.createAgent('runner', 'normal');
      const w = new Watch(name, src.pool, sk);
      let stopped: string | null = null;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        safe(() => watcher.observe?.(s), undefined);
        let next: GameState;
        try {
          next = T.core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
        const memory = new Map(watcher.memory ?? []) as Map<string, string>;
        timed('watch', () => w.see(s, move, next, memory));
        s = next;
      }
      w.end(s);
      out({
        kind: 'h',
        src: name,
        pool: src.pool,
        sk,
        moves: r.moves.length,
        stopped,
        ms: Math.round(performance.now() - t0),
      });
    }
  }
  const tm: Record<string, number> = {};
  for (const [k2, v] of Object.entries(timing)) tm[k2] = Math.round(v);
  out({ kind: 's', shard, boards, timing: tm });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
