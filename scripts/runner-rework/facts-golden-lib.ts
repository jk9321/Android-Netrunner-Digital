/**
 * R-A A-log: the golden values A-move is proven against (spec r-a.md, "The golden values"; brief a-log.md rev 2, point 1).
 * Rewritten from Gemini's draft (gemini-runner-facts-log 14f44f3), whose 55 boards never reached the branches they named
 * (its bypass readers read 0 on every board, branch pairs were equal, its trojans were hosted where no reader looks).
 *
 * For every board: one built board per branch of each case, every reader's answer today (breakPlans, runBypasses,
 * bypassesAhead, iceCost, iceCreditNeed, approachCost, runScore, serverHold, the Corp's rez decision for the ice), and for
 * the cases read in scoreMain or a decision the Runner's ranked list there. THE TWIN RULE (binding, rev 2): every board is
 * computed again on its twin (the card removed or the branch's condition flipped) and at least one recorded reader must
 * differ; the script names which, or the board carries a written reason; otherwise it stops (exit 1).
 * L11: each numeric fact of a card entry that states what the engine pays, costs or does, played in the engine in each
 * state the card's text names, against the entry.
 *
 * Boards are built as the pins build them: a structuredClone edited before any legality call, never after.
 * The src tree read and the beta commit it is (`base`: the last beta commit that changed src) are written into the JSON;
 * the run is deterministic: run twice, the files are byte-identical.
 *
 *   The boards and readers (computed on import); facts-golden.ts writes them, tests/runnerFacts.test.ts reads them back
 *   against the committed golden file (R-A A-move leg 1c).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CardInstance, GameAction, GameState, activePrompt, cardDef, createCardInstance, executeAction, getLegalActions, isLegalAction, wantsStop } from '../../src/core';
import { createAgent } from '../../src/ai';
import { rezCandidates } from '../../src/ai/playout';
import { approachCost, breakPlans, bypassesAhead, chainReactionBonus, iceCost, iceCreditNeed, isTrap, plannedSubroutines, runBypasses, runScore } from '../../src/ai/runs';
import { serverHold, restOfTurn } from '../../src/ai/corp/hold';
import { runnerEarnings, counterCredits } from '../../src/ai/nextTurnMoney';
import { HeuristicRunnerAI, readWriteFullShuffle, trojanHostValue } from '../../src/ai/runnerAI';
import { runEventOptions } from '../../src/ai/prompts';
import { CARDS } from '../../src/ai/cards';
import { asSide } from '../../src/ai/pricing';
import { decisionContext, clearHandCaches } from '../../src/ai/handValues';
import { clearDamageThreats } from '../../src/ai/effectValues';
import { clearBuildTargets, valueLoops } from '../../src/ai/valueModel';
import { clearDeckShares } from '../../src/ai/iceValues';
import { newGame, startRunnerTurn, cont, passTurn } from '../../tests/helpers';
import { spikeKey } from '../../src/core/scripts/liberation/runner/helpers';


const clear = () => {
  clearHandCaches();
  clearDamageThreats();
  clearBuildTargets();
  clearDeckShares();
  valueLoops?.clear();
};
const r4 = (x: number | null | undefined): number | string | null =>
  x === null || x === undefined ? null : Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x > 0 ? 'Inf' : '-Inf';

// ------------------------------------------------------------------------------------------------ cards
const C = {
  // ice
  KESSLEROID: '35075', // Barrier 1: End the run. End the run.
  CAPACITOR: '34116', // Barrier 3: gain 1 a tag; end the run (mixed)
  PHAROS: '30063', // Barrier 5
  WHITESPACE: '30074', // Code Gate 0
  SLEIPNIR: '36030', // Code Gate 4
  KARUNA: '30047', // Sentry - AP 3
  BALLISTA: '30062', // Sentry - Destroyer 4
  LAMPLIGHTER: '35080', // Sentry - Observer 3
  FLYWHEEL: '36059', // Sentry 3, no keyword
  BRAN: '30039', // Barrier - Bioroid 6
  FUNHOUSE: '30054',
  JAGUARUNDI: '34035',
  SERAPH: '34118',
  PAYWALL: '36052',
  // Corp root
  MANEGARM: '30042',
  IDIOSYNCRESIS: '35061',
  URTICA: '30045', // Urtica Cipher (ambush: a trap)
  BANGUN: '35068',
  OFFWORLD: '30069', // an agenda
  // Runner
  MAYFLY: '30032',
  HANTU: '35008',
  AUDREY: '34004',
  BANNER: '34005',
  LOBISOMEM: '34090',
  SPIKE: '34092',
  CORSAIR: '36004',
  SLAP: '34026',
  PHYSARUM: '34082',
  S_DOBRADO: '34012',
  ALARM: '34078',
  MALANDRAGEM: '34081',
  LASER: '34016',
  CURUPIRA: '34015',
  FRANSOFIA: '35021',
  CHAIN: '36001',
  WINDOW: '34077',
  JAILBREAK: '30028',
  RWS: '36022',
  BOTULUS: '30004',
  TRANQ: '30017',
  TOUCHSTONE: '36021', // stealth credits
  FOAF: '34074',
  RIOTERS: '35011',
  TELEWORK: '30027',
  PENNY: '30014',
  FERMENTER: '30007',
  CLEAVER: '30006',
  PALISADE: '30072',
};

// ------------------------------------------------------------------------------------------------ board building
interface Spec {
  server?: string; // default hq
  ice?: { code: string; rezzed?: boolean; adv?: number }[]; // outermost LAST (as installed)
  root?: { code: string; rezzed?: boolean; faceUp?: boolean; adv?: number }[];
  programs?: { code: string; tokens?: Record<string, number>; host?: number; hosted?: number }[]; // host: index into ice
  hardware?: { code: string; tokens?: Record<string, number> }[];
  resources?: { code: string; tokens?: Record<string, number> }[];
  grip?: string[];
  runnerCredits?: number;
  corpCredits?: number;
  clicks?: number;
  corpScore?: number;
  runnerScore?: number;
  tags?: number;
  corpId?: string;
  turnFlags?: Record<string, number>;
  runs?: { server: string; successful: boolean }[];
}
interface Built {
  s: GameState;
  server: string;
  ice: string[];
  rig: string[];
}
const FILLER = '30021'; // VRcation
function build(spec: Spec): Built {
  const s = structuredClone(newGame(1)); // a clone, edited before any legality call (the pins' rule)
  startRunnerTurn(s);
  s.runner.grip = [];
  s.runner.credits = spec.runnerCredits ?? 10;
  s.corp.credits = spec.corpCredits ?? 10;
  s.runner.clicks = spec.clicks ?? 4;
  s.corp.score = spec.corpScore ?? 0;
  s.runner.score = spec.runnerScore ?? 0;
  s.runner.tags = spec.tags ?? 0;
  if (spec.corpId) s.corp.identity = { ...createCardInstance(s, spec.corpId), isRezzed: true, faceUp: true };
  if (spec.turnFlags) s.turnFlags = { ...s.turnFlags, ...spec.turnFlags };
  if (spec.runs) s.runsThisTurn = spec.runs.map(r => ({ ...r }));
  const server = spec.server ?? 'hq';
  if (!s.corp.servers[server]) s.corp.servers[server] = { id: server, name: server, isRemote: true, ice: [], root: [] } as any;
  const ice: string[] = [];
  for (const i of spec.ice ?? []) {
    const c = createCardInstance(s, i.code);
    c.isRezzed = i.rezzed ?? true;
    c.runnerKnows = c.isRezzed;
    if (i.adv) c.advancementCounters = i.adv;
    s.corp.servers[server].ice.push(c);
    ice.push(c.instanceId);
  }
  for (const r of spec.root ?? []) {
    const c = createCardInstance(s, r.code);
    c.isRezzed = r.rezzed ?? false;
    c.faceUp = r.faceUp ?? c.isRezzed;
    c.runnerKnows = c.isRezzed || c.faceUp;
    if (r.adv) c.advancementCounters = r.adv;
    s.corp.servers[server].root.push(c);
  }
  const rig: string[] = [];
  for (const p of spec.programs ?? []) {
    const c = createCardInstance(s, p.code);
    c.isRezzed = true;
    if (p.tokens) c.tokens = { ...c.tokens, ...p.tokens };
    if (p.host !== undefined) c.hostedOnId = ice[p.host];
    if (p.hosted) c.hostedCards = Array.from({ length: p.hosted }, () => ({ ...createCardInstance(s, C.SLEIPNIR) }));
    s.runner.rig.programs.push(c);
    s.runner.memoryUnitsUsed += p.host !== undefined ? 0 : cardDef(c).memory_cost || 0;
    rig.push(c.instanceId);
  }
  for (const h of spec.hardware ?? []) {
    const c = createCardInstance(s, h.code);
    c.isRezzed = true;
    if (h.tokens) c.tokens = { ...c.tokens, ...h.tokens };
    s.runner.rig.hardware.push(c);
    rig.push(c.instanceId);
  }
  for (const r of spec.resources ?? []) {
    const c = createCardInstance(s, r.code);
    c.isRezzed = true;
    if (r.tokens) c.tokens = { ...c.tokens, ...r.tokens };
    s.runner.rig.resources.push(c);
    rig.push(c.instanceId);
  }
  // A grip of three VRcation (no money, no run) unless the board names its grip: with an empty grip runScore prices the
  // flatline risk and reads every server as not worth a run (-Infinity), so its price part is never reached
  for (const g of spec.grip ?? [FILLER, FILLER, FILLER]) s.runner.grip.push(createCardInstance(s, g));
  return { s, server, ice, rig };
}

// ------------------------------------------------------------------------------------------------ readers
const iceOf = (b: Built, k: number) => b.s.corp.servers[b.server].ice.find(c => c.instanceId === b.ice[k])!;
const pos = (b: Built, id: string) => b.ice.indexOf(id);
const runner = <X>(s: GameState, f: () => X): X =>
  asSide('runner', () => {
    decisionContext(s, 'runner');
    return f();
  });
const corp = <X>(s: GameState, f: () => X): X =>
  asSide('corp', () => {
    decisionContext(s, 'corp');
    return f();
  });
const label = (s: GameState, a: GameAction) => {
  const x = a as any;
  const card = x.cardInstanceId
    ? [...s.runner.grip, ...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].find(c => c.instanceId === x.cardInstanceId)
    : undefined;
  return `${a.type}${x.targetServerId ? ':' + x.targetServerId : ''}${card ? ':' + cardDef(card).title : ''}${x.hostInstanceId ? '@' + x.hostInstanceId : ''}${x.abilityIndex !== undefined ? '#' + x.abilityIndex : ''}`;
};

/** The Corp's rez decision for ice k: the board with that ice unrezzed, the Runner run into it, the Corp's agent asked at its approach window. */
function corpRez(b: Built, k: number): string {
  try {
    const s = structuredClone(b.s);
    const sv = s.corp.servers[b.server];
    const ice = sv.ice.find(c => c.instanceId === b.ice[k])!;
    ice.isRezzed = false;
    ice.runnerKnows = false;
    // Only the outermost ice is approached first (6.9.2): move it outermost on this copy
    sv.ice = [...sv.ice.filter(c => c !== ice), ice];
    s.runsThisTurn = [];
    // A fresh run on this copy (a board built with a run under way is asked as the run's own start)
    s.activeRun = null;
    if (s.runner.clicks < 1) s.runner.clicks = 1;
    let st = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: b.server });
    const agent: any = createAgent('corp', 'normal');
    // Driven as GameRunner drives a run (src/ai/playout.ts step): the Runner moves on, the Corp is asked in its rez window
    for (let n = 0; n < 12; n++) {
      const w = st.priority;
      if (!st.activeRun || st.activeRun.encounter || st.pendingPrompts.length) return 'no window';
      if (w && w.holder === 'corp' && w.step === 'approach_ice') {
        if (!wantsStop(st, 'corp', w)) return 'not asked (no stop)';
        clear();
        const cands = rezCandidates(st, 'approach_ice');
        if (!cands.some(c => c.instanceId === ice.instanceId)) return 'cannot rez';
        const pick = agent.chooseRez(st, cands);
        return pick && pick.type === 'REZ_CARD' ? 'rez' : 'pass';
      }
      const side = w?.holder ?? 'runner';
      const legal = getLegalActions(st, side);
      const go = legal.find(a => a.type === 'CONTINUE_RUN') ?? legal.find(a => a.type === 'PASS');
      if (!go) return 'no window';
      st = executeAction(st, go);
    }
    return 'no window';
  } catch (e) {
    return `error: ${(e as Error).message.slice(0, 60)}`;
  }
}

interface Read {
  name: string;
  value: unknown;
}
function readers(b: Built, opts: { target?: number; run?: Record<string, unknown>; decision?: boolean; noRez?: boolean; extra?: Read[] }): Record<string, unknown> {
  const s = b.s;
  clear();
  const out: Record<string, unknown> = {};
  const t = opts.target ?? b.ice.length - 1;
  const ice = b.ice.length ? iceOf(b, t) : undefined;
  if (ice) {
    const n = plannedSubroutines(s, ice).length;
    out.breakPlans = runner(s, () => breakPlans(s, ice, n)).map(({ plan, spends }) => ({
      breaker: plan.breaker.cardCode,
      credits: r4(plan.credits),
      value: r4(plan.value),
      boosts: plan.boostsNeeded,
      byAbility: !!(plan.boostByAbility || plan.breakByAbility),
      spends: { ...spends, counters: spends.counters ? { ...spends.counters, cardId: undefined } : undefined, oncePerRun: spends.oncePerRun ? 'set' : undefined },
    }));
    out.iceCost = r4(runner(s, () => iceCost(s, ice)));
    out.iceCreditNeed = r4(runner(s, () => iceCreditNeed(s, ice)));
  }
  const byp = runner(s, () => runBypasses(s, b.server, (opts.run ?? {}) as any));
  out.runBypasses = { ice: [...byp.ids].map(id => pos(b, id)).sort(), price: r4(byp.price) };
  out.bypassesAhead = s.activeRun ? [...runner(s, () => bypassesAhead(s, s.corp.servers[b.server].ice, false))].map(id => pos(b, id)).sort() : null;
  const ap = runner(s, () => approachCost(s, b.server, s.runner.clicks - 1, s.runner.credits));
  out.approachCost = ap ? { cost: r4(ap.cost), credits: ap.credits } : null;
  out.runScore = r4(runner(s, () => runScore(s, b.server, (opts.run ?? {}) as any)));
  clear();
  const h = corp(s, () => serverHold(s, b.server, { when: 'restOfTurn', corpCredits: s.corp.credits }));
  out.serverHold = { holds: h.holds, need: r4(h.need), budget: r4(h.budget), rez: h.rez?.map(id => pos(b, id)) ?? null };
  clear();
  const hn = corp(s, () => serverHold(s, b.server, { when: 'nextTurn' as any, corpCredits: s.corp.credits }));
  out.serverHoldNextTurn = { holds: hn.holds, need: r4(hn.need), budget: r4(hn.budget) };
  if (ice && !opts.noRez) out.corpRez = corpRez(b, t);
  if (opts.decision) {
    clear();
    const ai = new HeuristicRunnerAI();
    const ranked = runner(s, () => ai.rankMainActions(s));
    out.rankMainActions = ranked
      .filter(x => x.action.type !== 'START_TURN')
      .slice(0, 8)
      .map(x => ({ a: label(s, x.action), score: r4(x.score) }));
  }
  for (const e of opts.extra ?? []) out[e.name] = e.value;
  return out;
}

// ------------------------------------------------------------------------------------------------ the boards
interface Board {
  case: string;
  branch: string;
  spec: Spec;
  twin: Spec;
  twinIs: string;
  target?: number;
  run?: Record<string, unknown>;
  decision?: boolean;
  /** Extra readers recorded on both boards (by name: decision readers, isTrap, chainReactionBonus...). */
  extra?: (b: Built) => Read[];
  /** A sentence where the twin cannot differ in any reader (the twin rule's stated reason). */
  reason?: string;
}
const base = (o: Spec): Spec => ({ runnerCredits: 10, corpCredits: 10, ...o });
const without = (o: Spec, code: string): Spec => ({
  ...o,
  programs: o.programs?.filter(p => p.code !== code),
  hardware: o.hardware?.filter(p => p.code !== code),
  resources: o.resources?.filter(p => p.code !== code),
  grip: o.grip?.filter(g => g !== code),
});

const B: Board[] = [];
const add = (b: Board) => B.push(b);

// Pressure Spike: below threat 4, at threat 4, and with its once-per-run use spent (a run under way)
const spike = (o: Spec = {}) => base({ ice: [{ code: C.PHAROS }], programs: [{ code: C.SPIKE }], ...o });
add({ case: 'Pressure Spike', branch: 'below threat 4', spec: spike(), twin: spike({ corpScore: 4 }), twinIs: 'the same board at threat 4' });
add({ case: 'Pressure Spike', branch: 'at threat 4', spec: spike({ corpScore: 4 }), twin: spike(), twinIs: 'below threat 4' });
add({
  case: 'Pressure Spike',
  branch: 'at threat 4, once-per-run use spent',
  spec: { ...spike({ corpScore: 4 }), runs: [] },
  twin: spike({ corpScore: 4 }),
  twinIs: 'at threat 4 with the use not spent',
  extra: () => [{ name: 'note', value: 'the use flag is set on the run under way (see runFlags in the board)' }],
});
// Malandragem: mode 1 (a power counter, strength 3 or less, flag unset), its turn flag set, mode 2 (threat 4, no counter)
const mal = (o: Spec = {}, tokens: Record<string, number> = { power: 2 }) => base({ ice: [{ code: C.KARUNA }], programs: [{ code: C.MALANDRAGEM, tokens }], ...o });
add({ case: 'Malandragem', branch: 'counter, strength 3 ice, flag unset', spec: mal(), twin: without(mal(), C.MALANDRAGEM), twinIs: 'no Malandragem' });
add({ case: 'Malandragem', branch: 'counter, its once-per-turn flag set', spec: { ...mal(), turnFlags: { MAL_FLAG: 1 } }, twin: mal(), twinIs: 'the flag unset' });
add({
  case: 'Malandragem',
  branch: 'threat 4, no counter (remove from game)',
  spec: mal({ corpScore: 4, ice: [{ code: C.BALLISTA }] }, {}),
  twin: mal({ ice: [{ code: C.BALLISTA }] }, {}),
  twinIs: 'below threat 4',
});
add({ case: 'Malandragem', branch: 'counter, ice of strength 4 (does not fit)', spec: mal({ ice: [{ code: C.BALLISTA }] }), twin: mal(), twinIs: 'a strength 3 ice' });
// Curupira at 2, 3 and 6 counters (two barriers: 6 counters is two uses)
const cur = (n: number) => base({ ice: [{ code: C.PHAROS }, { code: C.CAPACITOR }], programs: [{ code: C.CURUPIRA, tokens: { power: n } }] });
add({ case: 'Curupira', branch: '2 counters', spec: cur(2), twin: cur(3), twinIs: '3 counters' });
add({ case: 'Curupira', branch: '3 counters', spec: cur(3), twin: cur(2), twinIs: '2 counters' });
add({ case: 'Curupira', branch: '6 counters', spec: cur(6), twin: cur(3), twinIs: '3 counters' });
// Banner: an all-"End the run" barrier and a mixed one
const ban = (ice: string) => base({ ice: [{ code: ice }], programs: [{ code: C.BANNER }] });
add({ case: 'Banner', branch: 'barrier whose every subroutine is End the run', spec: ban(C.KESSLEROID), twin: without(ban(C.KESSLEROID), C.BANNER), twinIs: 'no Banner' });
add({ case: 'Banner', branch: 'mixed barrier', spec: ban(C.CAPACITOR), twin: ban(C.KESSLEROID), twinIs: 'the all-ETR barrier' });
// Laser Pointer against each keyword and none
const laser = (ice: string) => base({ ice: [{ code: ice }], programs: [{ code: C.LASER }] });
for (const [kw, ice] of [
  ['AP', C.KARUNA],
  ['destroyer', C.BALLISTA],
  ['observer', C.LAMPLIGHTER],
  ['none', C.FLYWHEEL],
])
  add({
    case: 'Laser Pointer',
    branch: `${kw} ice`,
    spec: laser(ice),
    twin: kw === 'none' ? laser(C.KARUNA) : without(laser(ice), C.LASER),
    twinIs: kw === 'none' ? 'an AP ice' : 'no Laser Pointer',
  });
// Fransofia Ward at 14 and 15 Corp credits
const fw = (cc: number) => base({ ice: [{ code: C.BALLISTA }], resources: [{ code: C.FRANSOFIA }], corpCredits: cc });
add({ case: 'Fransofia Ward', branch: 'Corp 14 credits', spec: fw(14), twin: fw(15), twinIs: 'Corp 15 credits' });
add({ case: 'Fransofia Ward', branch: 'Corp 15 credits', spec: fw(15), twin: fw(14), twinIs: 'Corp 14 credits' });
// Lobisomem with and without a counter, on a barrier and not
const lobi = (ice: string, n: number) => base({ ice: [{ code: ice }], programs: [{ code: C.LOBISOMEM, tokens: n ? { power: n } : {} }] });
add({ case: 'Lobisomem', branch: 'barrier, a counter', spec: lobi(C.CAPACITOR, 1), twin: lobi(C.CAPACITOR, 0), twinIs: 'no counter' });
add({ case: 'Lobisomem', branch: 'barrier, no counter', spec: lobi(C.CAPACITOR, 0), twin: lobi(C.CAPACITOR, 1), twinIs: 'a counter' });
add({ case: 'Lobisomem', branch: 'code gate, a counter', spec: lobi(C.SLEIPNIR, 1), twin: without(lobi(C.SLEIPNIR, 1), C.LOBISOMEM), twinIs: 'no Lobisomem' });
// S-Dobrado and Alarm Clock: the first ice; the second at threat 4 with and without a click
const two = (o: Spec) => base({ ice: [{ code: C.BALLISTA }, { code: C.KARUNA }], ...o });
add({
  case: 'S-Dobrado',
  branch: 'first ice',
  spec: two({ grip: [C.S_DOBRADO] }),
  run: { bypassFirst: true },
  twin: two({ grip: [C.S_DOBRADO] }),
  twinIs: 'the same board priced without the run option',
  reason: undefined,
});
add({
  case: 'S-Dobrado',
  branch: 'second ice at threat 4 with a click',
  spec: two({ grip: [C.S_DOBRADO], corpScore: 4, clicks: 3 }),
  run: { bypassFirst: true },
  twin: two({ grip: [C.S_DOBRADO], clicks: 3 }),
  twinIs: 'below threat 4',
});
add({
  case: 'S-Dobrado',
  branch: 'second ice at threat 4 without a click',
  spec: two({ grip: [C.S_DOBRADO], corpScore: 4, clicks: 1 }),
  run: { bypassFirst: true },
  twin: two({ grip: [C.S_DOBRADO], corpScore: 4, clicks: 3 }),
  twinIs: 'with a click',
});
add({
  case: 'Alarm Clock',
  branch: 'first ice with 2 clicks',
  spec: two({ hardware: [{ code: C.ALARM }], ice: [{ code: C.BALLISTA }] }),
  run: { alarmClock: true },
  twin: two({ hardware: [{ code: C.ALARM }], ice: [{ code: C.BALLISTA }], clicks: 2 }),
  twinIs: 'without the 2 clicks after the run',
});
add({
  case: 'Alarm Clock',
  branch: 'first ice without the clicks',
  spec: two({ hardware: [{ code: C.ALARM }], ice: [{ code: C.BALLISTA }], clicks: 2 }),
  run: { alarmClock: true },
  twin: two({ hardware: [{ code: C.ALARM }], ice: [{ code: C.BALLISTA }] }),
  twinIs: 'with the clicks',
});
// The breakers on an ice they break and one they do not
const brk = (code: string, ice: string, o: Spec = {}) =>
  base({ ice: [{ code: ice }], programs: [{ code, ...((o.programs?.[0] ?? {}) as any) }], ...o, ...(o.programs ? { programs: [{ code, ...(o.programs[0] as any) }] } : {}) });
for (const [code, name, breaks, not, o] of [
  [C.MAYFLY, 'Mayfly', C.KARUNA, C.BRAN, {}],
  [C.HANTU, 'Hantu', C.KARUNA, C.SLEIPNIR, { programs: [{ code: C.HANTU, tokens: { virus: 2 } }] }],
  [C.AUDREY, 'Audrey v2', C.KARUNA, C.PHAROS, { programs: [{ code: C.AUDREY, tokens: { virus: 1 } }], grip: [C.SLEIPNIR] }],
  [C.CORSAIR, 'Corsair', C.CAPACITOR, C.KARUNA, { hardware: [{ code: C.TOUCHSTONE, tokens: { credit: 2 } }] }],
  [C.SLAP, 'Slap Vandal', C.PALISADE, C.KESSLEROID, { programs: [{ code: C.SLAP, host: 0 }] }],
] as [string, string, string, string, Spec][]) {
  add({ case: name, branch: 'an ice it breaks', spec: brk(code, breaks, o), twin: without(brk(code, breaks, o), code), twinIs: `no ${name}` });
  add({ case: name, branch: 'an ice it does not break', spec: brk(code, not, o), twin: brk(code, breaks, o), twinIs: 'an ice it breaks' });
}
// BANGUN: a faceup agenda in a remote under BANGUN (2 meat and a tag on its steal) and under another identity
const bangun = (id?: string, grip = 3) => base({ server: 'remote-1', root: [{ code: C.OFFWORLD, faceUp: true }], corpId: id, grip: Array(grip).fill(C.SLEIPNIR) });
add({ case: 'BANGUN', branch: 'faceup agenda, grip 3', spec: bangun(C.BANGUN), twin: bangun(), twinIs: 'another identity' });
add({ case: 'BANGUN', branch: 'faceup agenda, grip 1 (less than its 2 damage)', spec: bangun(C.BANGUN, 1), twin: bangun(C.BANGUN, 3), twinIs: 'grip 3' });
// Botulus and Tranquilizer: hosted, and in the grip with 0, 1 and 2 targets
const troj = (code: string, n: number) => base({ ice: [{ code: C.KARUNA }], programs: [{ code, host: 0, tokens: { virus: n } }] });
add({ case: 'Botulus', branch: 'hosted, 1 counter', spec: troj(C.BOTULUS, 1), twin: troj(C.BOTULUS, 0), twinIs: 'hosted, 0 counters' });
add({ case: 'Botulus', branch: 'hosted, 2 counters', spec: troj(C.BOTULUS, 2), twin: troj(C.BOTULUS, 1), twinIs: 'hosted, 1 counter' });
// Tranquilizer's reader is the next turn's board (5.7.1: the host derezzed at 3): a barrier the Corp cannot rez again at 0
const tranq = (n: number) => base({ ice: [{ code: C.PALISADE }], programs: [{ code: C.TRANQ, host: 0, tokens: { virus: n } }], corpCredits: 0 });
add({ case: 'Tranquilizer', branch: 'hosted on a barrier, 2 counters, Corp at 0 (derezzes at the next turn start)', spec: tranq(2), twin: tranq(0), twinIs: 'hosted, 0 counters' });
const gripTroj = (code: string, targets: number) =>
  base({ ice: Array.from({ length: Math.max(1, targets) }, (_, i) => ({ code: i ? C.SLEIPNIR : C.KARUNA, rezzed: targets > 0 })), grip: [code] });
for (const [code, name] of [
  [C.BOTULUS, 'Botulus'],
  [C.TRANQ, 'Tranquilizer'],
])
  for (const t of [0, 1, 2])
    add({
      case: name,
      branch: `in grip, ${t} rezzed targets`,
      spec: gripTroj(code, t),
      twin: gripTroj(code, t === 1 ? 2 : 1),
      twinIs: `${t === 1 ? 2 : 1} targets`,
      decision: true,
      extra: b => {
        const hosts = b.s.corp.servers[b.server].ice.filter(c => c.isRezzed);
        return [{ name: 'trojanHostValue', value: hosts.map(h => r4(runner(b.s, () => trojanHostValue(b.s, code, h)))) }];
      },
    });
// Physarum, Funhouse, Manegarm, Idiosyncresis
const phys = (ice: string) => base({ ice: [{ code: ice }], programs: [{ code: C.PHYSARUM, host: 0 }] });
add({ case: 'Physarum Entangler', branch: 'hosted on a code gate', spec: phys(C.SLEIPNIR), twin: without(phys(C.SLEIPNIR), C.PHYSARUM), twinIs: 'no Physarum' });
add({ case: 'Physarum Entangler', branch: 'hosted on a barrier', spec: phys(C.CAPACITOR), twin: phys(C.SLEIPNIR), twinIs: 'hosted on a code gate' });
const fun = (ice: string, o: Spec = {}) => base({ ice: [{ code: ice }], programs: [{ code: C.CLEAVER }], ...o });
add({ case: 'Funhouse', branch: 'rezzed, untagged', spec: fun(C.FUNHOUSE), twin: fun(C.SLEIPNIR), twinIs: 'another code gate of strength 4 (Sleipnir)' });
add({ case: 'Funhouse', branch: 'rezzed, tagged', spec: fun(C.FUNHOUSE, { tags: 1 }), twin: fun(C.FUNHOUSE), twinIs: 'untagged' });
const man = (rezzed: boolean, o: Spec = {}) =>
  base({
    server: 'remote-1',
    root: [
      { code: C.MANEGARM, rezzed },
      { code: C.OFFWORLD, adv: 1 },
    ],
    ...o,
  });
add({ case: 'Manegarm Skunkworks', branch: 'rezzed, clicks cover it', spec: man(true), twin: man(false), twinIs: 'unrezzed' });
add({ case: 'Manegarm Skunkworks', branch: 'rezzed, 2 clicks: credits', spec: man(true, { clicks: 2 }), twin: man(true), twinIs: '4 clicks' });
add({ case: 'Manegarm Skunkworks', branch: 'rezzed, neither', spec: man(true, { clicks: 2, runnerCredits: 4 }), twin: man(true, { clicks: 2 }), twinIs: '10 credits' });
const idio = (code: string) => base({ server: 'remote-1', root: [{ code, adv: 2 }] });
add({
  case: 'Idiosyncresis',
  branch: 'an advanced asset in a remote',
  spec: idio(C.IDIOSYNCRESIS),
  twin: idio(C.URTICA),
  twinIs: 'an ambush that is sprung by access (Urtica Cipher)',
  extra: b => [{ name: 'isTrap', value: isTrap(b.s.corp.servers[b.server].root[0].cardCode) }],
});
// Chain Reaction, Window of Opportunity, Jailbreak, Read-Write Share at the decision that reads them
const chain = (grip: string[]) =>
  base({
    server: 'archives',
    grip,
    runs: [
      { server: 'hq', successful: true },
      { server: 'rd', successful: true },
    ],
    clicks: 3,
  });
add({
  case: 'Chain Reaction',
  branch: 'two centrals run, Archives left',
  spec: chain([C.CHAIN]),
  twin: chain([]),
  twinIs: 'no Chain Reaction in grip',
  decision: true,
  extra: b => [{ name: 'chainReactionBonus', value: r4(runner(b.s, () => chainReactionBonus(b.s, 'archives'))) }],
});
const win = (grip: string[]) => base({ ice: [{ code: C.BALLISTA }], grip });
add({
  case: 'Window of Opportunity',
  branch: 'in grip with a program',
  spec: win([C.WINDOW, C.MAYFLY]),
  twin: win([C.MAYFLY]),
  twinIs: 'no Window of Opportunity',
  decision: true,
  extra: b => [{ name: 'runEventOptions', value: runEventOptions(C.WINDOW, b.s) }],
});
const jb = (grip: string[]) => base({ ice: [{ code: C.KARUNA }], programs: [{ code: C.MAYFLY }], grip });
add({
  case: 'Jailbreak',
  branch: 'in grip',
  spec: jb([C.JAILBREAK]),
  twin: jb([]),
  twinIs: 'no Jailbreak',
  decision: true,
  extra: b => [{ name: 'runEventOptions', value: runEventOptions(C.JAILBREAK, b.s) }],
});
const rws = (n: number) => base({ programs: [{ code: C.RWS, hosted: n }] });
for (const n of [4, 3])
  add({
    case: 'Read-Write Share',
    branch: n === 4 ? 'full (4 hosted)' : 'partial (3 hosted)',
    spec: rws(n),
    twin: rws(n === 4 ? 3 : 4),
    twinIs: n === 4 ? '3 hosted' : '4 hosted',
    decision: true,
    extra: b => {
      const a = readWriteFullShuffle(b.s, getLegalActions(b.s, 'runner'));
      return [{ name: 'readWriteFullShuffle', value: a ? label(b.s, a) : null }];
    },
  });

// ------------------------------------------------------------------------------------------------ L11: entries against the engine
interface Check {
  card: string;
  field: string;
  state: string;
  entry: unknown;
  engine: unknown;
  agrees: boolean;
  note?: string;
}
export const L11: Check[] = [];
function useBest(s: GameState, id: string): { credits: number; tags: number; clicks: number } | null {
  const uses = getLegalActions(s, 'runner').filter(a => a.type === 'USE_ABILITY' && (a as any).cardInstanceId === id);
  if (!uses.length) return null;
  return uses
    .map(a => {
      const r = executeAction(structuredClone(s), a);
      return { credits: r.runner.credits - s.runner.credits, tags: r.runner.tags - s.runner.tags, clicks: s.runner.clicks - r.runner.clicks };
    })
    .reduce((a, b) => (b.credits > a.credits ? b : a));
}
// clickMoney: what runnerEarnings reads for the entry's clicks against what the engine pays, in each state the text names
for (const [code, states] of [
  [C.FOAF, [{ tags: 0 }, { tags: 1 }]],
  [C.RIOTERS, [{}]],
  [C.TELEWORK, [{ credit: 9 }, { credit: 2 }]],
  [C.PENNY, [{ credit: 2 }, { credit: 0 }]],
  [C.FERMENTER, [{ virus: 2 }, { virus: 0 }]],
] as [string, Record<string, number>[]][]) {
  for (const st of states) {
    const m = CARDS[code]!.clickMoney!;
    const { tags, ...tokens } = st;
    const type = cardDef({ cardCode: code } as CardInstance).type_code;
    const b = build(
      base({
        tags: tags ?? 0,
        clicks: 4,
        ...(type === 'resource' ? { resources: [{ code, tokens }] } : type === 'hardware' ? { hardware: [{ code, tokens }] } : { programs: [{ code, tokens }] }),
      })
    );
    // The count reads a turn's start (nextTurn: Fermenter's turn-start counter added); the engine is asked on the same
    // board with that counter placed, as the turn would have begun
    const entry = runnerEarnings(b.s)[m.clicks] - (m.clicks - m.clicks); // the credits it reads for the entry's clicks
    const s2 = structuredClone(b.s);
    if (m.perVirus) for (const c of s2.runner.rig.programs) if (c.cardCode === code) c.tokens = { ...c.tokens, virus: (c.tokens.virus ?? 0) + m.perVirus.turnStart };
    const eng = useBest(s2, b.rig[0]);
    L11.push({
      card: code,
      field: 'clickMoney',
      state: JSON.stringify(st),
      entry,
      engine: eng ? eng.credits + Math.max(0, m.clicks - eng.clicks) : null,
      agrees: !!eng && entry === eng.credits + Math.max(0, m.clicks - eng.clicks),
      note: eng && eng.tags ? `the use also gives ${eng.tags} tag(s)` : undefined,
    });
  }
}
// Telework Contract after its once-per-turn use (L10's flag): runnerEarnings from the rest of the turn against the engine
{
  const b = build(base({ resources: [{ code: C.TELEWORK, tokens: { credit: 9 } }] }));
  const use = getLegalActions(b.s, 'runner').find(a => a.type === 'USE_ABILITY' && (a as any).cardInstanceId === b.rig[0])!;
  const after = executeAction(structuredClone(b.s), use);
  const again = useBest(after, b.rig[0]);
  L11.push({
    card: C.TELEWORK,
    field: 'clickMoney.once',
    state: 'after its use this turn',
    entry: runnerEarnings(after, restOfTurn(after))[1],
    engine: again ? again.credits : 1,
    agrees: runnerEarnings(after, restOfTurn(after))[1] === (again ? again.credits : 1),
    note: 'engine: the ability is not offered again; a click pays 1 (5.2.7a)',
  });
}
// counterCredits, runBeginCredits, firstRunTrashForCost: every card with the field, the entry's number against the engine's
for (const [code, e] of Object.entries(CARDS)) {
  const f = e.holdFacts;
  if (!f) continue;
  if (f.counterCredits) {
    const b = build(
      base({
        ...(cardDef({ cardCode: code } as CardInstance).type_code === 'program'
          ? { programs: [{ code, tokens: { [f.counterCredits.counter]: 2 } }] }
          : { resources: [{ code, tokens: { [f.counterCredits.counter]: 2 } }] }),
      })
    );
    const card = [...b.s.runner.rig.programs, ...b.s.runner.rig.resources][0];
    const eng = useBest(b.s, card.instanceId);
    L11.push({
      card: code,
      field: 'counterCredits',
      state: '2 counters, one use',
      entry: f.counterCredits.credits,
      engine: eng ? eng.credits : null,
      agrees: eng?.credits === f.counterCredits.credits,
      note: `walk reads ${counterCredits(card)} for the 2 counters`,
    });
  }
  if (f.runBeginCredits || f.firstRunTrashForCost) {
    const type = cardDef({ cardCode: code } as CardInstance).type_code;
    const b = build(
      base({
        ...(type === 'hardware' ? { hardware: [{ code }] } : type === 'program' ? { programs: [{ code }] } : { resources: [{ code }] }),
        hardware: type === 'hardware' ? [{ code }] : [{ code: C.PENNY }],
      })
    );
    let st = executeAction(structuredClone(b.s), { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
    for (let n = 0; n < 4 && activePrompt(st)?.side === 'runner'; n++) {
      const p: any = activePrompt(st);
      const legal = getLegalActions(st, 'runner').filter(a => a.type === 'RESOLVE_PROMPT');
      // Knickknack asks for a card to trash: answer with Pennyshaver (printed install cost 3); otherwise take the yes
      const penny = st.runner.rig.hardware.find(c => c.cardCode === C.PENNY)?.instanceId;
      const yes =
        legal.find(a => !!penny && JSON.stringify(a).includes(`"${penny}"`)) ?? legal.find(a => JSON.stringify(a).match(/"trash":true|"optionId":"(yes|use|trash)"/)) ?? legal[0];
      if (!yes) break;
      st = executeAction(st, yes);
      void p;
    }
    const card = [...st.runner.rig.programs, ...st.runner.rig.hardware, ...st.runner.rig.resources].find(c => c.cardCode === code);
    const placed = card ? (card.tokens.credit ?? 0) : null;
    if (f.runBeginCredits)
      L11.push({ card: code, field: 'runBeginCredits.place', state: 'a run begins', entry: f.runBeginCredits.place, engine: placed, agrees: placed === f.runBeginCredits.place });
    if (f.firstRunTrashForCost)
      L11.push({
        card: code,
        field: 'firstRunTrashForCost',
        state: 'the first run of the turn begins (Pennyshaver installed, cost 3)',
        entry: 'gain the printed install cost of the trashed card',
        engine: { credits: st.runner.credits - b.s.runner.credits, trashedPenny: !st.runner.rig.hardware.some(c => c.cardCode === C.PENNY) },
        agrees: st.runner.credits - b.s.runner.credits === 3,
      });
  }
}
// The seven cards' fields, played in the engine
{
  // Botulus: a hosted virus counter breaks 1 subroutine on the host (breaksHostSubroutine)
  const b = build(troj(C.BOTULUS, 1));
  let st = executeAction(structuredClone(b.s), { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
  for (let n = 0; n < 8 && !st.activeRun?.encounter; n++) st = cont(st);
  const use = getLegalActions(st, 'runner').find(a => a.type === 'USE_ABILITY' && (a as any).cardInstanceId === b.rig[0]);
  let after = use ? executeAction(st, use) : null;
  // more than one unbroken subroutine: the card asks which (answer the first)
  if (after && activePrompt(after)?.side === 'runner') after = executeAction(after, getLegalActions(after, 'runner').find(a => a.type === 'RESOLVE_PROMPT')!);
  const broke = after?.activeRun?.encounter?.broken.filter(Boolean).length ?? null;
  L11.push({
    card: C.BOTULUS,
    field: 'breaksHostSubroutine',
    state: 'host encountered, 1 counter',
    entry: { counter: CARDS[C.BOTULUS]!.holdFacts!.breaksHostSubroutine!.counter, breaks: 1 },
    engine: { breaks: broke, counterLeft: after ? (after.runner.rig.programs[0].tokens.virus ?? 0) : null },
    agrees: broke === 1,
  });
}
{
  // Tranquilizer: a counter at the Runner's turn start, the host derezzed at 3 (runnerTurnStart)
  const f = CARDS[C.TRANQ]!.holdFacts!.runnerTurnStart!;
  for (const n of [1, 2]) {
    const b = build(troj(C.TRANQ, n));
    // the Runner's turn ends, the Corp's turn passes, the Runner's next turn begins (5.7.1: Tranquilizer's trigger)
    let st = passTurn(structuredClone(b.s));
    if (st.activePlayer === 'corp') st = passTurn(st);
    for (let k = 0; k < 10 && st.pendingPrompts.length; k++) st = executeAction(st, getLegalActions(st, st.pendingPrompts[0].side)[0]);
    const host = Object.values(st.corp.servers)
      .flatMap(sv => sv.ice)
      .find(c => c.instanceId === b.ice[0]);
    const tq = st.runner.rig.programs.find(c => c.cardCode === C.TRANQ);
    L11.push({
      card: C.TRANQ,
      field: 'runnerTurnStart',
      state: `${n} counter(s) before the Runner's turn begins`,
      entry: { counters: f.counters.n, derezAt: f.derezHostAt, derezzed: n + f.counters.n >= (f.derezHostAt ?? Infinity) },
      engine: { counters: tq ? (tq.tokens.virus ?? 0) - n : null, derezzed: host ? !host.isRezzed : null },
      agrees: !!tq && !!host && (tq.tokens.virus ?? 0) - n === f.counters.n && !host.isRezzed === n + f.counters.n >= (f.derezHostAt ?? Infinity),
    });
  }
}
/** Into the encounter of the outermost ice (a run on the board's server, the Corp passing). */
function encounter(b: Built): GameState {
  let st = executeAction(structuredClone(b.s), { type: 'INITIATE_RUN', player: 'runner', targetServerId: b.server });
  for (let n = 0; n < 8 && !st.activeRun?.encounter && !activePrompt(st); n++) st = cont(st);
  return st;
}
{
  // Physarum: bypass a non-barrier host for 1 credit a subroutine; nothing on a barrier
  const f = CARDS[C.PHYSARUM]!.holdFacts!.hostBypass!;
  for (const ice of [C.SLEIPNIR, C.CAPACITOR]) {
    const b = build(phys(ice));
    const st = encounter(b);
    const p: any = activePrompt(st);
    const subs = plannedSubroutines(b.s, iceOf(b, 0)).length;
    const barrier = ice === C.CAPACITOR;
    let paid: number | null = null;
    let bypassed = false;
    if (p) {
      const yes = getLegalActions(st, 'runner').find(a => a.type === 'RESOLVE_PROMPT' && /yes|pay|bypass/i.test(JSON.stringify((a as any).choice)));
      if (yes) {
        const after = cont(executeAction(st, yes));
        paid = st.runner.credits - after.runner.credits;
        bypassed = !after.activeRun?.encounter || after.activeRun?.icePosition !== st.activeRun?.icePosition;
      }
    }
    L11.push({
      card: C.PHYSARUM,
      field: 'hostBypass',
      state: barrier ? 'host a barrier' : 'host a code gate',
      entry: barrier ? 'not offered' : { credits: f.creditsPerSubroutine * subs },
      engine: p ? { offered: true, paid, bypassed } : 'not offered',
      agrees: barrier ? !p : paid === f.creditsPerSubroutine * subs,
    });
  }
}
{
  // Encounter effects: Funhouse, Jaguarundi (threat below and at 4), Seraph, Paywall: the prompt's options and what each does
  for (const [code, label2, o] of [
    [C.FUNHOUSE, 'untagged', {}],
    [C.JAGUARUNDI, 'threat below 4', {}],
    [C.JAGUARUNDI, 'threat 4', { corpScore: 4 }],
    [C.SERAPH, 'grip 3', { grip: [C.SLEIPNIR, C.SLEIPNIR, C.SLEIPNIR] }],
    [C.PAYWALL, 'credits 10', {}],
  ] as [string, string, Spec][]) {
    const b = build(base({ ice: [{ code }], ...o }));
    const st = encounter(b);
    const p: any = activePrompt(st);
    const entry = CARDS[code]?.holdFacts?.encounter ?? null;
    const opts = p ? getLegalActions(st, 'runner').filter(a => a.type === 'RESOLVE_PROMPT') : [];
    const effects = opts.map(a => {
      const r = executeAction(structuredClone(st), a);
      return {
        choice: (a as any).choice?.optionId ?? (a as any).choice?.kind,
        credits: r.runner.credits - st.runner.credits,
        tags: r.runner.tags - st.runner.tags,
        grip: r.runner.grip.length - st.runner.grip.length,
        clicks: r.runner.clicks - st.runner.clicks,
        runEnded: !r.activeRun,
      };
    });
    const noPrompt = !p
      ? { credits: st.runner.credits - b.s.runner.credits, tags: st.runner.tags - b.s.runner.tags, clicksAfterRunClick: st.runner.clicks - (b.s.runner.clicks - 1) }
      : null;
    // agrees: each option of the entry's toll/unless appears among the engine's answers (or, with no prompt, the loss matches)
    const want: { tags?: number; netDamage?: number; clicks?: number; loses?: number; endRun?: boolean }[] = [];
    if (entry?.toll) want.push({ tags: entry.toll.tags, loses: entry.toll.loses, endRun: entry.toll.endRun });
    if (entry?.unless?.tags) want.push({ tags: entry.unless.tags });
    if (entry?.unless?.netDamage) want.push({ netDamage: entry.unless.netDamage });
    if (entry?.unless?.clicks) want.push({ clicks: entry.unless.clicks });
    const active = !entry?.threatAtLeast || Math.max(b.s.corp.score, b.s.runner.score) >= entry.threatAtLeast;
    let agrees: boolean;
    if (!active) agrees = !p && (noPrompt?.tags ?? 0) === 0;
    else if (entry?.loses && !entry.toll) agrees = !p && noPrompt?.credits === -entry.loses;
    else
      agrees = want.every(w =>
        effects.some(
          e =>
            (w.tags === undefined || e.tags === w.tags) &&
            (w.netDamage === undefined || e.grip === -w.netDamage) &&
            (w.clicks === undefined || e.clicks === -w.clicks) &&
            (w.loses === undefined || e.credits === -w.loses) &&
            (!w.endRun || e.runEnded)
        )
      );
    L11.push({ card: code, field: 'encounter', state: label2, entry, engine: p ? { prompt: true, options: effects } : { prompt: false, ...noPrompt }, agrees });
  }
}

// ------------------------------------------------------------------------------------------------ run the boards, the twin rule
const MAL_FLAG = (b: Built) => `once:${b.rig[0]}:0`;
function materialize(spec: Spec, board: Board): Built {
  const b = build(spec);
  if (spec.turnFlags?.MAL_FLAG) {
    delete b.s.turnFlags.MAL_FLAG;
    b.s.turnFlags[MAL_FLAG(b)] = 1;
  }
  if (board.branch.includes('once-per-run use spent') && spec === board.spec) {
    // A run under way on the board's server, before its ice, with Pressure Spike's once-per-run flag set (its spikeKey)
    let st = executeAction(b.s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: b.server });
    st = structuredClone(st);
    const spikeCard = st.runner.rig.programs.find(c => c.instanceId === b.rig[0])!;
    st.activeRun!.runFlags = { ...(st.activeRun!.runFlags ?? {}), [spikeKey(spikeCard)]: true } as any;
    b.s = st;
  }
  return b;
}
export const golden: any[] = [];
export const stops: string[] = [];
for (const board of B) {
  const b = materialize(board.spec, board);
  const t = materialize(board.twin, board);
  const opts = (x: Built) => ({ target: board.target, run: board.run, decision: board.decision, extra: board.extra?.(x) });
  const read = readers(b, opts(b));
  const twin = readers(t, { ...opts(t), run: board.twinIs.includes('without the run option') ? {} : board.run });
  const differ = Object.keys(read).filter(k => JSON.stringify(read[k]) !== JSON.stringify(twin[k]));
  if (!differ.length && !board.reason) stops.push(`${board.case} / ${board.branch}: no reader differs from its twin (${board.twinIs})`);
  golden.push({
    case: board.case,
    branch: board.branch,
    twinIs: board.twinIs,
    live: differ,
    reason: board.reason ?? null,
    board: {
      server: b.server,
      ice: b.ice.map(id => iceOf(b, pos(b, id)).cardCode),
      rig: [...b.s.runner.rig.programs, ...b.s.runner.rig.hardware, ...b.s.runner.rig.resources].map(c => ({
        code: c.cardCode,
        tokens: c.tokens,
        host: c.hostedOnId ? pos(b, c.hostedOnId) : undefined,
      })),
      grip: b.s.runner.grip.map(c => c.cardCode),
      runnerCredits: b.s.runner.credits,
      corpCredits: b.s.corp.credits,
      clicks: b.s.runner.clicks,
      threat: Math.max(b.s.corp.score, b.s.runner.score),
      tags: b.s.runner.tags,
      runFlags: b.s.activeRun?.runFlags ?? null,
      turnFlags: Object.keys(b.s.turnFlags).filter(k => k.startsWith('once:')).length ? 'once flag set' : null,
    },
    run: board.run ?? null,
    readers: read,
    twin,
  });
}
void isLegalAction;
