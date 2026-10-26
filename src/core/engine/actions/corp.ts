import { AdvanceCardAction, RezCardAction, ScoreAgendaAction } from '../../types/actions';
import { GameState } from '../../types/state';
import { CardInstance } from '../../types/card';
import { fireTrigger } from '../triggers';
import {
  availableCredits,
  bumpTurnFlag,
  enforceInstallLimits,
  refillRecurring,
  rezCost,
  spendCredits,
  turnFlag,
  TurnFlag,
} from '../cardEffects';
import { cardDef } from '../../cards';
import { getCardScript } from '../../scripts';
import { addLog } from '../log';
import {
  checkAgendaVictory,
  findInstalledCorpCard,
  illegal,
  isAdvanceable,
  removeCard,
  requireActionPhase,
  requireClicks,
} from '../helpers';

export function advanceCard(state: GameState, action: AdvanceCardAction): void {
  if (action.player !== 'corp') illegal('Only Corp can advance');
  requireActionPhase(state, 'corp');
  requireClicks(state, 'corp');
  if (state.corp.credits < 1) illegal('Not enough credits to advance');

  const found = findInstalledCorpCard(state, action.cardInstanceId);
  if (!found || found.server.id !== action.serverId) illegal('Card not found in that server');
  const { card, server } = found;
  if (!isAdvanceable(card)) illegal('This card cannot be advanced');

  state.corp.clicks -= 1;
  state.corp.credits -= 1;
  const hadCounters = card.advancementCounters > 0;
  card.advancementCounters += 1;

  addLog(state, 'corp', `Corp spent [click] and 1 [credit] to advance a card in ${server.name} (now ${card.advancementCounters} counters).`);
  fireTrigger(state, { type: 'advanced', card, hadCounters });
}

/** Scoring is a separate Corp choice, available in their own turn once the requirement is met. */
export function scoreAgenda(state: GameState, action: ScoreAgendaAction): void {
  if (action.player !== 'corp') illegal('Only Corp can score agendas');
  // Also in the paid ability window before the turn begins (rules 5.6.1b)
  if (state.turnStep?.kind !== 'corp_turn_start') requireActionPhase(state, 'corp');

  const found = findInstalledCorpCard(state, action.cardInstanceId);
  if (!found || found.location !== 'root') illegal('Agenda not found in a server root');
  const { card, server } = found;
  const def = cardDef(card);
  if (def.type_code !== 'agenda') illegal('Only agendas can be scored');
  if (turnFlag(state, TurnFlag.cannotScore)) illegal('You cannot score agendas for the remainder of the turn');
  if (card.advancementCounters < (def.advancement_cost ?? 0)) {
    illegal(`Needs ${def.advancement_cost} advancement counters to score`);
  }

  removeCard(server.root, card);
  card.isRezzed = true;
  delete card.faceUp;
  state.corp.scoreArea.push(card);
  const pts = def.agenda_points || 0;
  state.corp.score += pts;
  bumpTurnFlag(state, TurnFlag.agendaPointsScored, pts);
  addLog(state, 'corp', `Corp scored ${def.title} for ${pts} agenda point(s)! Total: ${state.corp.score}`);
  checkAgendaVictory(state);
  if (!state.winner) fireTrigger(state, { type: 'agenda_scored', card, serverId: server.id });
}

export function rezCard(state: GameState, action: RezCardAction): void {
  if (action.player !== 'corp') illegal('Only Corp can rez cards');

  const found = findInstalledCorpCard(state, action.cardInstanceId);
  if (!found) illegal('Card to rez not found');
  const { card, server, location } = found;
  if (card.isRezzed) illegal('Card already rezzed');
  if (state.pendingPrompts.length > 0) illegal('Waiting on a decision');

  const def = cardDef(card);
  if (def.type_code === 'agenda') illegal('Agendas cannot be rezzed');

  if (location === 'ice') {
    // Ice can only be rezzed while the Runner is approaching it.
    const run = state.activeRun;
    const approached =
      run && run.phase === 'approach_ice' && run.server === server.id && run.icePosition !== null
        ? server.ice[run.icePosition]
        : null;
    if (!approached || approached.instanceId !== card.instanceId) {
      illegal('Ice can only be rezzed while the Runner is approaching it');
    }
  }

  const cost = rezCost(state, card);
  const purpose = { kind: 'rez' as const, card };
  const script = getCardScript(card.cardCode);
  const blocker = script?.rezBlocker
    ? script.rezBlocker(state, card, cost)
    : availableCredits(state, 'corp', purpose) < cost
      ? 'Not enough credits to rez'
      : null;
  if (blocker) illegal(blocker);

  if (script?.payRez) {
    // Additional or alternative costs (Plutus, Biawak); the script finishes the rez
    script.payRez({ state, card, side: 'corp' }, cost);
    return;
  }
  spendCredits(state, 'corp', cost, purpose);
  addLog(state, 'corp', `Corp spent ${cost} [credit] to rez ${def.title}.`, undefined, 'rez');
  completeRez(state, card);
}

/** Finishes a paid rez: the card is rezzed and "when you rez this during a run on this server" resolves. */
export function completeRez(state: GameState, card: CardInstance): void {
  rezForFree(state, card);
  const server = findInstalledCorpCard(state, card.instanceId)?.server;
  if (server && state.activeRun?.server === server.id) {
    getCardScript(card.cardCode)?.ice?.onRezDuringRunOnServer?.({ state, card, side: 'corp' });
  }
}

/** Rezzes a card without paying (rez action after payment, or "ignoring all costs") and fires rez triggers. */
export function rezForFree(state: GameState, card: CardInstance): void {
  card.isRezzed = true;
  delete card.faceUp;
  refillRecurring(card);
  enforceInstallLimits(state, card);
  fireTrigger(state, { type: 'rezzed', card });
}
