import type { CardInstance, GameState, SideCode } from '../../core';
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
  /** Risk a Runner turn of losing it, for perTurn: an asset's measured (assetRisk, bare), else 0.06 until V-C (V-B B3). */
  risk: number;
}

/**
 * What a card does at the points of a Runner's turn the hold count walks (Stage D item 1, brief 4.4), as its text says:
 * facts the walk applies to the state it carries (counters, rez flags, tags, credits), never a worth. Read only by the
 * hold count (corp/hold.ts): the Runner's run prices (gainsOnEncounter, runs.ts plannedSubroutines) do not read them.
 */
export interface HoldFacts {
  /** When the Runner's turn begins (rule 5.7.1): counters it places on itself, then a derez of its host ice once it holds this many (Tranquilizer). */
  runnerTurnStart?: { counters: { kind: CounterType; n: number }; derezHostAt?: number };
  /** When a turn ends: this ice derezzes itself (Lycian Multi-Munition). */
  turnEndDerezSelf?: true;
  /**
   * When the Corp rezzes this ice during a run against its server (Flyswatter, Ping, Bumi 1.0), or, on an identity, any
   * ice of these subtypes during a run (Thunderbolt Armaments): what follows. A choice the Corp makes ("you may trash 1
   * installed trojan") is the Corp's: the walk takes the answer that keeps the Runner out (ruling 6).
   */
  rezDuringRun?: {
    purgeVirus?: true;
    tags?: number;
    corpMayTrashInstalled?: 'trojan';
    /** Identity: the rezzed ice of these subtypes gets this strength and gains this subroutine after its others, for the run (9.8.3e). */
    anyIce?: { subtypes: string[]; strength: number; gains: string };
  };
  /**
   * When the Runner encounters this ice (6.9.3a). `loses`: credits it loses. `toll`: what happens unless the Runner
   * pays any ONE of `unless`, its choice (Funhouse: the run ends unless it takes 1 tag; Seraph: it loses 3 unless it
   * suffers 2 net damage or takes 1 tag; Jaguarundi: a tag unless it spends a click), active from `threatAtLeast`.
   */
  encounter?: {
    loses?: number;
    toll?: { endRun?: true; loses?: number; tags?: number };
    unless?: { tags?: number; netDamage?: number; clicks?: number };
    threatAtLeast?: number;
  };
  /**
   * A Runner card hosted on ice: whenever its host is encountered, if the host is not of `unlessSubtype`, the Runner may
   * pay `creditsPerSubroutine` for each subroutine the host has to bypass it (Physarum Entangler; 6.5.8a).
   */
  hostBypass?: { creditsPerSubroutine: number; unlessSubtype: 'barrier' | 'code gate' | 'sentry' };
  /** Trashed when the Corp purges virus counters (Physarum Entangler). */
  trashedOnPurge?: true;
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
  /** Corp card faceup in Archives that plays again from there: its worth waiting there (read by archivedWorth; its evaluate reader went with plan.oneCurrency in audit Step 3). */
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
  /** Runner rig card that may spend one of its counters, when the Runner breaches `server`, to access 1 more card
   * (Devadatta Drone on R&D): runs.ts runScore counts the access on a run there while a counter is left, and charges the
   * counter at its worth (counterValues.ts counterWorth). */
  breachAccess?: { server: string; counter: CounterType };
  /** Agenda with Dividends N: agenda counters placed for each excess advancement counter when it is scored (the Corp
   * over-advances it: corpAI overAdvance; counted scoring leaves it to the Corp at its requirement: winNow.ts,
   * countedScore.ts). */
  dividends?: number;
  /** Card that pays its owner credits when its turn begins (a rezzed Corp card, an installed Runner card): the credits,
   * and whether they are taken from the credits hosted on it (a campaign, Smartware Distributor: no more than it holds).
   * Counted scoring reads it as the Corp's next-turn income (countedScore.ts knownIncome) and as the Runner's turn-start
   * money (runnerBudget). */
  turnIncome?: { credits: number; hosted?: true };
  /** What it does at the points of the Runner's turn the hold count walks (HoldFacts; Stage D item 1). */
  holdFacts?: HoldFacts;
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
  /** A trap's worth of one counter placed on it by an effect, `bluff` the generic trap's run drawn (placedCounterWorth; V-B B6). */
  placedCounter?: (state: GameState, card: CardInstance, bluff: number) => number;
  /** A rezzed card whose rez effect is done: its worth on the board as `viewer` knows it (Spin Doctor; corpCardValue; V-B B6). */
  spent?: (state: GameState, viewer: SideCode, card: CardInstance) => number;
  /** Advanceable ice: one more counter's worth, `left` still needed, in place of the Runner's cost step (iceAdvanceWorth; V-B B6). */
  advanceCounter?: (state: GameState, card: CardInstance, left: number) => number;
  /** Programs hosted on this card install without a click (Madani): runnerRigValue prices them with the click kept (V-B B6). */
  freeInstallHosted?: true;
  /** An identity that clears tags: `tags` tags' worth with it, `turnLoss` a Corp turn's loss; tagsWorth takes the lower (V-B B6). */
  tagClear?: (state: GameState, tags: number, turnLoss: number) => number;
}
