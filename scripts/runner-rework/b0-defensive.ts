/**
 * B0 Part D: Runner losses a defensive line avoided.
 *
 * Plays source games in an untouched `source` tree (plain GameRunner, never asked or cleared),
 * identifies every Runner loss by flatline or in which a Corp tag punishment fired in the Corp's
 * last three turns, rewinds to the Runner's last turn before the damage/punishment, and plays each
 * legal defensive line in a separate `eval` tree via GameRunner.
 *
 * Usage:
 *   POOL=batch|nrdb|human [LIMIT_LOSSES=10] [SEED=n] [SHARD=i/n] [OUT_DIR=dir] npx vite-node scripts/runner-rework/b0-defensive.ts
 *
 * Also records public-condition prevalence on every Runner turn (both losses and non-losses) for
 * reading rule 4 (cost if always taken, and R-C2's tag-removal condition).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { ALL_DECKS as SHIPPED_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';

const cliArgs = Object.fromEntries(
  process.argv
    .slice(2)
    .filter(a => a !== '--' && a.includes('='))
    .map(a => a.split('='))
);
const POOL = (cliArgs.pool ?? process.env.POOL ?? 'batch') as 'batch' | 'nrdb' | 'human';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const ONLY_SEED = Number(cliArgs.seed ?? process.env.SEED ?? 0);
const ONLY_SEEDS = new Set((cliArgs.seeds ?? process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number));
const LIMIT_LOSSES = Number(cliArgs.limit ?? process.env.LIMIT_LOSSES ?? 0);
const OUT_DIR = process.env.OUT_DIR ?? '';
const VERIFY_JSON = process.env.VERIFY_JSON ?? '';

// Corp cards that require the Runner to be tagged (or have a tag-requiring mode/ability).
// Operations with "Play only if the Runner is tagged" or "remove X tags" additional cost:
const STRICT_TAG_OPS: Record<string, { title: string; cost: number }> = {
  '30065': { title: 'Retribution', cost: 1 },
  '35065': { title: 'Bigger Picture', cost: 0 },
  '35066': { title: 'IP Enforcement', cost: 0 },
  '36044': { title: 'Unleash', cost: 0 },
};
// Operations / agendas / abilities with a tag-dependent punishment mode on the Corp's turn:
const CONDITIONAL_TAG_CARDS: Record<string, { title: string; cost: number }> = {
  '30056': { title: 'Predictive Planogram', cost: 0 },
  '30068': { title: 'Orbital Superiority', cost: 0 }, // agenda: 4 meat damage on score if tagged
  '34037': { title: 'Greasing the Palm', cost: 3 },
  '34045': { title: 'Mindscaping', cost: 2 },
  '34049': { title: 'Oracle Thinktank', cost: 0 }, // ability in Runner score area
  '35058': { title: 'Synapse Global: Faster than Thought', cost: 0 }, // identity ability
  '34065': { title: 'B-1001', cost: 0 }, // paid ability during run
};
const ALL_TAG_PUNISH_CODES = new Set([...Object.keys(STRICT_TAG_OPS), ...Object.keys(CONDITIONAL_TAG_CARDS)]);

interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  effectValues: any;
  clear: () => void;
}

async function makeAndLoadTrees(): Promise<{ root: string; source: Tree; evalTree: Tree }> {
  const root = join(tmpdir(), `b0-def-${process.pid}-${Date.now()}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const load = async (name: string): Promise<Tree> => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
    // Sequential imports: vite-node can stall on concurrent imports of a circular graph.
    const files = ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts'];
    const mods: any[] = [];
    for (const p of files) mods.push(await m(p));
    const [ai, po, core, decks, hv, ev, vm, iv] = mods;
    return {
      name,
      createAgent: ai.createAgent,
      GameRunner: po.GameRunner,
      core,
      decks,
      effectValues: ev,
      clear: () => {
        hv.clearHandCaches();
        ev.clearDamageThreats();
        vm.clearBuildTargets?.();
        iv.clearDeckShares?.();
        vm.valueLoops?.clear();
      },
    };
  };
  const source = await load('source');
  const evalTree = await load('eval');
  return { root, source, evalTree };
}

interface PublicConditions {
  turn: number;
  runnerTags: number;
  runnerGrip: number;
  runnerHandSize: number;
  runnerCredits: number;
  runnerClicks: number;
  corpCredits: number;
  hasLiveTagCardNow: boolean;
  hasLiveTagCardPlus2: boolean;
  hasInstalledResource: boolean;
  /** R-C2 condition: Runner tagged AND (live tag card affordable OR installed resource with Corp >= 2c). */
  rc2TagCondition: boolean;
  /** Strict card-only tag condition: Runner tagged AND live tag card affordable (cost <= corpCredits + 2). */
  tagCardCondition: boolean;
  /** Max Corp-turn damage from a rezzed/faceup card visible on board. */
  rezzedCorpTurnBurst: number;
  /** Max Corp-turn damage from a live card in the Corp's public decklist (affordable within corpCredits + 2). */
  deckCorpTurnBurst: number;
  /** Max damage from any live Corp card (including ice/traps) in public decklist. */
  deckAnyDmgBurst: number;
  /** Grip strictly below rezzed/visible Corp-turn damage burst. */
  condDmgRezzed: boolean;
  /** Grip strictly below live decklist Corp-turn damage burst. */
  condDmgDeck: boolean;
  /** Grip strictly below live decklist any-phase damage burst (relevant for run flatlines). */
  condDmgAny: boolean;
  /** Named public reasons that fired on this turn. */
  reasons: string[];
}

/**
 * Computes public-only conditions at the start of the Runner's turn.
 * Decklists are public (see valueModel.ts / effectValues.ts); subtracting faceup Archives and
 * both score areas uses only public zones. No hidden Corp cards (HQ/R&D/facedown) are read.
 */
function publicConditionsAt(tree: Tree, state: GameState): PublicConditions {
  const { cardDef } = tree.core;
  const { ownTurnDamage, damageThreat } = tree.effectValues;
  const corp = state.corp;
  const runner = state.runner;

  // Public decklist live pool: all Corp cards minus faceup Archives and both score areas.
  // Note: sideCards reads all zones only to reconstruct the public decklist multiset minus public gone zones,
  // exactly as damageThreat() and buildTarget() do (decklists are public information).
  const goneIds = new Set([...corp.archives.faceUp, ...corp.scoreArea, ...runner.scoreArea].map(c => c.instanceId));
  const allCorp = [
    ...corp.hq,
    ...corp.rd,
    ...corp.archives.faceUp,
    ...corp.archives.faceDown,
    ...corp.scoreArea,
    ...Object.values(corp.servers).flatMap(sv => [...sv.root, ...sv.ice]),
    ...runner.scoreArea.filter(c => cardDef(c).side_code === 'corp'),
  ];
  const liveCorp = allCorp.filter(c => !goneIds.has(c.instanceId));
  const liveCodes = new Set(liveCorp.map(c => c.cardCode));
  liveCodes.add(corp.identity.cardCode);
  // Oracle Thinktank is active when in the Runner's score area (public!).
  for (const c of runner.scoreArea) if (c.cardCode === '34049') liveCodes.add('34049');

  const tagCardAffordable = (budget: number) => {
    for (const code of liveCodes) {
      if (!ALL_TAG_PUNISH_CODES.has(code)) continue;
      if (code === '34049') {
        if (runner.scoreArea.some(c => c.cardCode === '34049')) return true;
        continue;
      }
      if (code === '35058') {
        if (corp.identity.cardCode === '35058') return true;
        continue;
      }
      const info = STRICT_TAG_OPS[code] ?? CONDITIONAL_TAG_CARDS[code];
      if (!info) continue;
      if (info.cost <= budget) return true;
    }
    return false;
  };

  const hasLiveTagCardNow = tagCardAffordable(corp.credits);
  const hasLiveTagCardPlus2 = tagCardAffordable(corp.credits + 2);
  const hasInstalledResource = runner.rig.resources.length > 0 && corp.credits >= 2;
  const rc2TagCondition = runner.tags > 0 && (hasLiveTagCardPlus2 || hasInstalledResource);
  const tagCardCondition = runner.tags > 0 && hasLiveTagCardPlus2;

  // Visible/rezzed Corp-turn damage burst on board (strictly public board state).
  let rezzedCorpTurnBurst = 0;
  for (const sv of Object.values(corp.servers)) {
    for (const c of sv.root) {
      if (!c.isRezzed && !c.faceUp) continue;
      if (cardDef(c).type_code === 'ice') continue;
      const d = ownTurnDamage(state, c.cardCode);
      if (d > rezzedCorpTurnBurst) rezzedCorpTurnBurst = d;
    }
  }
  if (corp.identity) {
    const d = ownTurnDamage(state, corp.identity.cardCode);
    if (d > rezzedCorpTurnBurst) rezzedCorpTurnBurst = d;
  }

  // Live decklist Corp-turn damage burst (cards affordable within corpCredits + 2, or agendas/assets).
  let deckCorpTurnBurst = 0;
  for (const code of liveCodes) {
    const def = tree.core.getCardDefinition(code);
    if (!def || def.type_code === 'ice') continue;
    const cost = def.cost ?? 0;
    if (def.type_code === 'operation' && cost > corp.credits + 2) continue;
    const d = ownTurnDamage(state, code);
    if (d > deckCorpTurnBurst) deckCorpTurnBurst = d;
  }

  const deckAnyDmgBurst = damageThreat(state, false).burst;
  const runnerGrip = runner.grip.length;
  const condDmgRezzed = rezzedCorpTurnBurst > 0 && runnerGrip < rezzedCorpTurnBurst;
  const condDmgDeck = deckCorpTurnBurst > 0 && runnerGrip < deckCorpTurnBurst;
  const condDmgAny = deckAnyDmgBurst > 0 && runnerGrip < deckAnyDmgBurst;

  const reasons: string[] = [];
  if (rc2TagCondition) reasons.push('rc2_tag');
  if (tagCardCondition) reasons.push('tag_card');
  if (condDmgRezzed) reasons.push('dmg_rezzed');
  if (condDmgDeck) reasons.push('dmg_deck');
  if (condDmgAny) reasons.push('dmg_any');

  return {
    turn: state.turnNumber,
    runnerTags: runner.tags,
    runnerGrip,
    runnerHandSize: runner.handSizeLimit ?? 5,
    runnerCredits: runner.credits,
    runnerClicks: runner.clicks,
    corpCredits: corp.credits,
    hasLiveTagCardNow,
    hasLiveTagCardPlus2,
    hasInstalledResource,
    rc2TagCondition,
    tagCardCondition,
    rezzedCorpTurnBurst,
    deckCorpTurnBurst,
    deckAnyDmgBurst,
    condDmgRezzed,
    condDmgDeck,
    condDmgAny,
    reasons,
  };
}

interface TurnOutcome {
  stolen: number;
  breached: string[];
  trashed: number;
  cr: number;
  win: string | null;
}

/** HIDDEN READ (measurement only): non-agenda Corp root instanceIds to count assets/upgrades trashed. */
function nonAgendaRootIds(tree: Tree, s: GameState): Set<string> {
  const ids = new Set<string>();
  for (const sv of Object.values(s.corp.servers)) {
    for (const c of sv.root) {
      if (tree.core.cardDef(c).type_code !== 'agenda') ids.add(c.instanceId);
    }
  }
  return ids;
}

function computeOutcome(tree: Tree, start: GameState, end: GameState, breachedServers: string[]): TurnOutcome {
  // HIDDEN READ (measurement only): checks Corp root cards that moved to Archives.
  const before = nonAgendaRootIds(tree, start);
  const trashed = [...end.corp.archives.faceUp, ...end.corp.archives.faceDown].filter(c => before.has(c.instanceId)).length;
  return {
    stolen: end.runner.score - start.runner.score,
    breached: [...new Set(breachedServers)].sort(),
    trashed,
    cr: end.runner.credits,
    win: end.winner ?? null,
  };
}

interface TagPunishEvent {
  turn: number;
  corpTurnIdx: number;
  cardCode: string;
  title: string;
  kind: 'card' | 'resource_trash';
  damageDealt: number;
}

/**
 * Detects whether a step fired a Corp tag punishment (or TRASH_RESOURCE).
 * HIDDEN READ (measurement only): inspects action cardInstanceId via findCardAnywhere.
 */
function detectTagPunish(tree: Tree, before: GameState, after: GameState, act: GameAction | null, corpTurnIdx: number): TagPunishEvent | null {
  if (!act || before.runner.tags <= 0) return null;
  const { findCardAnywhere, cardDef } = tree.core;
  const dmg = Math.max(0, before.runner.grip.length - after.runner.grip.length);

  if (act.type === 'TRASH_RESOURCE') {
    return { turn: before.turnNumber, corpTurnIdx, cardCode: 'basic', title: 'Trash Resource', kind: 'resource_trash', damageDealt: 0 };
  }
  if (act.type === 'PLAY_OPERATION_OR_EVENT' && act.player === 'corp') {
    // HIDDEN READ (measurement only)
    const c = findCardAnywhere(before, act.cardInstanceId);
    if (!c) return null;
    if (STRICT_TAG_OPS[c.cardCode]) {
      return { turn: before.turnNumber, corpTurnIdx, cardCode: c.cardCode, title: cardDef(c).title, kind: 'card', damageDealt: dmg };
    }
    if (c.cardCode === '30056') {
      return { turn: before.turnNumber, corpTurnIdx, cardCode: c.cardCode, title: cardDef(c).title, kind: 'card', damageDealt: 0 };
    }
    if (c.cardCode === '34037' && after.runner.tags < before.runner.tags) {
      return { turn: before.turnNumber, corpTurnIdx, cardCode: c.cardCode, title: cardDef(c).title, kind: 'card', damageDealt: 0 };
    }
    if (c.cardCode === '34045') {
      // Mindscaping: only tag punishment if damage mode is chosen (handled in prompt or immediately).
      if (dmg > 0 || after.winner === 'corp') {
        return { turn: before.turnNumber, corpTurnIdx, cardCode: c.cardCode, title: cardDef(c).title, kind: 'card', damageDealt: dmg };
      }
    }
  }
  if (act.type === 'RESOLVE_PROMPT' && act.player === 'corp') {
    const prompt = before.pendingPrompts[0];
    if (prompt && 'source' in prompt && prompt.source.cardCode === '34045' && (dmg > 0 || after.winner === 'corp')) {
      return { turn: before.turnNumber, corpTurnIdx, cardCode: '34045', title: 'Mindscaping', kind: 'card', damageDealt: dmg };
    }
  }
  if (act.type === 'SCORE_AGENDA' && act.player === 'corp') {
    // HIDDEN READ (measurement only)
    const c = findCardAnywhere(before, act.cardInstanceId);
    if (c && c.cardCode === '30068') {
      return { turn: before.turnNumber, corpTurnIdx, cardCode: '30068', title: 'Orbital Superiority', kind: 'card', damageDealt: Math.max(dmg, 4) };
    }
  }
  if (act.type === 'USE_ABILITY' && act.player === 'corp') {
    const c = findCardAnywhere(before, act.cardInstanceId);
    if (c && (c.cardCode === '34049' || c.cardCode === '35058' || c.cardCode === '34065')) {
      if (after.runner.tags < before.runner.tags) {
        return { turn: before.turnNumber, corpTurnIdx, cardCode: c.cardCode, title: cardDef(c).title, kind: 'card', damageDealt: 0 };
      }
    }
  }
  return null;
}

// Pure lines (Gemini's): the defensive clicks, then END_TURN (neither run nor install otherwise).
// Play lines (B0 rev 2, point 4): the same defensive clicks first, then the Normal Runner plays the rest of its turn
// as it would (runs included). `actual` is the control: the Normal Runner plays the whole turn from the board, which
// must reproduce the recorded loss. A loss is avoided by a defensive move only if a play line survives where `actual`
// does not; if only a pure line survives, it was avoided by not making the run(s).
type DefensiveLineName =
  | 'actual'
  | 'do_nothing'
  | 'remove_tags'
  | 'draw_up'
  | 'both'
  | 'remove_tags_then_play'
  | 'draw_up_then_play'
  | 'both_then_play'
  // Click control: k clicks for credits, then the Runner plays on. A play line's survival counts as the defensive
  // move's only if the control with the same number of spent clicks does not survive (else fewer runs did it).
  | `credits${number}_then_play`;
const ALL_LINES: DefensiveLineName[] = ['actual', 'do_nothing', 'remove_tags', 'draw_up', 'both', 'remove_tags_then_play', 'draw_up_then_play', 'both_then_play'];

/**
 * B0 rev 2, point 5. HIDDEN READ (measurement only): at the start of a Corp turn, is the Corp's kill still on the
 * table? tagKill: the Runner is tagged and the Corp holds (HQ), has installed, has as identity, or has given the Runner
 * (Oracle Thinktank) a tag-punishment card whose cost fits its credits + 2. dmgKill: the largest Corp-turn damage of a
 * non-ice card in HQ or installed (rezzed or not; operations only if affordable within credits + 2) is above the grip.
 */
interface KillCheck { tagKill: string[]; maxDmg: number; dmgKill: boolean; grip: number; tags: number; corpCr: number }
function killCheck(tree: Tree, s: GameState): KillCheck {
  const { cardDef } = tree.core;
  const { ownTurnDamage } = tree.effectValues;
  const budget = s.corp.credits + 2;
  const held = [
    ...s.corp.hq,
    ...Object.values(s.corp.servers).flatMap(sv => [...sv.root, ...sv.ice]),
    s.corp.identity,
    ...s.runner.scoreArea.filter(c => c.cardCode === '34049'),
  ].filter(Boolean);
  const tagKill: string[] = [];
  let maxDmg = 0;
  for (const c of held) {
    const def = cardDef(c);
    const info = STRICT_TAG_OPS[c.cardCode] ?? CONDITIONAL_TAG_CARDS[c.cardCode];
    if (s.runner.tags > 0 && info && info.cost <= budget) tagKill.push(info.title);
    if (def.type_code === 'ice') continue;
    if (def.type_code === 'operation' && (def.cost ?? 0) > budget) continue;
    const d = ownTurnDamage(s, c.cardCode);
    if (d > maxDmg) maxDmg = d;
  }
  return { tagKill, maxDmg, dmgKill: maxDmg > s.runner.grip.length, grip: s.runner.grip.length, tags: s.runner.tags, corpCr: s.corp.credits };
}

interface LineResult {
  line: DefensiveLineName;
  legal: boolean;
  actions: string[];
  endTurnGrip: number;
  endTurnTags: number;
  survivedNextCorpTurn: boolean;
  winnerAfterNextCorpTurn: string | null;
  winReasonAfterNextCorpTurn: string | null;
  /** The turn number and active side when the window ended (death or the Runner's next turn). */
  windowEndTurn: number;
  punishmentStillFired: boolean;
  punishmentsFired: string[];
  /** Point 5: kill check at the start of the Corp turn after the line's Runner turn (null if the Runner died first). */
  killAtCorpStart: KillCheck | null;
  /** Point 5: the same check at the start of the Corp turn after that (the Corp's next chance), if reached. */
  killAtNextCorpStart: KillCheck | null;
  /** The game played on to its end (80-turn cap) from the line. */
  finalWinner: string | null;
  finalWinReason: string | null;
  finalTurn: number;
  outcome: TurnOutcome;
  gaveUp: { stolen: number; breachedLost: number; trashed: number; crDiff: number };
}

/**
 * Plays a single line from `board` (start of Runner's turn) through the end of the Runner's turn and the next Corp
 * turn (the window) using `GameRunner` in `evalTree`, then on to the end of the game.
 */
function runDefensiveLine(
  evalTree: Tree,
  board: GameState,
  line: DefensiveLineName,
  targetGrip: number,
  actualOutcome: TurnOutcome
): LineResult {
  evalTree.clear();
  const start = structuredClone(board);
  const agents = {
    corp: evalTree.createAgent('corp', 'normal'),
    runner: evalTree.createAgent('runner', 'normal'),
  };
  const runner = new evalTree.GameRunner(start, agents);
  const { isLegalAction, actingSide } = evalTree.core;

  const actions: string[] = [];
  const startTurn = start.turnNumber;
  const play = line === 'actual' || line.endsWith('_then_play');
  const creditClicks = line.startsWith('credits') ? Number(line.slice(7, line.indexOf('_'))) : 0;
  let creditsTaken = 0;
  const wantTags = line.startsWith('remove_tags') || line.startsWith('both');
  const wantDraw = line.startsWith('draw_up') || line.startsWith('both');
  let handedOver = line === 'actual';

  // Chooses from public facts only: own clicks, credits, tags, grip, and targetGrip (the damage the line prepares for).
  const pickDefensive = (st: GameState): GameAction | null => {
    const clicks = st.runner.clicks;
    if (creditsTaken < creditClicks && clicks > 0) {
      const gain: GameAction = { type: 'GAIN_CREDIT', player: 'runner' };
      if (isLegalAction(st, gain)) {
        creditsTaken++;
        return gain;
      }
    }
    if (wantTags && st.runner.tags > 0 && clicks > 0) {
      const rm: GameAction = { type: 'REMOVE_TAG', player: 'runner' };
      if (isLegalAction(st, rm)) return rm;
      const needCr = Math.max(0, 2 - st.runner.credits);
      if (needCr > 0 && clicks >= needCr + 1) {
        const gain: GameAction = { type: 'GAIN_CREDIT', player: 'runner' };
        if (isLegalAction(st, gain)) return gain;
      }
    }
    if (wantDraw && st.runner.grip.length < targetGrip && clicks > 0) {
      const draw: GameAction = { type: 'DRAW_CARD', player: 'runner' };
      if (isLegalAction(st, draw)) return draw;
    }
    return null;
  };
  const pickPure = (st: GameState): GameAction => {
    const d = pickDefensive(st);
    if (d) return d;
    const end: GameAction = { type: 'END_TURN', player: 'runner' };
    if (isLegalAction(st, end)) return end;
    const gain: GameAction = { type: 'GAIN_CREDIT', player: 'runner' };
    if (isLegalAction(st, gain)) return gain;
    return agents.runner.chooseAction(st);
  };

  let runnerTurnEndedState: GameState | null = null;
  let enteredCorpTurn = false;
  let windowDone = false;
  let windowEnd: GameState | null = null;
  let killAtCorpStart: KillCheck | null = null;
  let killAtNextCorpStart: KillCheck | null = null;
  let corpTurnsSeen = 0;
  let lastCorpTurn = -1;
  const punishmentsFired: string[] = [];

  for (let steps = 0; steps < 6000 && runner.state.turnNumber <= 80; steps++) {
    const before = runner.state;
    if (before.winner) break;
    if (before.activePlayer === 'corp' && before.turnNumber !== lastCorpTurn) {
      lastCorpTurn = before.turnNumber;
      corpTurnsSeen++;
      if (corpTurnsSeen === 1) killAtCorpStart = killCheck(evalTree, before);
      if (corpTurnsSeen === 2) killAtNextCorpStart = killCheck(evalTree, before);
    }
    if (!windowDone && enteredCorpTurn && before.activePlayer === 'runner' && before.turnNumber > startTurn) {
      windowDone = true;
      windowEnd = before;
    }
    const side = actingSide(before);
    if (!side) break;

    const myWindow =
      !enteredCorpTurn &&
      before.activePlayer === 'runner' &&
      before.turnNumber === startTurn &&
      before.pendingPrompts.length === 0 &&
      !before.activeRun &&
      (!before.priority || before.priority.holder === 'runner');
    if (myWindow && !handedOver) {
      if (play) {
        const d = pickDefensive(before);
        if (d) {
          actions.push(d.type);
          runner.apply(d);
        } else {
          handedOver = true;
          actions.push('PLAY');
          if (!runner.step()) break;
        }
      } else {
        const act = pickPure(before);
        actions.push(act.type);
        runner.apply(act);
      }
    } else {
      if (!runner.step()) break;
    }

    const after = runner.state;
    if (!enteredCorpTurn && after.activePlayer === 'corp') {
      enteredCorpTurn = true;
      runnerTurnEndedState = after;
    }
    if (!windowDone && enteredCorpTurn && before.activePlayer === 'corp') {
      const ev = detectTagPunish(evalTree, before, after, runner.last, 0);
      if (ev && ev.kind === 'card') punishmentsFired.push(ev.title);
    }
    if (!windowDone && after.winner) {
      windowDone = true;
      windowEnd = after;
    }
  }

  const end = runner.state;
  const wEnd = windowEnd ?? end;
  const rEnd = runnerTurnEndedState ?? wEnd;
  const lineOutcome = computeOutcome(evalTree, start, rEnd, []);
  const survived = !wEnd.winner || wEnd.winner === 'runner';

  return {
    line,
    legal: actions.length > 0,
    actions,
    endTurnGrip: rEnd.runner.grip.length,
    endTurnTags: rEnd.runner.tags,
    survivedNextCorpTurn: survived,
    winnerAfterNextCorpTurn: wEnd.winner ?? null,
    winReasonAfterNextCorpTurn: wEnd.winReason ?? null,
    windowEndTurn: wEnd.turnNumber,
    punishmentStillFired: punishmentsFired.length > 0,
    punishmentsFired,
    killAtCorpStart,
    killAtNextCorpStart,
    finalWinner: end.winner ?? null,
    finalWinReason: end.winReason ?? null,
    finalTurn: end.turnNumber,
    outcome: lineOutcome,
    gaveUp: {
      stolen: actualOutcome.stolen - lineOutcome.stolen,
      breachedLost: actualOutcome.breached.length - lineOutcome.breached.length,
      trashed: actualOutcome.trashed - lineOutcome.trashed,
      crDiff: actualOutcome.cr - lineOutcome.cr,
    },
  };
}

interface RunnerTurnSnap {
  turnNumber: number;
  state: GameState;
  pub: PublicConditions;
  outcome: TurnOutcome | null;
}

function buildDealList(): { seed: number; corpDeck: any; runnerDeck: any }[] {
  const decks = POOL === 'nrdb' ? NRDB_TEST_DECKS : SHIPPED_DECKS;
  const corps = decks.filter(d => d.side === 'corp');
  const runners = decks.filter(d => d.side === 'runner');
  const list: { seed: number; corpDeck: any; runnerDeck: any }[] = [];
  let pairing = 0;
  for (const c of corps) {
    for (const r of runners) {
      pairing++;
      const seed = 1000 + (pairing - 1) * 10 + 1;
      list.push({ seed, corpDeck: c, runnerDeck: r });
    }
  }
  return list;
}

async function main() {
  const { root, source, evalTree } = await makeAndLoadTrees();
  const verifyMap = new Map<number, { winner: string; cr: number[]; sc: number[] }>();
  if (VERIFY_JSON) {
    const arr = JSON.parse(readFileSync(VERIFY_JSON, 'utf8'));
    for (const d of arr) verifyMap.set(d.seed, { winner: d.winner, cr: d.cr, sc: d.sc });
  }

  const outLines: string[] = [];
  const emit = (obj: Record<string, unknown>) => {
    const line = JSON.stringify(obj);
    outLines.push(line);
    if (!OUT_DIR) console.log(line);
  };

  let lossesEvaluated = 0;

  try {
    if (POOL === 'human') {
      const hdir = 'tests/fixtures/human-games';
      const files = readdirSync(hdir).filter(f => f.endsWith('.json')).sort();
      for (const f of files) {
        const fix = JSON.parse(readFileSync(join(hdir, f), 'utf8'));
        if (fix.config?.ai !== 'runner' || fix.config?.difficulty !== 'normal') continue;
        // Replay human game in source tree.
        const setup = source.decks.deckGameSetup(fix.config.seed, fix.config.corpDeck, fix.config.runnerDeck);
        let st: GameState = source.core.createInitialGameState(setup);
        if (fix.startStops) st = { ...st, stops: fix.startStops };

        const runnerTurns: RunnerTurnSnap[] = [];
        const tagEvents: TagPunishEvent[] = [];
        const dmgByTurn = new Map<number, number>();
        let corpTurnIdx = 0;
        let lastCorpTurnNum = -1;
        let curRunnerSnap: RunnerTurnSnap | null = null;
        let curBreached: string[] = [];
        let flatCause: string | null = null;
        let flatActivePlayer: 'corp' | 'runner' | null = null;
        let flatLog: string[] = [];

        for (const mv of fix.moves as GameAction[]) {
          const before = st;
          if (before.activePlayer === 'corp' && before.turnNumber !== lastCorpTurnNum) {
            lastCorpTurnNum = before.turnNumber;
            corpTurnIdx++;
          }
          if (
            before.activePlayer === 'runner' &&
            !before.activeRun &&
            before.pendingPrompts.length === 0 &&
            (!curRunnerSnap || curRunnerSnap.turnNumber !== before.turnNumber)
          ) {
            curRunnerSnap = {
              turnNumber: before.turnNumber,
              state: structuredClone(before),
              pub: publicConditionsAt(source, before),
              outcome: null,
            };
            runnerTurns.push(curRunnerSnap);
            curBreached = [];
          }
          st = source.core.executeAction(before, mv);
          const after = st;
          if (before.activeRun && !after.activeRun) {
            const last = after.runsThisTurn[after.runsThisTurn.length - 1];
            if (last?.successful) curBreached.push(last.server);
          }
          if (curRunnerSnap && before.activePlayer === 'runner' && (after.activePlayer === 'corp' || after.winner)) {
            curRunnerSnap.outcome = computeOutcome(source, curRunnerSnap.state, after, curBreached);
          }
          const lost = Math.max(0, before.runner.grip.length - after.runner.grip.length);
          if (lost > 0 && before.activePlayer === 'corp') {
            dmgByTurn.set(before.turnNumber, (dmgByTurn.get(before.turnNumber) ?? 0) + lost);
          }
          const ev = detectTagPunish(source, before, after, mv, corpTurnIdx);
          if (ev) tagEvents.push(ev);
          if (after.winner === 'corp' && /flatline/i.test(after.winReason ?? '')) {
            const run = before.activeRun;
            flatActivePlayer = before.activePlayer;
            flatCause = before.activePlayer === 'corp' && !run ? 'corpTurn' : run?.encounter ? 'ice' : run && (run.phase === 'access' || run.breached) ? 'access' : 'other';
            flatLog = after.log.slice(-4).map((l: any) => l.message);
          }
        }
        processGameResult(evalTree, {
          pool: 'human',
          id: f,
          seed: fix.config.seed,
          corpDeck: fix.config.corpDeck.name,
          runnerDeck: fix.config.runnerDeck.name,
          endState: st,
          runnerTurns,
          tagEvents,
          dmgByTurn,
          lastCorpTurnIdx: corpTurnIdx,
          flatCause,
          flatActivePlayer,
          flatLog,
          emit,
        });
      }
    } else {
      const deals = buildDealList();
      for (let i = 0; i < deals.length; i++) {
        const d = deals[i];
        if (ONLY_SEED && d.seed !== ONLY_SEED) continue;
        if (ONLY_SEEDS.size > 0 && !ONLY_SEEDS.has(d.seed)) continue;
        if (!ONLY_SEED && ONLY_SEEDS.size === 0 && i % shards !== shard) continue;
        if (LIMIT_LOSSES > 0 && lossesEvaluated >= LIMIT_LOSSES) break;

        const tGame = performance.now();
        const start = source.core.createInitialGameState(source.decks.deckGameSetup(d.seed, d.corpDeck, d.runnerDeck));
        const agents = {
          corp: source.createAgent('corp', 'normal'),
          runner: source.createAgent('runner', 'normal'),
        };
        const runner = new source.GameRunner(start, agents);

        const runnerTurns: RunnerTurnSnap[] = [];
        const tagEvents: TagPunishEvent[] = [];
        const dmgByTurn = new Map<number, number>();
        const crAtCorpStart: number[] = [];
        const scAtCorpStart: number[] = [];
        let corpTurnIdx = 0;
        let lastCorpTurnNum = -1;
        let curRunnerSnap: RunnerTurnSnap | null = null;
        let curBreached: string[] = [];
        let flatCause: string | null = null;
        let flatActivePlayer: 'corp' | 'runner' | null = null;
        let flatLog: string[] = [];

        for (let steps = 0; steps < 4000 && runner.state.turnNumber <= 80; steps++) {
          const before = runner.state;
          if (before.activePlayer === 'corp' && before.turnNumber !== lastCorpTurnNum) {
            lastCorpTurnNum = before.turnNumber;
            corpTurnIdx++;
            crAtCorpStart.push(before.corp.credits);
            scAtCorpStart.push(before.corp.score);
          }
          if (
            before.activePlayer === 'runner' &&
            !before.activeRun &&
            before.pendingPrompts.length === 0 &&
            (!before.priority || before.priority.holder === 'runner') &&
            (!curRunnerSnap || curRunnerSnap.turnNumber !== before.turnNumber)
          ) {
            curRunnerSnap = {
              turnNumber: before.turnNumber,
              state: structuredClone(before),
              pub: publicConditionsAt(source, before),
              outcome: null,
            };
            runnerTurns.push(curRunnerSnap);
            curBreached = [];
          }
          if (!runner.step()) break;
          const after = runner.state;
          if (before.activeRun && !after.activeRun) {
            const last = after.runsThisTurn[after.runsThisTurn.length - 1];
            if (last?.successful) curBreached.push(last.server);
          }
          if (curRunnerSnap && before.activePlayer === 'runner' && (after.activePlayer === 'corp' || after.winner)) {
            curRunnerSnap.outcome = computeOutcome(source, curRunnerSnap.state, after, curBreached);
          }
          // Track damage dealt during Corp turn (or flatline burst).
          const lost = Math.max(0, before.runner.grip.length - after.runner.grip.length);
          if (lost > 0) {
            dmgByTurn.set(before.turnNumber, (dmgByTurn.get(before.turnNumber) ?? 0) + lost);
          }
          const ev = detectTagPunish(source, before, after, runner.last, corpTurnIdx);
          if (ev) tagEvents.push(ev);
          if (after.winner === 'corp' && /flatline/i.test(after.winReason ?? '')) {
            const run = before.activeRun;
            flatActivePlayer = before.activePlayer;
            flatCause = before.activePlayer === 'corp' && !run ? 'corpTurn' : run?.encounter ? 'ice' : run && (run.phase === 'access' || run.breached) ? 'access' : 'other';
            flatLog = after.log.slice(-4).map((l: any) => l.message);
          }
        }

        const end = runner.state;
        // Source verification check against base deals.json if provided.
        const expected = verifyMap.get(d.seed);
        if (expected) {
          const ok =
            (end.winner ?? 'draw') === expected.winner &&
            JSON.stringify(crAtCorpStart) === JSON.stringify(expected.cr) &&
            JSON.stringify(scAtCorpStart) === JSON.stringify(expected.sc);
          if (!ok) {
            throw new Error(
              `SOURCE MISMATCH on deal ${d.seed}: got winner=${end.winner} cr=${JSON.stringify(crAtCorpStart)} vs expected winner=${expected.winner} cr=${JSON.stringify(expected.cr)}`
            );
          }
        }

        const wasQualifying = processGameResult(evalTree, {
          pool: POOL,
          id: `deal:${d.seed}`,
          seed: d.seed,
          corpDeck: d.corpDeck.name,
          runnerDeck: d.runnerDeck.name,
          endState: end,
          runnerTurns,
          tagEvents,
          dmgByTurn,
          lastCorpTurnIdx: corpTurnIdx,
          flatCause,
          flatActivePlayer,
          flatLog,
          gameMs: Math.round(performance.now() - tGame),
          emit,
        });
        if (wasQualifying) lossesEvaluated++;
      }
    }
  } finally {
    if (OUT_DIR) {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(join(OUT_DIR, 'b0-defensive.jsonl'), outLines.join('\n') + (outLines.length ? '\n' : ''));
    }
    rmSync(root, { recursive: true, force: true });
  }
}

function processGameResult(
  evalTree: Tree,
  ctx: {
    pool: string;
    id: string;
    seed: number;
    corpDeck: string;
    runnerDeck: string;
    endState: GameState;
    runnerTurns: RunnerTurnSnap[];
    tagEvents: TagPunishEvent[];
    dmgByTurn: Map<number, number>;
    lastCorpTurnIdx: number;
    flatCause: string | null;
    flatActivePlayer: 'corp' | 'runner' | null;
    flatLog: string[];
    gameMs?: number;
    emit: (o: Record<string, unknown>) => void;
  }
): boolean {
  const { endState, runnerTurns, tagEvents, dmgByTurn, lastCorpTurnIdx, flatCause, flatActivePlayer, flatLog, emit } = ctx;
  const winner = endState.winner ?? 'draw';
  const isFlatline = winner === 'corp' && /flatline/i.test(endState.winReason ?? '');
  const cardTagEventsLast3 = tagEvents.filter(e => e.kind === 'card' && e.corpTurnIdx >= lastCorpTurnIdx - 2);
  const resTrashLast3 = tagEvents.filter(e => e.kind === 'resource_trash' && e.corpTurnIdx >= lastCorpTurnIdx - 2);
  const isTagPunishLoss = winner === 'corp' && cardTagEventsLast3.length > 0;
  const qualifying = isFlatline || isTagPunishLoss;

  // Emit per-game summary (includes public-condition turn counts for reading rule 4).
  const turnStats = {
    totalRunnerTurns: runnerTurns.length,
    taggedTurns: runnerTurns.filter(t => t.pub.runnerTags > 0).length,
    rc2TagTurns: runnerTurns.filter(t => t.pub.rc2TagCondition).length,
    tagCardTurns: runnerTurns.filter(t => t.pub.tagCardCondition).length,
    dmgRezzedTurns: runnerTurns.filter(t => t.pub.condDmgRezzed).length,
    dmgDeckTurns: runnerTurns.filter(t => t.pub.condDmgDeck).length,
    dmgAnyTurns: runnerTurns.filter(t => t.pub.condDmgAny).length,
  };
  emit({
    kind: 'game',
    pool: ctx.pool,
    id: ctx.id,
    seed: ctx.seed,
    corpDeck: ctx.corpDeck,
    runnerDeck: ctx.runnerDeck,
    winner,
    winReason: endState.winReason ?? null,
    turns: endState.turnNumber,
    corpScore: endState.corp.score,
    runnerScore: endState.runner.score,
    isFlatline,
    flatCause,
    flatActivePlayer,
    flatLog,
    isTagPunishLoss,
    cardTagEventsLast3: cardTagEventsLast3.map(e => ({ turn: e.turn, title: e.title, dmg: e.damageDealt })),
    resTrashLast3: resTrashLast3.length,
    qualifying,
    turnStats,
    gameMs: ctx.gameMs ?? 0,
  });

  if (!qualifying) return false;

  // Determine the target turn to rewind to:
  // - For a flatline during the Runner's own turn, rewind to that Runner turn itself.
  // - For a Corp-turn flatline or tag punishment, rewind to the Runner's last turn before the event.
  let eventTurn = endState.turnNumber;
  let eventKind: string = isFlatline ? `flatline:${flatCause ?? 'other'}` : `tag:${cardTagEventsLast3[0].title}`;
  if (!isFlatline && cardTagEventsLast3.length > 0) {
    eventTurn = cardTagEventsLast3[0].turn;
  } else if (isFlatline && cardTagEventsLast3.length > 0 && cardTagEventsLast3[0].turn < endState.turnNumber) {
    eventKind = `flatline+tag:${flatCause ?? 'other'}+${cardTagEventsLast3[0].title}`;
  }

  let snap: RunnerTurnSnap | undefined;
  if (isFlatline && flatActivePlayer === 'runner') {
    snap = runnerTurns.find(t => t.turnNumber === eventTurn) ?? runnerTurns[runnerTurns.length - 1];
  } else {
    snap = [...runnerTurns].reverse().find(t => t.turnNumber < eventTurn) ?? runnerTurns[runnerTurns.length - 1];
  }
  if (!snap) return false;

  // Damage that followed on the event turn (plus any Orbital Superiority 4 meat damage).
  const dmgOnEventTurn = Math.max(
    dmgByTurn.get(eventTurn) ?? 0,
    ...cardTagEventsLast3.filter(e => e.turn === eventTurn).map(e => e.damageDealt),
    isFlatline ? snap.pub.runnerGrip + 1 : 0
  );
  // Surviving D damage requires grip >= D (rule 10.4.4); cap at handSizeLimit for end-of-turn retention.
  const targetGrip = Math.min(snap.pub.runnerHandSize, Math.max(dmgOnEventTurn, snap.pub.runnerGrip));
  const actualOutcome: TurnOutcome = snap.outcome ?? { stolen: 0, breached: [], trashed: 0, cr: snap.pub.runnerCredits, win: winner };

  const tEval = performance.now();
  const results: LineResult[] = [];
  for (const line of ALL_LINES) {
    results.push(runDefensiveLine(evalTree, snap.state, line, targetGrip, actualOutcome));
  }
  const ks = new Set(results.filter(r => r.line.endsWith('_then_play')).map(r => r.actions.indexOf('PLAY')).filter(k => k > 0));
  for (const k of [...ks].sort()) {
    results.push(runDefensiveLine(evalTree, snap.state, `credits${k}_then_play`, targetGrip, actualOutcome));
  }
  const evalMs = Math.round(performance.now() - tEval);

  emit({
    kind: 'loss',
    pool: ctx.pool,
    id: ctx.id,
    seed: ctx.seed,
    corpDeck: ctx.corpDeck,
    runnerDeck: ctx.runnerDeck,
    isFlatline,
    flatCause,
    flatActivePlayer,
    flatLog,
    isTagPunishLoss,
    eventKind,
    eventTurn,
    endTurn: endState.turnNumber,
    endWinReason: endState.winReason ?? null,
    rewindTurn: snap.turnNumber,
    dmgOnEventTurn,
    targetGrip,
    pub: snap.pub,
    actualOutcome,
    lines: results,
    evalMs,
  });

  return true;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
