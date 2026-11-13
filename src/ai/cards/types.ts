import type { CardInstance, GameState } from '../../core';
import type { Subroutine } from '../../core/scripts/types';
import type { CardProfile } from '../cardProfiles';
import type { CardValue } from '../cardValues';
import type { CorpEffect } from '../effectValues';
import type { CardSynergy } from '../synergyTags';
import type { RunOptions } from '../runs';

export type CounterType = 'credit' | 'virus' | 'power' | 'agenda';
export type CounterWorth = (state: GameState, card: CardInstance) => number;

/** What corpEffect works out once for every Corp card, before its own formula. */
export interface CorpEffectContext {
  /** Its rez cost, or 0 once rezzed (plan.rezPaid). */
  cost: number;
  /** Worth to the Corp of scoring a typical agenda from its deck. */
  agenda: number;
  /** Worth of a card in HQ. */
  card: number;
  /** Worth of a tag on the Runner. */
  tag: number;
}

/**
 * Everything the AI knows about one card's worth, in one place (2026-11-03,
 * from Gemini's CardFacts review). What a card does stays in its engine
 * script; this is only how the AI prices it. Every part is optional.
 */
export interface CardAI {
  /** Deck-aware synergy tags: what it gives and wants, and when its effect applies (synergyTags.ts). Every card has one. */
  synergy?: CardSynergy;
  /** Hand-set numbers: the fallback when effect values are off or a value loop is cut short (cardValues.ts). */
  value?: CardValue;
  /** Money cards: what they pay out and when (cardProfiles.ts). */
  profile?: CardProfile;
  /** Corp asset or upgrade: its worth from what it does, in credits (effectValues.ts corpEffect). */
  corp?: (state: GameState, code: string, ctx: CorpEffectContext) => CorpEffect;
  /** Runner rig card that isn't an icebreaker: its worth installed, in credits (effectValues.ts runnerEffect). */
  runner?: (state: GameState, code: string, card?: CardInstance) => number;
  /** Corp root card: its worth once rezzed, less the rez cost, where corp() doesn't say (effectValues.ts rezzedWorth). */
  rezzed?: (state: GameState, card: CardInstance, rezCost: number) => number;
  /** A run it starts (run event, run ability): what the card adds to that run (prompts.ts runEventOptions; runs.ts RunOptions). */
  run?: (state?: GameState) => RunOptions;
  /** One counter on it, by type (counterValues.ts COUNTER_WORTH). */
  counters?: Partial<Record<CounterType, CounterWorth>>;
  /** One counter on it worked out from what it turns into, while plan.counterFormulas is on. */
  counterFormulas?: Partial<Record<CounterType, CounterWorth>>;
  /** Corp card faceup in Archives that plays again from there: its worth waiting there (plan.oneCurrency, evaluate.ts corpBoardValue). */
  archived?: (state: GameState) => number;
  /** Corp operation that buys clicks or advancements to finish an agenda this turn: plan.finishSetup ranks it, and corpAI
   * operationBonus adds no bonus of its own (tuning pass 1, the old plan.oneSetupRule). */
  setup?: true;
  /** Rezzed ice that gains subroutines when the Runner encounters it, by the state now (Starlit Knight): the ones it
   * would gain on the next encounter this run, after its other subroutines, or none if it already has them. Run
   * planning reads them through runs.ts plannedSubroutines, so a run is priced against the ice as it will be met. */
  gainsOnEncounter?: (state: GameState, ice: CardInstance) => Subroutine[];
  /** Corp card whose damage can't all land on the Corp's own turn (plan.corpTurnDamageOwn, effectValues.ts damageThreat):
   * the most it can deal there, by the state now. Unset: what its text says (on access, during a run, if tagged: 0). */
  corpTurnDamage?: number | ((state: GameState) => number);
  /** Agenda with Dividends N: agenda counters placed for each excess advancement counter when it is scored (the Corp
   * over-advances it: corpAI overAdvance; counted scoring leaves it to the Corp at its requirement: winNow.ts,
   * countedScore.ts). */
  dividends?: number;
  /** Card that pays its owner credits when its turn begins (a rezzed Corp card, an installed Runner card): the credits,
   * and whether they are taken from the credits hosted on it (a campaign, Smartware Distributor: no more than it holds).
   * Counted scoring reads it as the Corp's next-turn income (countedScore.ts knownIncome) and as the Runner's turn-start
   * money (runnerBudget). */
  turnIncome?: { credits: number; hosted?: true };
  /** Runner card that pays off an Archives run, or turns one into a run on something else (Maintenance Access, Baker):
   * the Corp ices and rezzes Archives only against these, or with an agenda there (rezModel.ts archivesWantsIce). */
  archivesPayoff?: true;
  /** Agenda that gains the Corp credits when it is scored (Offworld Office 7): counted scoring's money left after a
   * two-turn line (countedScore.ts afterLineFloor). */
  scoreCredits?: number;
  /** Installed Runner card with a click ability that pays credits, one use on the Runner's next turn (countedScore.ts
   * runnerBudget): the clicks it costs and the credits it pays. hosted 'cap': no more than the credits hosted on it
   * (Telework Contract); 'add': plus every credit hosted on it (Pennyshaver). perVirus: credits per hosted virus counter,
   * with turnStart counters added as the Runner's turn begins (Fermenter). once: once per turn, or the card is trashed. */
  clickMoney?: { clicks: number; credits: number; hosted?: 'cap' | 'add'; perVirus?: { credits: number; turnStart: number }; once?: true };
  /** Trap whose advancement counters are its effect when the Corp's turn begins (Clearinghouse: meat damage per counter),
   * not a bluff that draws a run: a Runner who has accessed it still faces them (effectValues.ts knownTrap readers). */
  advancePayload?: true;
  /** Ice with an effect of its own when it is rezzed (its text: "When you rez this ice", Ping's tag): the counted rez
   * leaves a run-bypassed one to modelRez, which prices the rez with the ice passed (rezModel.ts countedRez). */
  rezEffect?: true;
  /** Clicks one use gives beyond the click it costs (Nanomanagement: gain 2, 1 to play it), read by winNow.ts's count of what this turn can still score. */
  clicksGiven?: number;
}
