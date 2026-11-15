import { CardInstance, GameAction, GameState, ServerState, activePrompt, cardDef, findCardAnywhere, getLegalActions, isLegalAction } from '../../core';
import { iceScript } from '../../core/engine/ice';
import { BLOCK, iceCost, iceCreditNeed, tagCost } from '../runs';
import { rezCost } from '../../core/engine/cardEffects';
import { deckCount, rezEffectWorth, runTimed } from '../effectValues';
import { archivesPayoffOf, rezEffectOf } from '../cards';
import { modelRezGain, runBypassed } from '../rezModel';
import { agendasUnseen, reachablePoints, runLoss } from './pools';
import { serverHold } from './hold';
import { evaluate } from '../evaluate';
import { answerPrompt, simulate } from '../prompts';
import { plan } from '../pricing';
import { CARD_PROFILES, ECON_SCALE } from '../cardProfiles';
import { econValue, upgradeValue } from '../cardValues';

const type = (card: CardInstance) => cardDef(card).type_code;
export const hasEndTheRun = (ice: CardInstance) => (iceScript(ice)?.subroutines ?? []).some(s => /end the run/i.test(s.label));

/**
 * Step 4 Stage B2 (spec-step4-corp-core.md 1.3, P8): the Corp's counted rez decision during a run, moved here from
 * rezModel.ts unchanged, with its stop count read straight from the hold owner (serverHold 'thisRun', corp/hold.ts;
 * rezModel's stopSpend and stopCost before it are gone). The priced rez (modelRezGain) stays in rezModel.ts as a library.
 */

/**
 * Counted rez (roadmap step 3, spec-step3-rez.md): a rez decision on approached ice by counting, consulted before
 * modelRezGain. 'rez', 'pass', or null (no opinion: modelRezGain decides). The Corp may rez the approached ice in the
 * approach-ice window (rules 6.4.3, 6.9.2b); ice left unrezzed is passed (6.9.2c). Uses the run's real numbers:
 *  - stops: the Runner can't pay through this ice with its credits now (iceCreditNeed, 7.1 aside), counting the rezzed
 *    ice still ahead of it, while that ice alone would not stop it (the rez is what ends the run);
 *  - toll: it can, for credits; free: it passes for no credits (no opinion: the rez costs the Runner nothing).
 * R2 an agenda in the root and the rez stops the run: rez. R3 a run on HQ with an agenda in HQ (R3s stops, R3t toll):
 * rez. R4 a run on R&D with no agenda in HQ and agendas left in R&D by the Corp's own deck list minus what it has seen
 * (never the order; R4s, R4t): rez. R5 Archives ice with no agenda in Archives and no Runner card that pays off an
 * Archives run (installed or in its deck list, CardAI archivesPayoff): don't rez. Stacked with corpAI's R6 at 10 games
 * +0.4 ± 0.7 (run 42981640841 vs 42978477338), 130 fewer central points in Corp losses; went broke +3.8 ± 1.2 and stayed
 * broke +2.1 ± 0.9, never recovered flat (292 vs 293): shipped on recovery (AI Coordinator ruling, step3-report.md).
 */
export function countedRez(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {
  const run = state.activeRun;
  if (!run || run.icePosition === null) return null;
  const server = state.corp.servers[run.server];
  if (!server) return null;
  // Match point (spec-match-point-rez.md E1): a rez that stops a game-winning run is made, and a rez that would leave
  // the Corp short of the inner ice that stops it is not, ahead of every other rule
  const atMatch = matchPointRez(state, ice);
  if (atMatch) return atMatch;
  // R5: Archives ice with no agenda there and no Runner Archives card is not rezzed
  if (run.server === 'archives' && !archivesWantsIce(state)) return 'pass';
  const up = { ...ice, isRezzed: true };
  const view: GameState = { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [server.id]: { ...server, ice: server.ice.map(c => (c.instanceId === ice.instanceId ? up : c)) } } } };
  // The declared run bypasses this ice once rezzed (runBypassed), so its subroutines never resolve
  // (6.5.8a-b) and the rez buys nothing on this run; it can still be rezzed on a later run's approach (6.9.2b). Ice with
  // its own rez effect (Ping's tag) goes to modelRez, which prices the rez with the ice passed
  if (runBypassed(view, up)) return rezEffectOf(cardDef(ice).code) ? null : 'pass';
  const need = iceCreditNeed(view, up);
  if (need === 0) return null;
  // The rezzed ice further in stops the Runner already (the hold owner, nothing more rezzed): this rez adds nothing the
  // run needs. Stage B2 replaced countedRez's own sum over iceCreditNeed (stage-b/b2-rez-log.md section 3)
  if (serverHold(state, run.server, { when: 'thisRun', mustRez: [], further: false }).holds) return null;
  // The one stop count (rezStops), here with no further rezzes: this ice and the rezzed ice further in
  const stops = rezStops(state, ice, false);
  const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
  const isStopper = stops && server.root.some(isAgenda);
  // R2: the rez stops a steal from the root on this run
  if (isStopper) return 'rez';
  const hqAgendas = state.corp.hq.filter(isAgenda).length;
  // R3 (Jeff): a run on HQ with an agenda in it, stop or toll
  if (run.server === 'hq' && hqAgendas > 0) return 'rez';
  // R4 (Jeff): a run on R&D with no agenda in HQ and agendas left in R&D by the deck list, stop or toll
  if (run.server === 'rd' && hqAgendas === 0 && agendasUnseen(state) > 0) return 'rez';
  return null;
}

/** The Runner wins with 7 or more agenda points in its score area (rules 1.7.2a). */
const WIN = 7;

/**
 * Match point (spec-match-point-rez.md E1): the Runner needs p more agenda points to win (rules 1.7.2a), the run's
 * server can give it p this run (reachablePoints), and rezzing this ice stops the run by the count: with it rezzed,
 * the rezzed ice further in, and some set of the unrezzed ice further in that the Corp can still afford after this rez
 * (it gets each of their windows: 6.4.3, 6.9.2b), the Runner's credits now can't pay through (iceCreditNeed, as
 * countedRez's stop test). Then the rez is made: the other side of it is a chance the game ends now. A rez that only
 * tolls is not a match-point rez (matchPointRez says when it is a pass).
 */
export function matchPoint(state: GameState, ice: CardInstance): boolean {
  return matchPointRez(state, ice) === 'rez';
}

/**
 * The match-point answer at this window. 'rez': rezzing this ice stops the run, and no set without it stops for less
 * (rezStops). 'pass': rezzing it doesn't stop the run, but some affordable set of the ice further in does, and paying
 * for this rez would leave the Corp short of that set (game #51 #219: Paywall for 1 of 4 credits, N-Pot needs 4).
 * null: off match point, or neither (a toll that keeps the inner stop affordable is left to the other rules).
 */
export function matchPointRez(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server || run.icePosition === null) return null;
  const need = WIN - state.runner.score;
  if (need <= 0 || reachablePoints(state) < need) return null;
  const withIt = serverHold(state, run.server, { when: 'thisRun', mustRez: [ice.instanceId], further: true }).rezCost;
  const without = serverHold(state, run.server, { when: 'thisRun', mustRez: [], further: true }).rezCost;
  if (withIt !== Infinity) return without < withIt ? null : 'rez';
  if (without !== Infinity && state.corp.credits - rezCost(state, ice) < without) return 'pass';
  return null;
}

/**
 * Rezzing this approached ice stops the run by the count: with it rezzed, the rezzed ice further in, and some set of the
 * unrezzed ice further in that the Corp can still afford after this rez, the Runner's credits now can't pay through.
 * Ice the run's bypasses skip on that board (bypassesAhead, the approached ice included; 6.5.8a) never resolves, so it
 * is left out of the sum. With further, a set without this ice that the Corp can afford and that stops for less makes
 * this window no opinion: that inner rez happens at its own window (6.9.2b).
 */
export function rezStops(state: GameState, ice: CardInstance, further = true): boolean {
  const run = state.activeRun;
  if (!run) return false;
  const withIt = serverHold(state, run.server, { when: 'thisRun', mustRez: [ice.instanceId], further }).rezCost;
  if (withIt === Infinity) return false;
  return !further || serverHold(state, run.server, { when: 'thisRun', mustRez: [], further: true }).rezCost >= withIt;
}

/** Archives is worth ice (Jeff, 2026-11-11): an agenda is in it, or the Runner's deck list has a card that pays off an Archives run (CardAI archivesPayoff). */
export function archivesWantsIce(state: GameState): boolean {
  const archives = [...state.corp.archives.faceUp, ...state.corp.archives.faceDown];
  return archives.some(c => cardDef(c).type_code === 'agenda') || deckCount(state, 'runner', c => archivesPayoffOf(c.cardCode)) > 0;
}

/**
 * The Corp's rez window during a run (chooseRez), moved here from corpAI.ts unchanged (Stage B2): the counted rez
 * (countedRez) first, then the priced rez (modelRezGain), the old importance-scored branch (reached only with
 * plan.modelRez off), upgrades, and the run stoppers. serverImportance and the run-stopper thresholds are debt
 * (docs/ai-priced-quantities.md): replacing a threshold is a rule change, Stage D.
 */
export function decideRez(state: GameState, cards: CardInstance[], synergy: boolean): GameAction | null {
  const run = state.activeRun;
  if (!run) return null;
  const server = state.corp.servers[run.server];
  const importance = serverImportance(state, server, synergy);
  let best: { card: CardInstance; score: number } | null = null;
  for (const card of cards) {
    const def = cardDef(card);
    const cost = rezCost(state, card);
    if (!isLegalAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId })) continue;
    // Counted rez (step 3): rez, pass, or no opinion (the value model decides)
    if (def.type_code === 'ice' && synergy && run.phase === 'approach_ice') {
      const call = countedRez(state, card);
      if (call === 'rez') return { type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId };
      if (call === 'pass') continue;
    }
    let score: number;
    if (def.type_code === 'ice' && synergy && plan().modelRez) {
      // plan.modelRez: the rez priced by the value model (rezModel.ts), in credits; rezzed when it gains anything.
      // Lifted onto the old scale's threshold (2) so an upgrade in the same window still compares on its own terms
      const gain = modelRezGain(state, card, synergy);
      if (!(gain > 0)) continue;
      score = 2 + gain;
    } else if (def.type_code === 'ice') {
      // Ping tags the Runner when rezzed during a run; ice that ends the run protects best
      const onRez = ECON_SCALE * rezEffectWorth(card, tagCost(state));
      score = importance + (hasEndTheRun(card) ? 1 : 0) + onRez;
      if (state.corp.credits - cost < 2 && importance < 4) score -= 2;
      // plan.rezToll (Jeff, 2026-11-05: the Corp's money goes on ice rezzed in runs): ice the Runner can pay its way
      // through doesn't stop the run, it only takes a toll. Outside a server holding an agenda, paying more to rez it
      // than twice the toll (this run's and about one more) loses money: 27% of the Corp's in-run rez money went there
      if (synergy && importance < 7) {
        const rezzed = { ...card, isRezzed: true };
        const need = iceCreditNeed(state, rezzed);
        if (need > 0 && need < BLOCK && need <= state.runner.credits && 2 * iceCost(state, rezzed) < cost) continue;
      }
    } else if (def.type_code === 'upgrade') {
      // Upgrades: by what they do here (model), up to the 2 an upgrade gives up against ice;
      // one that does nothing in a run waits for the Corp's turn, keeping the money for ice
      const [remote, central] = upgradeValue(card.cardCode, state);
      score = !runTimed(card) ? -1 : importance - 2 + Math.min(2, Math.max(0, server.isRemote ? remote : central));
    } else if (onRezOnly(card)) {
      score = 3; // Spin Doctor (Jeff): the Runner came anyway, so the same 2 cards cost it a run
    } else {
      score = -1; // assets are rezzed on the Corp's own turn
    }
    if (score >= 2 && (!best || score > best.score)) best = { card, score };
  }
  if (best) return { type: 'REZ_CARD', player: 'corp', cardInstanceId: best.card.instanceId };
  return run.phase === 'approach_server' ? runStopper(state, importance, synergy) : null;
}

/** LEO Construction or Proprionegation, when the Runner is about to get into something that matters. */
function runStopper(state: GameState, importance: number, synergy: boolean): GameAction | null {
  // (Jeff) LEO: worth it when the run would take more than the bioroid it trashes (plan.leoValue)
  const leo = getLegalActions(state, 'corp').find(a => a.type === 'USE_ABILITY' && findCardAnywhere(state, a.cardInstanceId)?.cardCode === '35035');
  if (leo) return leoGain(state, leo, synergy) > 0 ? leo : null;
  if (importance < 6) return null;
  const archivesAgenda = state.corp.archives.faceDown.some(c => type(c) === 'agenda');
  for (const action of getLegalActions(state, 'corp')) {
    if (action.type !== 'USE_ABILITY') continue;
    const code = findCardAnywhere(state, action.cardInstanceId)?.cardCode;
    if (code === '35035') return action; // LEO: trash a bioroid, end the run
    if (code === '35048' && !archivesAgenda && state.activeRun?.server !== 'archives') return action; // Proprionegation
    if (code === '36045') return action; // The Red Room: a power counter, end the run
    if (code === '36035' && perfectRecallTarget(state)) return action; // Perfect Recall: protect the agenda the Runner is after
  }
  // Event Horizon: trash it to end the run, only for a run that would take an agenda
  if (importance >= 7) {
    const horizon = getLegalActions(state, 'corp').find(a => a.type === 'USE_ABILITY' && findCardAnywhere(state, a.cardInstanceId)?.cardCode === '36058');
    if (horizon) return horizon;
  }
  return null;
}

/**
 * LEO against letting the Runner in: the board after trashing the bioroid the AI would pick and
 * ending the run, against the board after the run takes what it would (agendas in the root
 * stolen; HQ and R&D by the odds, runLoss).
 */
function leoGain(state: GameState, action: GameAction, synergy: boolean): number {
  let after = simulate(state, action);
  for (let i = 0; after && i < 3 && activePrompt(after)?.side === 'corp'; i++) after = simulate(after, answerPrompt(after, 'corp', undefined, synergy));
  if (!after) return -Infinity;
  // Out of clicks, the Runner can't come back this turn: the Corp moves next (protects or scores the agenda)
  const next = (st: GameState): GameState => (st.runner.clicks > 0 ? st : { ...st, activePlayer: 'corp' });
  const server = state.corp.servers[state.activeRun!.server];
  const agendas = server.root.filter(c => type(c) === 'agenda');
  let letIn: number;
  if (agendas.length > 0) {
    const stolen = structuredClone(state);
    const root = stolen.corp.servers[server.id].root;
    for (const a of agendas) {
      const i = root.findIndex(c => c.instanceId === a.instanceId);
      stolen.runner.scoreArea.push(...root.splice(i, 1));
      stolen.runner.score += cardDef(a).agenda_points ?? 0;
    }
    stolen.activeRun = null;
    letIn = evaluate(next(stolen), 'corp');
  } else letIn = evaluate(state, 'corp') - runLoss(state);
  return evaluate(next(after), 'corp') - letIn;
}

/** An asset whose whole worth is what it does when rezzed (Spin Doctor), not a money asset that pays out. */
export function onRezOnly(card: CardInstance): boolean {
  return type(card) === 'asset' && !CARD_PROFILES[card.cardCode] && /^When you rez this asset, draw/i.test(cardDef(card).stripped_text ?? '');
}

export function agendaStakes(state: GameState, agenda: CardInstance): number {
  const points = cardDef(agenda).agenda_points ?? 1;
  return points + (state.runner.score + points >= 7 ? 3 : 0) + 0.25 * Math.min(agenda.advancementCounters, 4);
}

/**
 * Perfect Recall: the card in HQ to reveal so the Runner can't steal it on
 * this run: on an HQ run the agenda worth most there; on a run where the
 * root holds an agenda, a copy of it in HQ. Undefined: nothing worth it.
 */
export function perfectRecallTarget(state: GameState): string | undefined {
  const run = state.activeRun;
  if (!run || (run.protectedTitles?.length ?? 0) > 0) return undefined;
  const agendas = state.corp.hq.filter(c => type(c) === 'agenda');
  if (run.server === 'hq') return [...agendas].sort((a, b) => (cardDef(b).agenda_points ?? 0) - (cardDef(a).agenda_points ?? 0))[0]?.instanceId;
  const target = state.corp.servers[run.server]?.root.find(c => type(c) === 'agenda');
  return target ? agendas.find(c => cardDef(c).title === cardDef(target).title)?.instanceId : undefined;
}

/** How much the Corp cares about keeping the Runner out of this server (for rez decisions). */
function serverImportance(state: GameState, server: ServerState | undefined, aware = false): number {
  if (!server) return 0;
  const agenda = server.root.find(c => type(c) === 'agenda');
  if (agenda) return aware ? 7 + 1.5 * agendaStakes(state, agenda) : 10;
  if (server.id === 'hq') {
    const inHq = state.corp.hq.filter(c => type(c) === 'agenda');
    return 3 + (aware ? inHq.reduce((n, a) => n + agendaStakes(state, a), 0) : inHq.length * 2);
  }
  if (server.id === 'rd') return 4;
  if (server.id === 'archives') return state.corp.archives.faceDown.some(c => type(c) === 'agenda') ? 6 : 0.5;
  if (server.root.some(c => c.advancementCounters > 0)) return 1; // a trap: let them in
  if (server.root.some(c => c.isRezzed && econValue(c.cardCode, state))) return 3;
  return server.root.length > 0 ? 2 : 0.5;
}
