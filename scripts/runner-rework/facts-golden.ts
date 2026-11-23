/**
 * R-A A-log: Golden values for the 26 Runner card cases + L11 engine checks.
 *
 * Base commit: 8efbf4f00ab166c4c732b18256b5e4b835262fb9 (origin/beta; src/ai and src/core identical to 7fa8b6f).
 *
 * Builds one clean board per branch of each of the 26 cases (editing a structuredClone before any
 * legality call), computes every reader's answer today (`breakPlans`, `runBypasses`, `bypassesAhead`,
 * `iceCost`, `iceCreditNeed`, `approachCost`, `runScore`, `serverHold`, Corp `chooseRez`), plus L11
 * engine-vs-entry checks (starting with Friend of a Friend), and writes
 * `tests/fixtures/runner-facts/golden.json`.
 *
 * Usage:
 *   npx vite-node scripts/runner-rework/facts-golden.ts [outPath]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  GameState,
  createCardInstance,
  createInitialGameState,
  executeAction,
} from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { ALL_DECKS } from '../nsg-sample-decks';
const STARTER_CORP_DECK = ALL_DECKS.find(d => d.side === 'corp')!;
const STARTER_RUNNER_DECK = ALL_DECKS.find(d => d.side === 'runner')!;
import {
  approachCost,
  breakPlans,
  bypassesAhead,
  iceCost,
  iceCreditNeed,
  runBypasses,
  runScore,
} from '../../src/ai/runs';
import { serverHold } from '../../src/ai/corp/hold';
import { HeuristicCorpAI } from '../../src/ai/corpAI';
import { HeuristicRunnerAI } from '../../src/ai/runnerAI';
import { CARDS } from '../../src/ai/cards';
import { clearHandCaches } from '../../src/ai/handValues';
import { clearDamageThreats } from '../../src/ai/effectValues';
import { clearBuildTargets } from '../../src/ai/valueModel';
import { clearDeckShares } from '../../src/ai/iceValues';

const OUT_PATH = process.argv.slice(2).find(a => a !== '--') ?? 'tests/fixtures/runner-facts/golden.json';
const BASE_COMMIT = execSync('git rev-parse HEAD').toString().trim();

// Reference ice codes
const PALISADE = '30040'; // Barrier str 2, 1 sub: End the run. (all-ETR barrier)
const BRAN = '30039'; // Barrier - Bioroid str 6, 2 subs (mixed barrier)
const WHITESPACE = '30074'; // Code Gate str 0
const DIVINER = '30046'; // Code Gate - AP str 3
const KARUNA = '30047'; // Sentry - AP str 3
const BALLISTA = '30062'; // Sentry - Destroyer str 4
const EMPIRICIST = '35052'; // Sentry - Observer str 5
const FUNHOUSE = '30054'; // Code Gate str 4
const PHAROS = '30063'; // Sentry str 2
const OFFWORLD = '30069'; // Agenda (remote target)

function resetCaches() {
  clearHandCaches();
  clearDamageThreats();
  clearBuildTargets();
  clearDeckShares();
}

function makeBaseBoard(opts: {
  corpId?: string;
  runnerId?: string;
  corpCredits?: number;
  runnerCredits?: number;
  runnerClicks?: number;
  corpScore?: number;
  runnerScore?: number;
  runnerTags?: number;
  server?: string;
  ice?: { code: string; rezzed?: boolean; counters?: Record<string, number>; hosted?: { code: string; tokens?: Record<string, number> }[] }[];
  root?: { code: string; rezzed?: boolean; faceUp?: boolean; adv?: number }[];
  rig?: {
    programs?: { code: string; tokens?: Record<string, number> }[];
    hardware?: { code: string; tokens?: Record<string, number> }[];
    resources?: { code: string; tokens?: Record<string, number>; hostedCount?: number }[];
  };
  grip?: string[];
  turnFlags?: Record<string, number>;
  runFlags?: Record<string, number>;
}): { state: GameState; serverId: string; iceIds: string[] } {
  const setup = deckGameSetup(4242, STARTER_CORP_DECK, STARTER_RUNNER_DECK);
  const s = structuredClone(createInitialGameState(setup));
  // Start cleanly in Runner's action phase with no pending prompts
  s.pendingPrompts = [];
  s.activePlayer = 'runner';
  s.phase = 'runner_turn';
  s.turnNumber = 3;
  s.corp.credits = opts.corpCredits ?? 10;
  s.runner.credits = opts.runnerCredits ?? 10;
  s.runner.clicks = opts.runnerClicks ?? 4;
  s.corp.score = opts.corpScore ?? 0;
  s.runner.score = opts.runnerScore ?? 0;
  s.runner.tags = opts.runnerTags ?? 0;
  if (opts.corpId) s.corp.identity = createCardInstance(s, opts.corpId);
  if (opts.runnerId) s.runner.identity = createCardInstance(s, opts.runnerId);
  if (opts.turnFlags) s.turnFlags = { ...opts.turnFlags };

  const serverId = opts.server ?? 'remote-1';
  if (!s.corp.servers[serverId]) {
    s.corp.servers[serverId] = { id: serverId, isRemote: serverId.startsWith('remote'), ice: [], root: [] };
  }
  const sv = s.corp.servers[serverId];
  const iceIds: string[] = [];
  for (const spec of opts.ice ?? []) {
    const ice = createCardInstance(s, spec.code);
    ice.isRezzed = spec.rezzed ?? true;
    ice.runnerKnows = ice.isRezzed;
    if (spec.counters) ice.tokens = { ...spec.counters };
    if (spec.hosted) {
      ice.hostedCards = spec.hosted.map(h => {
        const hc = createCardInstance(s, h.code);
        hc.isRezzed = true;
        if (h.tokens) hc.tokens = { ...h.tokens };
        return hc;
      });
    }
    sv.ice.push(ice);
    iceIds.push(ice.instanceId);
  }
  for (const spec of opts.root ?? [{ code: OFFWORLD, rezzed: false, adv: 1 }]) {
    const r = createCardInstance(s, spec.code);
    r.isRezzed = spec.rezzed ?? false;
    r.faceUp = spec.faceUp ?? false;
    r.advancementCounters = spec.adv ?? 0;
    sv.root.push(r);
  }
  for (const p of opts.rig?.programs ?? []) {
    const c = createCardInstance(s, p.code);
    c.isRezzed = true;
    if (p.tokens) c.tokens = { ...p.tokens };
    s.runner.rig.programs.push(c);
  }
  for (const h of opts.rig?.hardware ?? []) {
    const c = createCardInstance(s, h.code);
    c.isRezzed = true;
    if (h.tokens) c.tokens = { ...h.tokens };
    s.runner.rig.hardware.push(c);
  }
  for (const r of opts.rig?.resources ?? []) {
    const c = createCardInstance(s, r.code);
    c.isRezzed = true;
    if (r.tokens) c.tokens = { ...r.tokens };
    if (r.hostedCount) {
      c.hostedCards = Array.from({ length: r.hostedCount }, () => createCardInstance(s, '30028'));
    }
    s.runner.rig.resources.push(c);
  }
  if (opts.grip) {
    s.runner.grip = opts.grip.map(code => createCardInstance(s, code));
  }
  if (opts.runFlags) {
    s.activeRun = {
      server: serverId,
      icePosition: sv.ice.length - 1,
      phase: 'approach_ice',
      encounter: null,
      isSuccessful: false,
      cannotJackOut: false,
      cannotStealOrTrash: false,
      stoleAgenda: false,
      iceRezCostIncrease: 0,
      bonusCredits: 0,
      subroutineResolved: false,
      shredArmed: false,
      redirectToHq: false,
      eventCode: null,
      runBoosts: {},
      trashAtRunEnd: [],
      runEffects: [],
      accessed: [],
      breached: false,
      runFlags: { ...opts.runFlags },
    };
  }
  return { state: s, serverId, iceIds };
}

function normNum(x: number | null | undefined): number | string | null {
  if (x === null || x === undefined) return null;
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  return Number(x.toFixed(6));
}

function readBoard(name: string, card: string, branch: string, built: { state: GameState; serverId: string; iceIds: string[] }, extra?: { rankTop?: boolean }) {
  resetCaches();
  const { state, serverId } = built;
  const sv = state.corp.servers[serverId];
  const primaryIce = sv.ice[sv.ice.length - 1] ?? null;

  const iceReaders = primaryIce
    ? {
        iceCode: primaryIce.cardCode,
        iceRezzed: primaryIce.isRezzed,
        breakPlans: breakPlans(structuredClone(state), structuredClone(primaryIce), 1).map(bp => ({
          breaker: bp.plan.breaker.cardCode,
          credits: normNum(bp.plan.credits),
          boosts: bp.plan.boostsNeeded,
          spends: bp.spends,
        })),
        iceCost: normNum(iceCost(structuredClone(state), structuredClone(primaryIce))),
        iceCreditNeed: normNum(iceCreditNeed(structuredClone(state), structuredClone(primaryIce))),
      }
    : null;

  const byp = runBypasses(structuredClone(state), serverId);
  const bypAhead = bypassesAhead(structuredClone(state), structuredClone(sv.ice), false);
  const appr = approachCost(structuredClone(state), serverId, state.runner.clicks - 1, state.runner.credits);
  const rScore = runScore(structuredClone(state), serverId);
  const hold = serverHold(structuredClone(state), serverId, { when: 'nextTurn' });

  // Corp rez decision if there is an unrezzed ice (or test rezzing primaryIce on a cloned approach state)
  let corpRez: string | null = null;
  if (primaryIce) {
    const rezState = structuredClone(state);
    const target = rezState.corp.servers[serverId].ice[rezState.corp.servers[serverId].ice.length - 1];
    target.isRezzed = false;
    rezState.activeRun = {
      server: serverId,
      icePosition: rezState.corp.servers[serverId].ice.length - 1,
      phase: 'approach_ice',
      encounter: null,
      isSuccessful: false,
      cannotJackOut: false,
      cannotStealOrTrash: false,
      stoleAgenda: false,
      iceRezCostIncrease: 0,
      bonusCredits: 0,
      subroutineResolved: false,
      shredArmed: false,
      redirectToHq: false,
      eventCode: null,
      runBoosts: {},
      trashAtRunEnd: [],
      runEffects: [],
      accessed: [],
      breached: false,
    };
    const corpAi = new HeuristicCorpAI(true, false);
    const pick = corpAi.chooseRez(rezState, [target]);
    corpRez = pick ? pick.type : 'PASS';
  }

  let topRanked: { type: string; score: number | string | null }[] | undefined;
  if (extra?.rankTop) {
    const rAi = new HeuristicRunnerAI(true, false);
    topRanked = rAi
      .rankMainActions(structuredClone(state))
      .slice(0, 4)
      .map(r => ({ type: r.action.type, score: normNum(r.score) }));
  }

  return {
    name,
    card,
    branch,
    serverId,
    ice: iceReaders,
    runBypasses: {
      count: byp.ids.size,
      price: normNum(byp.price),
    },
    bypassesAheadCount: bypAhead.size,
    approachCost: appr ? { cost: normNum(appr.cost), credits: normNum(appr.credits) } : null,
    runScore: normNum(rScore),
    serverHold: {
      holds: hold.holds,
      margin: normNum((hold as any).margin ?? null),
      cost: normNum((hold as any).cost ?? null),
    },
    corpRez,
    ...(topRanked ? { topRanked } : {}),
  };
}

/** L11: Play a card's engine ability on a built board and compare against the card entry's numeric fact. */
function runL11Checks() {
  const rows: Record<string, unknown>[] = [];

  // 1. Friend of a Friend (34074): entry clickMoney vs engine credits gained (untagged vs tagged)
  for (const tags of [0, 1]) {
    const setup = deckGameSetup(4242, STARTER_CORP_DECK, STARTER_RUNNER_DECK);
    const s = structuredClone(createInitialGameState(setup));
    s.pendingPrompts = [];
    s.activePlayer = 'runner';
    s.phase = 'runner_turn';
    s.runner.clicks = 4;
    s.runner.credits = 5;
    s.runner.tags = tags;
    const foaf = createCardInstance(s, '34074');
    foaf.isRezzed = true;
    s.runner.rig.resources.push(foaf);
    const rawCm = CARDS['34074']?.holdFacts?.clickMoney as any;
    const entryFact = typeof rawCm === 'function' ? rawCm(s, foaf) : rawCm ?? null;
    const after = executeAction(structuredClone(s), { type: 'USE_ABILITY', player: 'runner', cardInstanceId: foaf.instanceId, abilityIndex: 0 });
    const engineCredits = after.runner.credits - s.runner.credits;
    rows.push({
      card: '34074',
      title: 'Friend of a Friend',
      branch: tags > 0 ? 'tagged' : 'untagged',
      field: 'holdFacts.clickMoney.credits',
      entryValue: entryFact?.credits ?? null,
      engineValue: engineCredits,
      agrees: entryFact?.credits === engineCredits,
    });
  }

  // 2. Telework Contract (30027): clickMoney vs engine credits gained
  {
    const setup = deckGameSetup(4242, STARTER_CORP_DECK, STARTER_RUNNER_DECK);
    const s = structuredClone(createInitialGameState(setup));
    s.pendingPrompts = [];
    s.activePlayer = 'runner';
    s.phase = 'runner_turn';
    s.runner.clicks = 4;
    s.runner.credits = 5;
    const tc = createCardInstance(s, '30027');
    tc.isRezzed = true;
    tc.tokens = { credit: 9 };
    s.runner.rig.resources.push(tc);
    const rawCm = CARDS['30027']?.holdFacts?.clickMoney as any;
    const entryFact = typeof rawCm === 'function' ? rawCm(s, tc) : rawCm ?? null;
    const after = executeAction(structuredClone(s), { type: 'USE_ABILITY', player: 'runner', cardInstanceId: tc.instanceId, abilityIndex: 0 });
    const engineCredits = after.runner.credits - s.runner.credits;
    rows.push({
      card: '30027',
      title: 'Telework Contract',
      branch: '9 hosted credits',
      field: 'holdFacts.clickMoney.credits',
      entryValue: entryFact?.credits ?? null,
      engineValue: engineCredits,
      agrees: entryFact?.credits === engineCredits,
    });
  }

  return rows;
}

function main() {
  const boards: any[] = [];

  // 1. Pressure Spike (34092): threat < 4, threat >= 4, once-per-run spent
  boards.push(readBoard('pressure_spike_threat_0', '34092', 'threat<4', makeBaseBoard({ ice: [{ code: BALLISTA }], rig: { programs: [{ code: '34092' }] }, corpScore: 0 })));
  boards.push(readBoard('pressure_spike_threat_4', '34092', 'threat>=4', makeBaseBoard({ ice: [{ code: BALLISTA }], rig: { programs: [{ code: '34092' }] }, corpScore: 4 })));
  boards.push(readBoard('pressure_spike_spent', '34092', 'once-per-run spent', makeBaseBoard({ ice: [{ code: BALLISTA }], rig: { programs: [{ code: '34092' }] }, corpScore: 4, runFlags: { pressureSpike: 1 } })));

  // 2. Malandragem (34081): mode 1 (power counter, str<=3), turn flag set, mode 2 (threat 4, no counter)
  boards.push(readBoard('malandragem_counter', '34081', 'mode1: power counter str<=3', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { hardware: [{ code: '34081', tokens: { power: 1 } }] } })));
  boards.push(readBoard('malandragem_used', '34081', 'mode1: turn flag set', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { hardware: [{ code: '34081', tokens: { power: 1 } }] }, turnFlags: { 'once:inst-101:0': 1 } })));
  boards.push(readBoard('malandragem_threat4', '34081', 'mode2: threat>=4 remove', makeBaseBoard({ ice: [{ code: BALLISTA }], rig: { hardware: [{ code: '34081', tokens: { power: 0 } }] }, corpScore: 4 })));

  // 3. Curupira (34015): 2, 3, 6 counters on a barrier
  for (const n of [2, 3, 6]) {
    boards.push(readBoard(`curupira_${n}`, '34015', `${n} virus counters on barrier`, makeBaseBoard({ ice: [{ code: PALISADE }], rig: { programs: [{ code: '34015', tokens: { virus: n } }] } })));
  }

  // 4. Banner (34005): all-ETR barrier vs mixed barrier
  boards.push(readBoard('banner_all_etr', '34005', 'all-ETR barrier', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { programs: [{ code: '34005' }] } })));
  boards.push(readBoard('banner_mixed', '34005', 'mixed barrier', makeBaseBoard({ ice: [{ code: BRAN }], rig: { programs: [{ code: '34005' }] } })));

  // 5. Laser Pointer (34016): AP, Destroyer, Observer, none
  boards.push(readBoard('laser_pointer_ap', '34016', 'AP ice', makeBaseBoard({ ice: [{ code: KARUNA }], rig: { hardware: [{ code: '34016' }] } })));
  boards.push(readBoard('laser_pointer_destroyer', '34016', 'Destroyer ice', makeBaseBoard({ ice: [{ code: BALLISTA }], rig: { hardware: [{ code: '34016' }] } })));
  boards.push(readBoard('laser_pointer_observer', '34016', 'Observer ice', makeBaseBoard({ ice: [{ code: EMPIRICIST }], rig: { hardware: [{ code: '34016' }] } })));
  boards.push(readBoard('laser_pointer_none', '34016', 'non-matching barrier', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { hardware: [{ code: '34016' }] } })));

  // 6. Fransofia Ward (35021): 14 vs 15 Corp credits
  boards.push(readBoard('fransofia_14cr', '35021', 'Corp 14 credits', makeBaseBoard({ corpCredits: 14, ice: [{ code: PALISADE }], rig: { resources: [{ code: '35021' }] } })));
  boards.push(readBoard('fransofia_15cr', '35021', 'Corp 15 credits', makeBaseBoard({ corpCredits: 15, ice: [{ code: PALISADE }], rig: { resources: [{ code: '35021' }] } })));

  // 7. Lobisomem (34090): with/without power counter, barrier vs non-barrier
  boards.push(readBoard('lobisomem_bar_counter', '34090', 'barrier + power counter', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { programs: [{ code: '34090', tokens: { power: 1 } }] } })));
  boards.push(readBoard('lobisomem_bar_empty', '34090', 'barrier + 0 counters', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { programs: [{ code: '34090', tokens: { power: 0 } }] } })));
  boards.push(readBoard('lobisomem_nonbar', '34090', 'non-barrier + counter', makeBaseBoard({ ice: [{ code: WHITESPACE }], rig: { programs: [{ code: '34090', tokens: { power: 1 } }] } })));

  // 8. S-Dobrado (34012) & Alarm Clock (34078): first ice; second at threat 4 with & without click
  for (const [code, label] of [['34012', 'sdobrado'], ['34078', 'alarm_clock']] as const) {
    boards.push(readBoard(`${label}_1ice`, code, 'first ice', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { programs: [{ code }] } })));
    boards.push(readBoard(`${label}_2ice_t4_click`, code, '2 ice threat 4 with click', makeBaseBoard({ corpScore: 4, runnerClicks: 4, ice: [{ code: PALISADE }, { code: BALLISTA }], rig: { programs: [{ code }] } })));
    boards.push(readBoard(`${label}_2ice_t4_noclick`, code, '2 ice threat 4 1 click', makeBaseBoard({ corpScore: 4, runnerClicks: 1, ice: [{ code: PALISADE }, { code: BALLISTA }], rig: { programs: [{ code }] } })));
  }

  // 9. Mayfly (30032), BANGUN (35068), Hantu (35008), Audrey v2 (34004), Corsair (36004), Slap Vandal (34026)
  boards.push(readBoard('mayfly_match', '30032', 'breaks barrier', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { programs: [{ code: '30032' }] } })));
  boards.push(readBoard('mayfly_highstr', '30032', 'breaks high-str sentry', makeBaseBoard({ ice: [{ code: EMPIRICIST }], rig: { programs: [{ code: '30032' }] } })));
  boards.push(readBoard('bangun_faceup', '35068', 'faceup agenda in remote', makeBaseBoard({ corpId: '35068', root: [{ code: OFFWORLD, faceUp: true }] })));
  boards.push(readBoard('bangun_facedown', '35068', 'facedown agenda in remote', makeBaseBoard({ corpId: '35068', root: [{ code: OFFWORLD, faceUp: false }] })));
  boards.push(readBoard('hantu_match', '35008', 'code gate + virus counters', makeBaseBoard({ ice: [{ code: WHITESPACE }], rig: { programs: [{ code: '35008', tokens: { virus: 3 } }] } })));
  boards.push(readBoard('hantu_nomatch', '35008', 'barrier (no match)', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { programs: [{ code: '35008', tokens: { virus: 3 } }] } })));
  boards.push(readBoard('audrey_match', '34004', 'sentry + power counters', makeBaseBoard({ ice: [{ code: KARUNA }], rig: { programs: [{ code: '34004', tokens: { power: 2 } }] } })));
  boards.push(readBoard('audrey_nomatch', '34004', 'barrier (no match)', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { programs: [{ code: '34004', tokens: { power: 2 } }] } })));
  boards.push(readBoard('corsair_match', '36004', 'sentry', makeBaseBoard({ ice: [{ code: KARUNA }], rig: { programs: [{ code: '36004' }] } })));
  boards.push(readBoard('corsair_nomatch', '36004', 'code gate (no match)', makeBaseBoard({ ice: [{ code: WHITESPACE }], rig: { programs: [{ code: '36004' }] } })));
  boards.push(readBoard('slap_vandal_match', '34026', 'barrier', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { programs: [{ code: '34026' }] } })));
  boards.push(readBoard('slap_vandal_nomatch', '34026', 'sentry (no match)', makeBaseBoard({ ice: [{ code: KARUNA }], rig: { programs: [{ code: '34026' }] } })));

  // 10. Botulus (30004) & Tranquilizer (30017): hosted, and in grip with 0, 1, 2 targets
  boards.push(readBoard('botulus_hosted', '30004', 'hosted with 2 virus', makeBaseBoard({ ice: [{ code: PALISADE, hosted: [{ code: '30004', tokens: { virus: 2 } }] }] })));
  boards.push(readBoard('botulus_grip_0', '30004', 'in grip, 0 ice targets', makeBaseBoard({ ice: [], grip: ['30004'] }), { rankTop: true }));
  boards.push(readBoard('botulus_grip_1', '30004', 'in grip, 1 ice target', makeBaseBoard({ ice: [{ code: PALISADE }], grip: ['30004'] }), { rankTop: true }));
  boards.push(readBoard('botulus_grip_2', '30004', 'in grip, 2 ice targets', makeBaseBoard({ ice: [{ code: PALISADE }, { code: BALLISTA }], grip: ['30004'] }), { rankTop: true }));
  boards.push(readBoard('tranquilizer_hosted', '30017', 'hosted with 2 virus', makeBaseBoard({ ice: [{ code: PALISADE, hosted: [{ code: '30017', tokens: { virus: 2 } }] }] })));
  boards.push(readBoard('tranquilizer_grip_0', '30017', 'in grip, 0 ice targets', makeBaseBoard({ ice: [], grip: ['30017'] }), { rankTop: true }));
  boards.push(readBoard('tranquilizer_grip_1', '30017', 'in grip, 1 ice target', makeBaseBoard({ ice: [{ code: PALISADE }], grip: ['30017'] }), { rankTop: true }));
  boards.push(readBoard('tranquilizer_grip_2', '30017', 'in grip, 2 ice targets', makeBaseBoard({ ice: [{ code: PALISADE }, { code: BALLISTA }], grip: ['30017'] }), { rankTop: true }));

  // 11. Physarum (34082), Funhouse (30054), Manegarm (30042), Idiosyncresis (35061)
  boards.push(readBoard('physarum_hosted', '34082', 'hosted on ice', makeBaseBoard({ ice: [{ code: BALLISTA, hosted: [{ code: '34082' }] }] })));
  boards.push(readBoard('funhouse_encounter', '30054', 'rezzed Funhouse', makeBaseBoard({ ice: [{ code: FUNHOUSE }] })));
  boards.push(readBoard('manegarm_root', '30042', 'rezzed Manegarm in root', makeBaseBoard({ ice: [{ code: PALISADE }], root: [{ code: '30042', rezzed: true }, { code: OFFWORLD, rezzed: false }] })));
  boards.push(readBoard('idiosyncresis_root', '35061', 'rezzed Idiosyncresis in root', makeBaseBoard({ ice: [{ code: PHAROS }], root: [{ code: '35061', rezzed: true }] })));

  // 12. Chain Reaction (36001), Window of Opportunity (34077), Jailbreak (30028), Read-Write Share (36022)
  boards.push(readBoard('chain_reaction_grip', '36001', 'in grip with iced remote', makeBaseBoard({ ice: [{ code: PALISADE }], grip: ['36001'] }), { rankTop: true }));
  boards.push(readBoard('window_of_opportunity', '34077', 'installed with breaker in grip', makeBaseBoard({ ice: [{ code: PALISADE }], rig: { hardware: [{ code: '34077' }] }, grip: ['30032'] }), { rankTop: true }));
  boards.push(readBoard('jailbreak_grip', '30028', 'in grip', makeBaseBoard({ server: 'hq', ice: [{ code: DIVINER }], grip: ['30028'] }), { rankTop: true }));
  boards.push(readBoard('read_write_share_full', '36022', '4 hosted cards (full)', makeBaseBoard({ rig: { resources: [{ code: '36022', hostedCount: 4 }] } }), { rankTop: true }));
  boards.push(readBoard('read_write_share_partial', '36022', '2 hosted cards', makeBaseBoard({ rig: { resources: [{ code: '36022', hostedCount: 2 }] } }), { rankTop: true }));

  const payload = {
    commit: BASE_COMMIT,
    boardCount: boards.length,
    boards,
    l11EngineChecks: runL11Checks(),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${boards.length} golden boards + ${payload.l11EngineChecks.length} L11 checks to ${OUT_PATH} (commit ${BASE_COMMIT.slice(0, 7)})`);
}

main();
