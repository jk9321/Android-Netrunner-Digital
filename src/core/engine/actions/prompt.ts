import { ResolvePromptAction } from '../../types/actions';
import { EffectSource, PromptChoice } from '../../types/prompts';
import { GameState } from '../../types/state';
import { SideCode } from '../../types/card';
import { cardDef } from '../../cards';
import { shuffleInPlace } from '../../rng';
import { addLog } from '../log';
import { findCardAnywhere, illegal, locateCorpCard, removeCard } from '../helpers';
import { getCardScript } from '../../scripts';
import { activePrompt, sideName } from '../prompts';
import { beginCorpTurn, finishDiscard, resumeTurn } from './turn';
import { continueAccess, finishAccess, trashAccessedCard } from './run';
import { availableCredits, spendCredits } from '../cardEffects';
import { resumeEncounter, resumeOnEncounter } from '../ice';
import { fireTrigger } from '../triggers';

export function resolvePrompt(state: GameState, action: ResolvePromptAction): void {
  answerPrompt(state, action);
  resumeRun(state);
  resumeTurn(state);
}

/**
 * Once no decision is pending, picks up whatever run step was waiting:
 * resolving subroutines, or accessing the rest of the breach.
 */
export function resumeRun(state: GameState): void {
  if (state.pendingPrompts.length > 0 || state.winner) return;
  const run = state.activeRun;
  if (!run) return;
  if (run.encounter?.onEncounterPending) resumeOnEncounter(state);
  else if (run.encounter?.resolvingIndex != null) resumeEncounter(state);
  else if (run.phase === 'access') continueAccess(state);
}

function answerPrompt(state: GameState, action: ResolvePromptAction): void {
  const prompt = activePrompt(state);
  if (!prompt || prompt.id !== action.promptId) illegal('That prompt is not waiting for an answer');
  if (prompt.side !== action.player) illegal(`Waiting on the ${sideName(prompt.side)}`);
  if (prompt.kind !== action.choice.kind) illegal('Answer does not match the prompt');

  state.pendingPrompts.shift();
  const choice = action.choice;

  switch (prompt.kind) {
    case 'mulligan': {
      if (choice.kind !== 'mulligan') return;
      if (choice.mulligan) mulligan(state, prompt.side);
      else addLog(state, prompt.side, `${sideName(prompt.side)} kept their opening hand.`);
      // Once both players have decided, the Corp's first turn begins.
      if (!state.pendingPrompts.some(p => p.kind === 'mulligan')) beginCorpTurn(state);
      return;
    }

    case 'discard': {
      if (choice.kind !== 'discard') return;
      const ids = new Set(choice.cardInstanceIds);
      const hand = prompt.side === 'corp' ? state.corp.hq : state.runner.grip;
      const chosen = hand.filter(c => ids.has(c.instanceId));
      if (ids.size !== prompt.count || chosen.length !== prompt.count) {
        illegal(`Choose exactly ${prompt.count} card(s) from your hand`);
      }
      for (const card of chosen) {
        removeCard(hand, card);
        if (prompt.side === 'corp') state.corp.archives.faceDown.push(card);
        else state.runner.heap.push(card);
      }
      addLog(
        state,
        prompt.side,
        prompt.side === 'corp'
          ? `Corp discarded ${chosen.length} card(s) to Archives.`
          : `Runner discarded ${chosen.map(c => cardDef(c).title).join(', ')}.`
      );
      finishDiscard(state);
      fireTrigger(state, { type: 'discarded_to_hand_size', side: prompt.side, cards: chosen });
      return;
    }

    case 'effect_choice': {
      if (choice.kind !== 'effect_choice') return;
      if (!prompt.options.some(o => o.id === choice.optionId)) illegal('Not one of the options');
      runScriptAnswer(state, prompt.source, choice);
      return;
    }

    case 'effect_cards': {
      if (choice.kind !== 'effect_cards') return;
      const ids = choice.cardInstanceIds;
      if (new Set(ids).size !== ids.length || ids.some(id => !prompt.candidateIds.includes(id))) {
        illegal('Choose only from the offered cards');
      }
      if (ids.length < prompt.min || ids.length > prompt.max) {
        illegal(prompt.min === prompt.max ? `Choose exactly ${prompt.min} card(s)` : `Choose ${prompt.min}-${prompt.max} card(s)`);
      }
      runScriptAnswer(state, prompt.source, choice);
      return;
    }

    case 'access_trash': {
      if (choice.kind !== 'access_trash') return;
      const found = locateCorpCard(state, prompt.cardInstanceId);
      if (!found) return;
      if (choice.alternativeId) {
        const alt = prompt.alternatives?.find(a => a.id === choice.alternativeId);
        const source = alt && findCardAnywhere(state, alt.id);
        const ability = source && getCardScript(source.cardCode)?.accessAbility;
        if (!source || !ability) illegal('That ability is not available');
        ability.use({ state, card: source, side: 'runner' }, found.card);
        return;
      }
      if (choice.trash) {
        if (prompt.trashCost === null) illegal('This card cannot be trashed by paying its trash cost');
        const purpose = { kind: 'trash' as const, card: found.card };
        if (availableCredits(state, 'runner', purpose) < prompt.trashCost) illegal('Not enough credits to trash');
        spendCredits(state, 'runner', prompt.trashCost, purpose);
        addLog(state, 'runner', `Runner paid ${prompt.trashCost} [credit] to trash ${cardDef(found.card).title}.`);
        trashAccessedCard(state, found.card);
        return;
      }
      finishAccess(state, found.card, found.zone);
      return;
    }
  }
}

function runScriptAnswer(
  state: GameState,
  source: EffectSource,
  answer: Extract<PromptChoice, { kind: 'effect_choice' | 'effect_cards' }>
): void {
  const card = findCardAnywhere(state, source.instanceId);
  const script = getCardScript(source.cardCode);
  if (!card || !script?.onPromptAnswer) illegal('The effect waiting on this prompt is gone');
  // The card's controller resolves the effect even when the other side answers.
  const controller = cardDef(card).side_code;
  script.onPromptAnswer({ state, card, side: controller }, source, answer);
}

/** Shuffles the hand back into the deck and draws 5 new cards. */
function mulligan(state: GameState, side: SideCode): void {
  if (side === 'corp') {
    state.corp.rd.push(...state.corp.hq.splice(0));
    shuffleInPlace(state.rng, state.corp.rd);
    state.corp.hq = state.corp.rd.splice(0, 5);
  } else {
    state.runner.stack.push(...state.runner.grip.splice(0));
    shuffleInPlace(state.rng, state.runner.stack);
    state.runner.grip = state.runner.stack.splice(0, 5);
  }
  addLog(state, side, `${sideName(side)} took a mulligan and drew a new hand of 5.`);
}
