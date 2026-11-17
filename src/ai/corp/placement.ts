import { CardInstance, GameAction, GameState, cardDef, executeAction, isLegalAction, rezCostOf } from '../../core';
import { HeldLine, TwoTurnLine, finishTurnStep, installedAgendas, isCorpMain, knownIncome, legalShape, lineHolds, nextTurnCredits, sameAction, scoreInTwo, scoringRemote, uniqueByCode } from './lines';
import { ScoreLine, keepsScore } from '../winNow';
import { isEconAsset } from '../cardValues';
import { isTrap } from '../runs';
import { plan } from '../pricing';
import { note, tally } from '../diagnostics';
import { mainRemote, withIceInstalled } from '../board';
import { profileOf } from '../cardProfiles';
import { serverHold } from './hold';
import { lineKeep, rezMoney } from './rezMoney';
import { centralStake, stake } from './pools';
import { pointValue } from '../valueModel';
import { freeRezTargets } from '../freeRez';

/**
 * Owner: where a card goes (Step 4 Stage A, spec-step4-corp-core.md 1.8; registry row "placement").
 *
 * Stage B4 moved the rule bodies here (countedScore.ts is gone): the counted two-turn line (scoreInTwoPick, Q5 in
 * corp/core.ts), the asset line (assetCover) and the placement rules. Since Stage C every install candidate of the order
 * (corp/candidates.ts) is already at place's server, so nothing rewrites a pick afterwards; Stage D3 routes the install
 * prompts here. `place(state, card, ctx)[0]` is where the Corp's install of `card` goes when `ctx.from` is proposed:
 *   0. a counted score this turn (scoreNowPlan): the pick stands while it keeps the score (keepsScore), else the score's
 *      line takes the click;
 *   1. a counted line (scoreInTwoPick): an asset line (assetCover: the cheapest ice from HQ in front
 *      of the asset, or the asset into an iced remote that waits) places the asset; a score line's step that installs
 *      this card places it where the line goes; a held agenda line, or a line step with another card, leaves the click
 *      to the line (no rewrite: today's rewriters are skipped while a line holds);
 *   2. central ice (centralIce): ice for a remote goes to a central with no ice first;
 *   3. ice redirect (iceRedirect): remote ice goes to the scoring remote while it does not hold;
 *   4. asset partner (assetPartner): an asset or upgrade for a new remote goes to an iced remote with an open root,
 *      never the scoring remote reserved for an agenda (reservedForAgenda, inside assetCover and assetPartner);
 *   5. ice no rule placed and that changes no count where it stands: the fallback (spec 1.8 ice rule 3, Stage C1);
 *   6. otherwise the proposal stands, labelled by the old installScore asset line that matches it where one does (an
 *      econ asset in an empty iced remote that is not the scoring remote; a trap kept off the scoring remote), else 'pick'.
 * Rules: one agenda or asset in a remote's root (3.3.1), any number of upgrades (3.6.2); a root card may replace one
 * already there by trashing it (8.5.6a); ice costs 1 credit per ice already protecting the server (8.5.11a). The rules
 * see the Corp's own HQ and the public board only (10.2.2a).
 */

const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
const isAgenda = (c: CardInstance | undefined) => typeOf(c) === 'agenda';
const remotes = (s: GameState) => Object.values(s.corp.servers).filter(v => v.isRemote);
const serverOf = (s: GameState, id: string): string | undefined =>
  Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id))?.id;
type ServerLike = GameState['corp']['servers'][string];


export type PlacementReason = 'pick' | 'fallback' | 'fallback:unpaid' | 'scoreLine' | 'assetCover' | 'centralIce' | 'iceRedirect' | 'assetPartner' | 'assetLine:econIced' | 'assetLine:trapOffScoring';

export interface Placement {
  /** A server id, or 'new' for a new remote. */
  server: string;
  /** Cards trashed first from the server (rule 8.5.6a; the ranking's withDeadIceTrashed). */
  trash?: string[];
  /** A card installed first, in front of this one (assetCover: the ice from HQ). */
  pairWith?: string;
  reason: PlacementReason;
}

export interface PlaceContext {
  /** The install of `card` proposed (a legal install the order or a prompt offers). */
  from: GameAction;
  /** The two-turn line the Corp holds as the decision begins (corpAI heldLine). */
  held: HeldLine | null;
  /** A counted score this turn (scoreNowPlan): no line and no rewriter runs; the pick stands only while it keeps the score. */
  scoreNow?: ScoreLine | null;
  /** A free install outside the Corp's main phase (see FreeInstall). */
  free?: FreeInstall;
}

/**
 * A free install from HQ outside the Corp's main phase, ignoring all costs (Synapse Global; Stage C1b, c0-rulings
 * addendum 08:10Z): the board after the install of `a`, as the engine's own prompt makes it, or null. Under it the rules
 * of place are asked without their phase test, their click tests and the install cost (8.5.11a costs are ignored); the
 * rez stays within keep. Step 1 (the counted line, a plan of this turn's and next turn's clicks) is not asked: a free
 * install is no step of a line. The moves are shaped without the engine's legal list, which has no install outside the
 * main phase; the caller checks the server against the prompt's options.
 */
export type FreeInstall = (a: GameAction) => GameState | null;
const shaped = (state: GameState, want: Record<string, unknown>, free?: FreeInstall): GameAction | undefined =>
  free ? ({ player: 'corp', ...want } as GameAction) : legalShape(state, want);
const mainOr = (state: GameState, free?: FreeInstall) => !!free || isCorpMain(state);

type Install = GameAction & { type: 'INSTALL_CARD'; cardInstanceId: string; targetServerId?: string; asNewRemote?: boolean; trashFirst?: string[] };
const isInstall = (a: GameAction): a is Install => a.type === 'INSTALL_CARD';

const at = (a: Install, reason: PlacementReason): Placement => {
  const server = a.asNewRemote ? 'new' : a.targetServerId ?? 'new';
  return { server, ...(a.trashFirst?.length ? { trash: [...a.trashFirst] } : {}), reason };
};

/**
 * Where `card` goes, best first (see the file comment). Empty when `ctx.from` is not an install of `card` from HQ, or
 * when a counted agenda line takes this click instead (its step is not a placement of this card).
 */
export function place(state: GameState, card: CardInstance, ctx: PlaceContext): Placement[] {
  const from = ctx.from;
  if (!isInstall(from) || from.cardInstanceId !== card.instanceId || !state.corp.hq.some(c => c.instanceId === card.instanceId)) return [];
  if (ctx.free) {
    const r = placeRules(state, card, from, ctx.free);
    return [at(r.action, r.reason)];
  }
  if (ctx.scoreNow) return keepsScore(state, from, ctx.scoreNow) ? [at(from, 'pick')] : [];
  // 1. The counted line (scoreInTwoPick changes the held line it is given: a copy)
  const held = ctx.held ? structuredClone(ctx.held) : null;
  const two = scoreInTwoPick(state, from, held);
  const line = two.held && two.held.game === state.id ? two.held : null;
  if (two.action !== from) {
    // A counted line whose step installs this card: a two-turn score line (its ice in front of the agenda, or the
    // agenda itself), or a held asset line's next step (the asset where its iced remote waits)
    if (isInstall(two.action) && two.action.cardInstanceId === card.instanceId) return [at(two.action, line?.line.kind === 'asset' ? 'assetCover' : 'scoreLine')];
    // An asset line begun on this pick: its first step installs the ice in front, or the asset where an iced remote waits
    if (line?.line.kind === 'asset' && line.line.agendaId === card.instanceId && !held) {
      const server = line.line.server === 'new remote' ? 'new' : line.line.server;
      return [{ server, ...(line.line.iceId ? { pairWith: line.line.iceId } : {}), reason: 'assetCover' }];
    }
    return [];
  }
  if (line) return [at(from, 'pick')];
  const r = placeRules(state, card, from);
  return [at(r.action, r.reason)];
}

/** Rules 2 to 5 of place, for an install no counted line takes: the install that results, and the rule that chose it. */
function placeRules(state: GameState, card: CardInstance, from: Install, free?: FreeInstall): { action: Install; reason: PlacementReason } {
  // 2-4. Central ice, the ice redirect, the asset partner, in that order
  const central = centralIce(state, from, free);
  if (central && isInstall(central)) return { action: central, reason: 'centralIce' };
  const redirect = iceRedirect(state, from, free);
  if (redirect && isInstall(redirect)) return { action: redirect, reason: 'iceRedirect' };
  const partner = assetPartner(state, from, free);
  if (partner && isInstall(partner)) return { action: partner, reason: 'assetPartner' };
  // 5. Ice no rule placed and that changes no count where it stands: spec 1.8 ice rule 3 (C1), the fallback
  if (typeOf(card) === 'ice') {
    const fallback = iceFallback(state, card, from, free);
    if (fallback) return { action: fallback.action, reason: fallback.unpaid ? 'fallback:unpaid' : 'fallback' };
  }
  // 6. The pick, with the installScore asset line that put it there
  return { action: from, reason: assetLine(state, card, from) };
}

/**
 * What an ice install does to the hold count of its server (the hold owner, runner's next turn): whether the count
 * improves (the server comes to hold, or the Runner has fewer entries), the stake there, and whether the server is the
 * scoring remote that does not hold (c0-rulings addendum 03:40Z: at stake by purpose). Null for a new remote.
 * Read by the candidates' lines 2 and 6 and by the fallback below: one computation.
 */
export function iceCount(state: GameState, a: Install, card: CardInstance, after: GameState) {
  if (a.asNewRemote || !a.targetServerId) return null;
  const server = a.targetServerId;
  const loss = stake(state, server, { leaving: card.instanceId }).loss;
  const scoring = !(loss > 0) && scoringShort(state)?.id === server;
  const was = serverHold(state, server, { when: 'runnerTurn' });
  const now = serverHold(after, server, { when: 'runnerTurn', corpCredits: after.corp.credits });
  const improves = (now.holds && !was.holds) || (!now.holds && now.entries < was.entries);
  return { server, loss, scoring, was, now, improves, staked: improves && (loss > 0 || scoring) };
}

/**
 * Whether the Corp can install `card` (ice) behind `install` ice already there (1 credit each, rule 8.5.11a) and still rez
 * it within keep: the one paid test (the order's lines and the fallback below). Ice a free rez coming this turn pays
 * for (freeRezTargets, the costliest unrezzed ice per pending free rez; Send a Message, rules 1.16.5c) costs 0 to rez
 * (c0-rulings 16:00Z (8)).
 */
export function icePaidAt(state: GameState, card: CardInstance, install: number, keep: number): boolean {
  const rez = freeRezTargets(state, card).has(card.instanceId) ? 0 : rezCostOf(state, card);
  return state.corp.credits - install - rez >= keep;
}

/**
 * Spec 1.8 ice rule 3 (Stage C1, replacing installScore's per-server numbers): ice that changes no count where it was
 * proposed goes to the bare or thinnest of HQ and R&D (ties: the larger central stake, as centralIce), when the Corp can
 * pay its install there (1 credit per ice already in front, rule 8.5.11a) and its rez within keep; else to the scoring
 * remote; with neither paid and no scoring remote, to the thinnest central still (c0-rulings 08:15Z: the paid test
 * chooses between a central and the scoring remote; unrezzed ice deters a breakerless Runner). Equally thin: the larger
 * central stake (centralStake), then HQ before R&D (a fixed order; servers carry no instance id). Ice that changes a count on a staked server stays (line 2), and ice into a new remote stays while HQ holds an
 * agenda or asset to go behind it this turn (rule 4: a build pair, two clicks, or one when the ice's install is free). Null: the proposal stands.
 */
function iceFallback(state: GameState, card: CardInstance, from: Install, free?: FreeInstall): { action: Install; unpaid: boolean } | null {
  if (!mainOr(state, free)) return null;
  if (from.asNewRemote || !from.targetServerId) {
    const root = state.corp.hq.some(c => c.instanceId !== card.instanceId && (typeOf(c) === 'agenda' || typeOf(c) === 'asset'));
    if (root && (free || state.corp.clicks >= 2)) return null;
  } else {
    const after = free ? free(from) : executeAction(state, from);
    const count = after ? iceCount(state, from, card, after) : null;
    if (count?.staked) return null;
  }
  const keep = rezMoney(state).keep;
  const centralStakes = centralStake(state, card.instanceId);
  const paid = (id: string) => icePaidAt(state, card, free ? 0 : state.corp.servers[id].ice.length, keep);
  const thinnest = (ids: readonly ('hq' | 'rd')[]) =>
    [...ids].sort((x, y) => state.corp.servers[x].ice.length - state.corp.servers[y].ice.length || centralStakes[y] - centralStakes[x])[0];
  const near = thinnest((['hq', 'rd'] as const).filter(paid)) ?? scoringRemote(state)?.id;
  const to = near ?? thinnest(['hq', 'rd']);
  if (!to || to === from.targetServerId) return null;
  const action = shaped(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: to }, free) as Install | undefined;
  return action ? { action, unpaid: !near } : null;
}

/** Which of installScore's two asset lines chose this destination (corpAI.ts installScore, 'asset' case), else 'pick'. */
function assetLine(state: GameState, card: CardInstance, from: Install): PlacementReason {
  if (typeOf(card) !== 'asset' || from.asNewRemote || !from.targetServerId) return 'pick';
  const server = state.corp.servers[from.targetServerId];
  if (!server?.isRemote) return 'pick';
  const econ = isEconAsset(card.cardCode);
  const main = mainRemote(state);
  if (econ && server.ice.length > 0 && server.root.length === 0 && server.id !== main?.id) return 'assetLine:econIced';
  if (!econ && isTrap(card.cardCode) && server.id !== main?.id) return 'assetLine:trapOffScoring';
  return 'pick';
}

/**
 * The legal install `from` moved to a placement's server (and its trash-first list), the form the candidates
 * (corp/candidates.ts) offer: the one place an install action is given a destination outside the rules above.
 */
export function placedInstall<A extends GameAction & { type: 'INSTALL_CARD' }>(from: A, p: Placement): A {
  const at = p.server === 'new' ? { asNewRemote: true } : { targetServerId: p.server };
  const rest = Object.fromEntries(Object.entries(from).filter(([k]) => k !== 'targetServerId' && k !== 'asNewRemote' && k !== 'trashFirst'));
  return { ...rest, ...at, ...(p.trash ? { trashFirst: p.trash } : {}) } as A;
}

/** The install action a placement stands for (its first step when it pairs an ice in front), for comparing with a played move. */
export function placementAction(card: CardInstance, p: Placement): { cardInstanceId: string; server: string } {
  return p.pairWith ? { cardInstanceId: p.pairWith, server: p.server } : { cardInstanceId: card.instanceId, server: p.server };
}

// ------------------------------------------------------------------------------------------- plan.scoreInTwo (C2)

/** The held line's next step on the turn it began: ice, agenda, the advances now; null when only spare clicks remain; 'drop' when it can't go on. */
function startTurnStep(state: GameState, held: HeldLine): GameAction | null | 'drop' {
  const { line } = held;
  const id = line.agendaId;
  if (held.server === null && line.server !== 'new remote') held.server = line.server;
  if (held.server === null && line.iceId) held.server = serverOf(state, line.iceId) ?? null;
  if (state.corp.hq.some(c => c.instanceId === id)) {
    if (line.form === 'install+ice' && line.iceId && state.corp.hq.some(c => c.instanceId === line.iceId))
      return legalShape(state, held.server ? { type: 'INSTALL_CARD', cardInstanceId: line.iceId, targetServerId: held.server } : { type: 'INSTALL_CARD', cardInstanceId: line.iceId, asNewRemote: true }) ?? 'drop';
    if (!held.server) return 'drop';
    return legalShape(state, { type: 'INSTALL_CARD', cardInstanceId: id, targetServerId: held.server }) ?? 'drop';
  }
  const at = installedAgendas(state).find(a => a.card.instanceId === id);
  if (!at) return 'drop';
  if (at.card.advancementCounters - held.counters < line.advanceNow) return legalShape(state, { type: 'ADVANCE_CARD', cardInstanceId: id }) ?? 'drop';
  return null;
}

/**
 * plan.scoreInTwo (counted scoring C2; stage 0b's two-turn half measured +3.0 ± 1.8): called with the Corp's own pick at
 * a main-phase decision and the line it holds. A held line is re-checked every decision and continued while the count
 * still holds (dropped otherwise); with none held, scoreInTwo may begin one. On the line's first turn its steps are
 * played (ice from HQ, the agenda, the advances now), and the spare clicks follow the Corp's pick only while the line
 * still holds after it (lineHolds: the rez money the line keeps for the Runner's turn stays; a click for a credit
 * otherwise). On a later turn the agenda is advanced and scored (1.17.3a-c, 1.18.1, 5.2.6f). The hold is judged by
 * capability against the Runner's credits as they stand plus its clicks' credits (holdCost; 3.4.3a, 6.9.2b-c).
 */
export function scoreInTwoPick(state: GameState, pick: GameAction, held: HeldLine | null): { action: GameAction; held: HeldLine | null } {
  const r = twoTurn(state, pick, held);
  return { action: r.action ?? pick, held: r.held };
}

/**
 * Q5 before the look-ahead (Stage C, spec 1.3 authority point 2): the step a held or newly found two-turn score line
 * plays now, or null when the line (if any) has only spare clicks left or no line exists. Asset lines are begun from
 * the Corp's pick (assetCover reads it) and are not found here. Called on a copy of the held line: corp/core.ts then
 * plays the step through scoreInTwoPick, which keeps the line.
 */
export function lineStep(state: GameState, held: HeldLine | null): GameAction | null {
  return twoTurn(state, null, held).action;
}

/** scoreInTwoPick's body; with no pick (lineStep), no asset line is begun and the spare clicks return null. */
function twoTurn(state: GameState, pick: GameAction | null, held: HeldLine | null): { action: GameAction | null; held: HeldLine | null } {
  const quiet = !pick;
  const say = (a: 'scoreInTwo', b: 'dropped' | 'begun' | 'steps' | 'vetoed' | 'finished') => void (quiet || tally(a, b));
  if (!plan().scoreInTwo || !isCorpMain(state) || state.corp.clicks <= 0) return { action: pick, held: held && held.game === state.id ? held : null };
  let h = held && held.game === state.id && held.turn <= state.turnNumber ? held : null;
  if (h && h.turn < state.turnNumber && h.line.kind !== 'asset') {
    const step = finishTurnStep(state, h);
    if (step === 'done') {
      say('scoreInTwo', 'finished');
      return { action: pick, held: null };
    }
    if (step === 'drop') {
      say('scoreInTwo', 'dropped');
      h = null;
    } else {
      if (step.type === 'SCORE_AGENDA') {
        say('scoreInTwo', 'finished');
        return { action: step, held: null };
      }
      if (pick && !sameAction(pick, step as unknown as Record<string, unknown>)) say('scoreInTwo', 'steps');
      return { action: step, held: h };
    }
  }
  // An asset line (plan.assetCover) is done once the asset is installed
  if (h && h.line.kind === 'asset' && (h.turn < state.turnNumber || !state.corp.hq.some(c => c.instanceId === h!.line.agendaId))) h = null;
  if (h && h.turn === state.turnNumber && !state.corp.hq.some(c => c.instanceId === h!.line.agendaId) && !lineHolds(state, h.line.agendaId)) {
    say('scoreInTwo', 'dropped');
    h = null;
  }
  if (!h) {
    const line = scoreInTwo(state) ?? (pick ? assetCover(state, pick) : null);
    if (!line) return { action: pick, held: null };
    const card = installedAgendas(state).find(a => a.card.instanceId === line.agendaId)?.card;
    h = { game: state.id, turn: state.turnNumber, line, server: line.server === 'new remote' ? null : line.server, counters: card?.advancementCounters ?? 0 };
    if (!line.kind && !quiet) {
      say('scoreInTwo', 'begun');
      note(d => d.scoreInTwoLines.push({ turn: state.turnNumber, agendaId: line.agendaId, form: line.form }));
    }
  }
  // scoreInTwo diagnostics count agenda lines only: an asset line's agendaId names an asset (assetCover counts those)
  const agendaLine = !h.line.kind;
  const step = startTurnStep(state, h);
  if (step === 'drop') {
    if (agendaLine) say('scoreInTwo', 'dropped');
    return { action: pick, held: null };
  }
  if (step) {
    if (agendaLine && pick && !sameAction(pick, step as unknown as Record<string, unknown>)) say('scoreInTwo', 'steps');
    return { action: step, held: h };
  }
  if (!pick) return { action: null, held: h };
  // The spare clicks: the Corp's pick while the line still holds after it (an illegal pick is the engine's to refuse)
  if (lineHolds(spareAfter(state, pick), h.line.agendaId)) return { action: pick, held: h };
  const credit = legalShape(state, { type: 'GAIN_CREDIT' });
  if (!credit) return { action: pick, held: h };
  if (agendaLine) say('scoreInTwo', 'vetoed');
  return { action: credit, held: h };
}

/** The state after the Corp's pick, for the hold check; a pick the engine refuses leaves the state as it is. */
function spareAfter(state: GameState, pick: GameAction): GameState {
  if (!isLegalAction(state, pick)) return state;
  return executeAction(state, pick);
}

/** The scoring remote when it does not hold by the count (holdCost against runnerBudget with what the Corp ends the turn on, less lineKeep (rezMoney.ts) for its agendas); null when it holds or there is none. iceRedirect and assetCover read it. */
export function scoringShort(state: GameState): ServerLike | null {
  const scoring = scoringRemote(state);
  if (!scoring) return null;
  const agendas = state.corp.hq.filter(isAgenda);
  const floor = lineKeep(state, agendas);
  const end = state.corp.credits + Math.max(0, state.corp.clicks - 1);
  return serverHold(state, scoring.id, { when: 'runnerTurn', corpCredits: end - floor }).holds ? null : scoring;
}

/**
 * Ice redirect (step 4 G3', Jeff 2026-11-12 "ice spread thin"; +2.1 ± 0.7 over 2,873 paired games, runs 43158129121 + 43164127215): when the Corp's
 * own pick installs ice onto a remote or a new remote, and the scoring remote does not hold by the count (holdCost
 * against runnerBudget with what the Corp ends the turn on: credits and the clicks after this one, less lineKeep
 * for its agendas), the ice goes to the scoring remote instead, outermost. Its install cost there is 1 credit for each
 * ice already protecting it (8.5.11a), against none on a new remote. Measured and not kept: redirecting only while the
 * Corp still covers the holding rez after that cost (+0.5 ± 0.6, run 43158132282: it removes most fires), and keeping the
 * first ice on a server with a card in its root (-1.4 ± 0.8 against this, run 43167848111). Central ice and the choice to install ice at all are the
 * pick's: a pure redirect, no veto, no extra install. Null: no change.
 */
export function iceRedirect(state: GameState, pick: GameAction, free?: FreeInstall): GameAction | null {
  if (pick.type !== 'INSTALL_CARD' || !mainOr(state, free)) return null;
  const a = pick as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);
  if (!card || typeOf(card) !== 'ice') return null;
  const target = a.asNewRemote ? null : a.targetServerId ? state.corp.servers[a.targetServerId] : null;
  if (!a.asNewRemote && !target?.isRemote) return null;
  const scoring = scoringShort(state);
  if (!scoring || scoring.id === target?.id) return null;
  // Not while a central's loss is the game (plan.lethalHq, bug report #4; c0-rulings 15:50Z (1)): one run there can take
  // the points that win the Runner the game (rule 1.7.2a; the stake owner's points on the point clock)
  if (['hq', 'rd'].some(id => pointValue(state.runner.score + stake(state, id, { leaving: card.instanceId }).points) >= pointValue(7))) return null;
  return shaped(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: scoring.id }, free) ?? null;
}

/**
 * The scoring remote while it is kept free of assets for an agenda (asset cover reservation arm, play test round 3 G1
 * T7-T10: remote-2 sat empty five turns with 3-4 agendas in HQ and no line on it, and the assets went bare): an agenda
 * waits in HQ and a counted line could use the remote, that is holdCost finds a rez set for its ice, or its ice with
 * one ice from HQ in front (scoreInTwo's install+ice form, 8.5.11a: 1 credit per ice already protecting it), within the
 * line's horizon: what the Corp ends this turn on, its known income and next turn's clicks as credits (5.2.6a), less
 * lineKeep. Otherwise an asset may take its root (3.3.1); an agenda can still replace it later by trashing it
 * (8.5.6a). Null: not reserved. Folded 2026-11-13 (plan.assetReserve, g3 +0.5 ± 1.6, run 43354222438; before it the
 * remote was reserved whenever an agenda waited in HQ).
 */
function reservedForAgenda(state: GameState): ServerLike | null {
  const agendas = state.corp.hq.filter(isAgenda);
  const scoring = agendas.length ? scoringRemote(state) : null;
  if (!scoring) return scoring;
  const floor = lineKeep(state, agendas);
  // The line's money on its next turn with no rez spent and no click on the agenda yet (the most a line could have)
  const horizon = nextTurnCredits(state, state.corp.credits + Math.max(0, state.corp.clicks - 1), 0, 0) - floor;
  if (serverHold(state, scoring.id, { when: 'runnerTurn', corpCredits: horizon }).holds) return scoring;
  for (const ice of uniqueByCode(state.corp.hq.filter(c => typeOf(c) === 'ice'))) {
    const view = withIceInstalled(state, ice, scoring);
    if (serverHold(view, scoring.id, { when: 'runnerTurn', corpCredits: horizon - scoring.ice.length }).holds) return scoring;
  }
  return null;
}

/**
 * plan.assetCover (asset cover step 2, redesign/spec-asset-cover.md, form A): the Corp's own pick installs an econ asset
 * (its card entry's profile pays credits, when the turn begins or for a click, and loads more than its rez cost) on a
 * remote with no ice. This is Jeff's rule with a counted affordability check, not a hold count: a deterministic hold
 * count cannot express what his games show (an unknown ice is a risk to the Runner, not a known price). As Runner
 * against the AI Corp he trashed 9 of its 17 bare econ assets and 0 of its 2 iced ones, paying 1-3 credits each (2.6.1)
 * against up to 15 left on them; Jeff 2026-11-12: "I trash unused regoliths regularly against the AI. Usually because
 * they are easy to get to", and as Corp he puts them behind ice, "not my best ICE". So the line is
 * the cheapest ice from HQ (rez cost, then install cost, 8.5.11a) in front first, then the asset ('install+ice'),
 * counted for affordability only: 2 clicks, the ice's install cost, and after it the asset's rez on the next turn
 * (5.6.1b, 5.6.2a) out of what the Corp ends on plus its known income. Not the ice's rez too (3.4.3a): with it the line
 * began on 1 of 22 econ installs in 12 deals, without it on 3 (asset-cover-fires.ts); an ice the Corp cannot rez
 * deters a human Runner, not ours. Not a hold count: one ice that a rigged Runner breaks for 1-3 credits never holds by holdCost, and that arm
 * fired 0 times in 12 deals. On the pick's own place (a new remote, or its remote; one asset per root, 3.3.1), never
 * the scoring remote. While an agenda waits in HQ and the scoring remote does not hold (iceRedirect's count), the ice
 * goes there and no line begins. No line: the pick stands. Null: no change.
 */
export function assetCover(state: GameState, pick: GameAction): TwoTurnLine | null {
  if (pick.type !== 'INSTALL_CARD') return null;
  const a = pick as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const asset = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);
  const p = asset && typeOf(asset) === 'asset' ? profileOf(asset.cardCode) : undefined;
  const rezCost = asset ? (cardDef(asset).cost ?? 0) : 0;
  if (!asset || !p || p.pay <= 0 || p.load <= rezCost) return null;
  tally('assetCover', 'asked');
  const target = a.asNewRemote ? null : a.targetServerId ? state.corp.servers[a.targetServerId] : null;
  const scoring = scoringRemote(state);
  if (target && (!target.isRemote || target.ice.length > 0 || target.id === scoring?.id)) return (tally('assetCover', 'iced'), null);
  const income = knownIncome(state);
  const line = (server: string, form: TwoTurnLine['form'], ice?: { id: string; rez: number }): TwoTurnLine => ({ kind: 'asset', agenda: cardDef(asset).title, agendaId: asset.instanceId, server, form, ...(ice ? { iceId: ice.id } : {}), advanceNow: 0, advanceNext: 0, rez: ice?.rez ?? 0 });
  // assetPartner's econ case: an iced remote waiting with an open root (3.3.1) takes the asset, one click; not the
  // scoring remote while an agenda waits in HQ
  const reserved = reservedForAgenda(state);
  const waiting = remotes(state).find(v => v.ice.length > 0 && !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset') && v.id !== reserved?.id);
  if (waiting && state.corp.credits + (state.corp.clicks - 1) + income >= rezCost) return line(waiting.id, 'install');
  if (reserved && scoringShort(state)) return (tally('assetCover', 'scoringShort'), null);
  if (state.corp.clicks < 2) return (tally('assetCover', 'clicks'), null);
  const end = state.corp.credits + (state.corp.clicks - 2);
  const all = uniqueByCode(state.corp.hq.filter(c => typeOf(c) === 'ice')).map(c => ({ c, rez: rezCostOf(state, c) }));
  if (!all.length) return (tally('assetCover', 'noIce'), null);
  if (end + income < rezCost) return (tally('assetCover', 'rezMoney'), null);
  const ice = all.sort((x, y) => x.rez - y.rez)[0];
  tally('assetCover', 'begun');
  return line(target ? target.id : 'new remote', 'install+ice', { id: ice.c.instanceId, rez: ice.rez });
}

/**
 * plan.assetPartner (asset cover alternative; Claude's play test round 2, 2026-11-12: six times in two games the Corp had
 * a remote with 2-3 ice and an empty root and put Humanoid Resources, Clearinghouse and Spin Doctor into new bare
 * remotes, and the Runner trashed them): the Corp's own pick installs an asset or an upgrade on a new remote, and a
 * remote with ice and no agenda or asset in its root waits (one agenda or asset per root, 3.3.1; any number of upgrades,
 * 3.6.2); then the card goes there instead, the one with the most ice. Never the scoring remote
 * while an agenda waits in HQ. A pure redirect: no click or credit more (installing in a remote costs nothing for a
 * root card, 8.5.11a counts ice only). Econ assets take the same move in assetCover, ahead of a cover pair. Null: no change.
 */
export function assetPartner(state: GameState, pick: GameAction, free?: FreeInstall): GameAction | null {
  if (!mainOr(state, free) || pick.type !== 'INSTALL_CARD' || !(pick as { asNewRemote?: boolean }).asNewRemote) return null;
  const card = state.corp.hq.find(c => c.instanceId === pick.cardInstanceId);
  if (!card || (typeOf(card) !== 'asset' && typeOf(card) !== 'upgrade')) return null;
  const reserved = reservedForAgenda(state);
  const waiting = remotes(state)
    .filter(v => v.ice.length > 0 && !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset') && v.id !== reserved?.id)
    .sort((x, y) => y.ice.length - x.ice.length)[0];
  const move = waiting ? shaped(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: waiting.id }, free) : undefined;
  return move ?? null;
}

/**
 * Central ice before remote ice (spec-central-ice.md variant (6), bars/central-ice-bare.md; Jeff 2026-11-13: "fix the
 * icing remotes while HQ and R&D were thin"; his #51 had R&D bare for turns 1-5 on 13-17 credits). When the Corp's own
 * pick installs ice from HQ onto a remote or a new remote (the callers skip a held counted line's own steps), and HQ or
 * R&D has no ice at all, the ice goes to that central instead, when the Corp can still pay the ice's rez after the
 * install (none to pay on a central with no ice, 8.5.11a). Both bare: the one with more points at stake for one access
 * (HQ: its agendas' pointGain over the cards left in HQ, the Corp's own hand, 10.2.2a; R&D: the deck list's agendas not
 * yet seen over R&D's cards, times their average pointGain (rezModel rdAgendaOdds, the Corp's one R&D pool), never
 * R&D's order). At most once per central, as the central then has ice. A pure redirect (5.2.6: the same install action, one
 * click): no veto, no extra install. Null: no change.
 */
export function centralIce(state: GameState, pick: GameAction, free?: FreeInstall): GameAction | null {
  if (pick.type !== 'INSTALL_CARD' || !mainOr(state, free)) return null;
  const a = pick as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);
  if (!card || typeOf(card) !== 'ice') return null;
  if (!a.asNewRemote && !state.corp.servers[a.targetServerId ?? '']?.isRemote) return null;
  // The Corp can pay the ice's rez and still keep rez money's keep (the money its staked servers' holding rezzes need)
  if (state.corp.credits - rezCostOf(state, card) < rezMoney(state).keep) return null;
  const bare = (['hq', 'rd'] as const).filter(id => state.corp.servers[id].ice.length === 0);
  if (!bare.length) return null;
  const stake = centralStake(state, card.instanceId);
  const to = bare.sort((x, y) => stake[y] - stake[x])[0];
  return shaped(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: to }, free) ?? null;
}
