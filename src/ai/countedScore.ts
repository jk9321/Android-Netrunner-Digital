import { CardInstance, GameAction, GameState, cardDef, executeAction, isLegalAction, rezCostOf } from '../core';
import { scoreNowLine } from './winNow';
import { plan } from './pricing';
import { note, tally } from './diagnostics';
import { withIceInstalled } from './iceValues';
import { profileOf } from './cardProfiles';
import { serverHold } from './corp/hold';
import { lineFloor } from './corp/rezMoney';
import { centralStake } from './corp/pools';
import { HeldLine, TwoTurnLine, finishTurnStep, installedAgendas, isCorpMain, knownIncome, legalShape, lineHolds, nextTurnCredits, sameAction, scoreInTwo, scoringRemote, uniqueByCode } from './corp/lines';

/**
 * Counted scores (Corp redesign stage 0, /mnt/project-files/netrunner-ai/redesign/spec-stage0.md M2; moved here from
 * scripts/plan-measure-lib.ts for stage 0b, spec-stage0b.md): can the Corp score an agenda this turn, or by the end of
 * its next turn with the server holding through the Runner's turn, by counting only?
 *
 * Viewpoint: the Corp's own cards and HQ, the public board, the Runner's installed cards, credits and clicks. Nothing
 * reads the Runner's grip or either deck's order; the one engine search (winNowAction) cuts every line that changes R&D.
 * Every function reads states and never edits one (a state some check needs changed is a structuredClone).
 *
 * Step 4 Stage A moved the counts this file used to own to src/ai/corp/: the hold count (corp/hold.ts), the money a
 * line leaves (corp/rezMoney.ts lineFloor, afterLineFloor before), the stakes (corp/pools.ts) and the counted lines
 * themselves (corp/lines.ts). What is left is the pick-time half (scoreInTwoPick) and the four post-pick rewriters with
 * their reservation, which Stage B dissolves (spec-step4-corp-core.md 2.2).
 */

const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
const isAgenda = (c: CardInstance | undefined) => typeOf(c) === 'agenda';
const remotes = (s: GameState) => Object.values(s.corp.servers).filter(v => v.isRemote);
const serverOf = (s: GameState, id: string): string | undefined =>
  Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id))?.id;

export interface ThisTurn {
  feasible: boolean;
  /** The line found (plan.winNow's search): its actions, and whether it used a card ability or an operation. */
  line: GameAction[];
  usedCard: boolean;
  agenda?: string;
  agendaId?: string;
}

/**
 * Can the Corp score an agenda this turn with the clicks and credits it has (rules 1.17.3a-c: scored once its
 * advancement counters reach the requirement, not an action, no click; 5.2.6f / 1.18.1: [click], 1[credit]: advance 1
 * installed card)? plan.scoreNow's search (winNow.ts scoreNowLine), played out on the real state until the score: it
 * plays only the Corp's own turn and cuts every line that changes R&D. For the stage 0 measurement scripts.
 */
export function scoreThisTurn(state: GameState): ThisTurn {
  if (!isCorpMain(state) || state.corp.clicks <= 0) return { feasible: false, line: [], usedCard: false };
  let s = state;
  const line: GameAction[] = [];
  let scored: CardInstance | undefined;
  for (let i = 0; i < 20 && !s.winner && !scored; i++) {
    const a = scoreNowLine(s);
    if (!a) break;
    line.push(a);
    s = executeAction(s, a);
    scored = s.corp.scoreArea.find(c => isAgenda(c) && !state.corp.scoreArea.some(x => x.instanceId === c.instanceId));
  }
  if (!scored) return { feasible: false, line: [], usedCard: false };
  return { feasible: true, line, usedCard: line.some(a => a.type === 'USE_ABILITY' || a.type === 'PLAY_OPERATION_OR_EVENT'), agenda: cardDef(scored).title, agendaId: scored.instanceId };
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
  if (!plan().scoreInTwo || !isCorpMain(state) || state.corp.clicks <= 0) return { action: pick, held: held && held.game === state.id ? held : null };
  let h = held && held.game === state.id && held.turn <= state.turnNumber ? held : null;
  if (h && h.turn < state.turnNumber && h.line.kind !== 'asset') {
    const step = finishTurnStep(state, h);
    if (step === 'done') {
      tally('scoreInTwo', 'finished');
      return { action: pick, held: null };
    }
    if (step === 'drop') {
      tally('scoreInTwo', 'dropped');
      h = null;
    } else {
      if (step.type === 'SCORE_AGENDA') {
        tally('scoreInTwo', 'finished');
        return { action: step, held: null };
      }
      if (!sameAction(pick, step as unknown as Record<string, unknown>)) tally('scoreInTwo', 'steps');
      return { action: step, held: h };
    }
  }
  // An asset line (plan.assetCover) is done once the asset is installed
  if (h && h.line.kind === 'asset' && (h.turn < state.turnNumber || !state.corp.hq.some(c => c.instanceId === h!.line.agendaId))) h = null;
  if (h && h.turn === state.turnNumber && !state.corp.hq.some(c => c.instanceId === h!.line.agendaId) && !lineHolds(state, h.line.agendaId)) {
    tally('scoreInTwo', 'dropped');
    h = null;
  }
  if (!h) {
    const line = scoreInTwo(state) ?? assetCover(state, pick);
    if (!line) return { action: pick, held: null };
    const card = installedAgendas(state).find(a => a.card.instanceId === line.agendaId)?.card;
    h = { game: state.id, turn: state.turnNumber, line, server: line.server === 'new remote' ? null : line.server, counters: card?.advancementCounters ?? 0 };
    if (!line.kind) {
      tally('scoreInTwo', 'begun');
      note(d => d.scoreInTwoLines.push({ turn: state.turnNumber, agendaId: line.agendaId, form: line.form }));
    }
  }
  // scoreInTwo diagnostics count agenda lines only: an asset line's agendaId names an asset (assetCover counts those)
  const agendaLine = !h.line.kind;
  const step = startTurnStep(state, h);
  if (step === 'drop') {
    if (agendaLine) tally('scoreInTwo', 'dropped');
    return { action: pick, held: null };
  }
  if (step) {
    if (agendaLine && !sameAction(pick, step as unknown as Record<string, unknown>)) tally('scoreInTwo', 'steps');
    return { action: step, held: h };
  }
  // The spare clicks: the Corp's pick while the line still holds after it (an illegal pick is the engine's to refuse)
  if (lineHolds(spareAfter(state, pick), h.line.agendaId)) return { action: pick, held: h };
  const credit = legalShape(state, { type: 'GAIN_CREDIT' });
  if (!credit) return { action: pick, held: h };
  if (agendaLine) tally('scoreInTwo', 'vetoed');
  return { action: credit, held: h };
}

/** The state after the Corp's pick, for the hold check; a pick the engine refuses leaves the state as it is. */
function spareAfter(state: GameState, pick: GameAction): GameState {
  if (!isLegalAction(state, pick)) return state;
  return executeAction(state, pick);
}

type ServerLike = GameState['corp']['servers'][string];

/** The scoring remote when it does not hold by the count (holdCost against runnerBudget with what the Corp ends the turn on, less afterLineFloor for its agendas); null when it holds or there is none. iceRedirect and assetCover read it. */
function scoringShort(state: GameState): ServerLike | null {
  const scoring = scoringRemote(state);
  if (!scoring) return null;
  const agendas = state.corp.hq.filter(isAgenda);
  const floor = agendas.length ? Math.min(...agendas.map(x => lineFloor(state, x.instanceId))) : lineFloor(state, '');
  const end = state.corp.credits + Math.max(0, state.corp.clicks - 1);
  return serverHold(state, scoring.id, { when: 'runnerTurn', corpCredits: end - floor }).holds ? null : scoring;
}

/**
 * Ice redirect (step 4 G3', Jeff 2026-11-12 "ice spread thin"; +2.1 ± 0.7 over 2,873 paired games, runs 43158129121 + 43164127215): when the Corp's
 * own pick installs ice onto a remote or a new remote, and the scoring remote does not hold by the count (holdCost
 * against runnerBudget with what the Corp ends the turn on: credits and the clicks after this one, less afterLineFloor
 * for its agendas), the ice goes to the scoring remote instead, outermost. Its install cost there is 1 credit for each
 * ice already protecting it (8.5.11a), against none on a new remote. Measured and not kept: redirecting only while the
 * Corp still covers the holding rez after that cost (+0.5 ± 0.6, run 43158132282: it removes most fires), and keeping the
 * first ice on a server with a card in its root (-1.4 ± 0.8 against this, run 43167848111). Central ice and the choice to install ice at all are the
 * pick's: a pure redirect, no veto, no extra install. Null: no change.
 */
export function iceRedirect(state: GameState, pick: GameAction): GameAction | null {
  if (pick.type !== 'INSTALL_CARD' || !isCorpMain(state)) return null;
  const a = pick as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);
  if (!card || typeOf(card) !== 'ice') return null;
  const target = a.asNewRemote ? null : a.targetServerId ? state.corp.servers[a.targetServerId] : null;
  if (!a.asNewRemote && !target?.isRemote) return null;
  const scoring = scoringShort(state);
  if (!scoring || scoring.id === target?.id) return null;
  return legalShape(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: scoring.id }) ?? null;
}

/**
 * The scoring remote while it is kept free of assets for an agenda (asset cover reservation arm, play test round 3 G1
 * T7-T10: remote-2 sat empty five turns with 3-4 agendas in HQ and no line on it, and the assets went bare): an agenda
 * waits in HQ and a counted line could use the remote, that is holdCost finds a rez set for its ice, or its ice with
 * one ice from HQ in front (scoreInTwo's install+ice form, 8.5.11a: 1 credit per ice already protecting it), within the
 * line's horizon: what the Corp ends this turn on, its known income and next turn's clicks as credits (5.2.6a), less
 * afterLineFloor. Otherwise an asset may take its root (3.3.1); an agenda can still replace it later by trashing it
 * (8.5.6a). Null: not reserved. Folded 2026-11-13 (plan.assetReserve, g3 +0.5 ± 1.6, run 43354222438; before it the
 * remote was reserved whenever an agenda waited in HQ).
 */
function reservedForAgenda(state: GameState): ServerLike | null {
  const agendas = state.corp.hq.filter(isAgenda);
  const scoring = agendas.length ? scoringRemote(state) : null;
  if (!scoring) return scoring;
  const floor = Math.min(...agendas.map(x => lineFloor(state, x.instanceId)));
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
  if (waiting && state.corp.credits + (state.corp.clicks - 1) + income >= rezCost) return (tally('assetPartner', 'moved'), line(waiting.id, 'install'));
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
export function assetPartner(state: GameState, pick: GameAction): GameAction | null {
  if (!isCorpMain(state) || pick.type !== 'INSTALL_CARD' || !(pick as { asNewRemote?: boolean }).asNewRemote) return null;
  const card = state.corp.hq.find(c => c.instanceId === pick.cardInstanceId);
  if (!card || (typeOf(card) !== 'asset' && typeOf(card) !== 'upgrade')) return null;
  const reserved = reservedForAgenda(state);
  const waiting = remotes(state)
    .filter(v => v.ice.length > 0 && !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset') && v.id !== reserved?.id)
    .sort((x, y) => y.ice.length - x.ice.length)[0];
  const move = waiting ? legalShape(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: waiting.id }) : undefined;
  if (move) tally('assetPartner', 'moved');
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
export function centralIce(state: GameState, pick: GameAction): GameAction | null {
  if (pick.type !== 'INSTALL_CARD' || !isCorpMain(state)) return null;
  const a = pick as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);
  if (!card || typeOf(card) !== 'ice') return null;
  if (!a.asNewRemote && !state.corp.servers[a.targetServerId ?? '']?.isRemote) return null;
  if (state.corp.credits < rezCostOf(state, card)) return null;
  const bare = (['hq', 'rd'] as const).filter(id => state.corp.servers[id].ice.length === 0);
  if (!bare.length) return null;
  const stake = centralStake(state, card.instanceId);
  const to = bare.sort((x, y) => stake[y] - stake[x])[0];
  return legalShape(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: to }) ?? null;
}
