import type { CardInstance, GameState, Prompt, PromptChoice, SideCode } from '../../core';
import type { Subroutine } from '../../core/scripts/types';
import type { CardProfile } from '../cardProfiles';
import type { CardValue } from '../cardValues';
import type { CorpEffect } from '../effectValues';
import type { CardSynergy } from '../synergyTags';
import type { RunOptions, RunnerMemory } from '../runs';

export type CounterType = 'credit' | 'virus' | 'power' | 'agenda';

/** What a card's own prompt answer reads (prompts.ts todayAnswer, `promptAnswer`; B3 commit 1). */
export interface PromptAsk {
  state: GameState;
  /** The side answering (the prompt's owner). */
  side: SideCode;
  prompt: Prompt;
  /** The cards the answering Runner has accessed. */
  memory?: RunnerMemory;
  synergy: boolean;
}
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
 * facts the walk applies to the state it carries (counters, rez flags, tags, credits), never a worth. Read by the hold
 * count (corp/hold.ts). Since R-A A-move the Runner's run prices (runs.ts, runnerAI.ts) read three of them too, so both
 * sides read one place: `breaksHostSubroutine` (botulusBreaks, the encounter's Botulus use), `hostBypass` (physarumCost)
 * and `encounter` in Funhouse's shape only (a toll that ends the run unless N tags, no threat line: plainIcePrice). The
 * rest stay Corp-only: the Runner's price holds no copy of them (A-log L3: Tranquilizer's `runnerTurnStart.derezHostAt`,
 * Jaguarundi's, Seraph's and Paywall's `encounter`), so reading them would be a new reading, B5's to rule.
 */
export interface HoldFacts {
  /** When the Runner's turn begins (rule 5.7.1): counters it places on itself, then a derez of its host ice once it holds this many (Tranquilizer). */
  runnerTurnStart?: { counters: { kind: CounterType; n: number }; derezHostAt?: number };
  /** When a turn ends: this ice derezzes itself (Lycian Multi-Munition). */
  turnEndDerezSelf?: true;
  /**
   * When the Corp rezzes this ice it chooses the subtypes the ice gains while it stays rezzed, one of these sets
   * (Lycian Multi-Munition: "choose 1 or more subtypes among barrier, code gate, and sentry"). The walk takes the
   * choice that keeps the Runner out (ruling 6).
   */
  rezChoosesSubtypes?: string[][];
  /**
   * An additional cost to rez this ice: the Corp takes 1 bad publicity or removes 1 tag, its choice (Valentão, Piranhas;
   * 1.14.3a). The walk takes the choice worse for the Runner (ruling 6); bad publicity taken during a run fills the fund
   * from the next run on (6.9.1b, 10.6.3a, 10.6.3c).
   */
  rezBadPublicityOrTag?: true;
  /**
   * When the Corp rezzes this ice during a run against its server (Flyswatter, Ping, Bumi 1.0), or, on an identity, any
   * ice of these subtypes during a run (Thunderbolt Armaments): what follows. A choice the Corp makes ("you may trash 1
   * installed trojan") is the Corp's: the walk takes the answer that keeps the Runner out (ruling 6).
   */
  rezDuringRun?: {
    purgeVirus?: true;
    tags?: number;
    corpMayTrashInstalled?: 'trojan';
    /** Identity: the rezzed ice of these printed subtypes gains this subroutine after its others, for the run (9.8.3e; its +1 strength is not modelled). */
    anyIce?: { subtypes: string[]; gains: string };
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
  /** A program hosted on ice: a hosted counter of this kind breaks 1 subroutine on its host (Botulus). */
  breaksHostSubroutine?: { counter: 'virus' };
  /**
   * An agenda in the Corp's score area: "When this turn ends, derez `count` pieces of ice protecting that server", the
   * server it was used on this turn kept by the engine in the turn flag `${flag}:${instance id}` (its position in the
   * server list, plus 1) (Lightning Laboratory). With `count` or fewer rezzed there, all of them are derezzed; with
   * more, the Corp picks `count`, and the walk asks each pick (follow-up 4, ruling 8 (a)).
   */
  turnEndDerez?: { count: number; flag: string };
  /** A Runner card: each hosted counter of this kind pays `credits`, no click, during the Runner's turn (Coalescence; 9.5.1). */
  counterCredits?: { counter: 'power'; credits: number };
  /**
   * A Runner card: whenever a run begins (6.9.1c) it places `place` credits on itself; when it holds `takeAllAt` or more,
   * the Runner takes all of them (1.10.4a), trashes it and draws `draw` (Side Hustle).
   */
  runBeginCredits?: { place: number; takeAllAt: number; draw: number };
  /**
   * A Runner card: the first time each turn a run begins (6.9.1c), the Runner may trash 1 of its other installed cards
   * to gain credits equal to that card's printed install cost and draw `draw` ("Knickknack" O'Brian). The walk counts it
   * as a bound (follow-up 4, design answer): the largest printed install cost among the other installed cards, gained
   * with the card kept.
   */
  firstRunTrashForCost?: { draw: number };
  /**
   * A Runner card hosted on ice: whenever its host is rezzed, the Runner gains this many credits (Saci: "Whenever host
   * ice is rezzed or derezzed, gain 3 credits."). The walk reads it where it rezzes a set's ice (ai-rez-set); a derez is
   * not walked for it.
   */
  hostRezPays?: number;
}

/**
 * R-A A-move: the condition vocabulary of the Runner's run model (specs/r-a.md; a-move/step1-table.md and its ruling).
 * Facts only, as the card's text states them: a number, a flag, a named kind; no worth, no function (a credit or click
 * count is what the text charges). Every price stays in the code that reads the field: runs.ts and runnerAI.ts, and,
 * through breakPlans, runBypasses, bypassesAhead, iceCost and isTrap, the Corp too.
 */
/** Checked on each ice. `keywordAny`: one of these words, whole and in any case, in the ice's printed keywords;
 * `allSubsEndTheRun`: it has subroutines (plannedSubroutines) and each is exactly "End the run". */
export interface IceFits { subtype?: 'barrier' | 'code gate' | 'sentry'; strengthAtMost?: number; keywordAny?: string[]; allSubsEndTheRun?: true }
/** Checked once on the board: the threat level (the higher agenda score), the Corp's credits. */
export interface BoardWhen { threatAtLeast?: number; corpCreditsAtLeast?: number }
/** What one use spends or what limits its uses: `n` hosted counters a use (usable while it holds `n`); once a run or a
 * turn, by the engine's flag name with `<instance>` for the card's instance id (A-log L10); trashed or removed on use. */
export interface UseCost { counter?: { kind: 'virus' | 'power'; n: number }; once?: { per: 'run' | 'turn'; flag: string }; trashed?: true; removed?: true }
/** One way a card bypasses an ice it encounters (rules 6.5.8a). */
export interface Bypass { when?: BoardWhen; fits?: IceFits; cost: UseCost }
/** An icebreaker's ways of breaking or boosting that the generic plan (boost and break by its script) does not price. */
export interface BreakerFacts {
  trashedWhenRunEnds?: true; // Mayfly
  breaksPerEncounter?: number; // Slap Vandal: 1
  boostPerCounter?: { kind: 'virus'; strength: number }; // Hantu: a hosted virus counter, +2
  boostPerGripCard?: { strength: number }; // Audrey v2: a grip card trashed, +3
  /** A hosted counter breaks: its script's breakMax a counter (Audrey v2), or, with `creditsPerSubroutine`, any number on
   * an ice that `fits` for that many credits each (Lobisomem on a barrier). */
  breakByCounter?: { kind: 'virus' | 'power'; fits?: IceFits; creditsPerSubroutine?: number };
  boostOnce?: { strength: number; credits: number; when: BoardWhen; once: { per: 'run'; flag: string } }; // Pressure Spike: +9 for 2 at threat 4
  lowerPerStealthCredit?: { strength: number }; // Corsair: -3 a stealth credit
  noEndRun?: { credits: number; fits: IceFits }; // Banner: the subroutines of an ice that fits cannot end the run
}
/** A run whose first encountered ice is bypassed for `clicks` (S-Dobrado's run, Alarm Clock's), `option` the RunOptions
 * flag that turns it on (one entry each); `next`: while `when` holds, the second ice for `clicks` more (S-Dobrado). */
export interface FirstIceBypass { option: 'bypassFirst' | 'alarmClock'; clicks: number; next?: { when: BoardWhen; clicks: number } }
/** Facts the Runner's run model reads (R-A A-move). */
export interface RunFacts {
  breaker?: BreakerFacts;
  bypass?: Bypass[]; // in order: the first whose `when` and cost apply is the card's use (Malandragem's two modes)
  firstIce?: FirstIceBypass;
  trojan?: { second: 'adds' | 'idle' }; // a trojan: what a second copy on its host does (counterValues.ts trojanHostWorth, input 2)
  faceupAgendaAccess?: { meatDamage: number; tags: number }; // identity: accessing a faceup installed agenda (BANGUN)
  /** What the Runner suffers when it trashes this card: `tags` while the board meets `when` and, with `rezzed`, the card is
   * rezzed (Public Access Plaza); a damage would be a key here. Read by the price of a trash (runs.ts trashNet). */
  trashedByRunner?: { tags: number; when?: BoardWhen; rezzed?: true };
  hostileNotTrap?: true; // an ambush/hostile asset that does nothing accessed or left (Idiosyncresis; isTrap)
  playsAfterSuccessfulRuns?: string[]; // an event playable only after successful runs on these this turn (Chain Reaction)
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
  /** What it does on a run, as the Runner's run model reads it (RunFacts; R-A A-move). */
  runFacts?: RunFacts;
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
  /** The most advancement counters one use can place when the card's text counts something on the board (Flood the Market:
   * one per remote with a card in its root and ice), read by winNow.ts's count of what this turn can still score. Absent: the
   * count is parsed from the card text. */
  placesCounters?: (state: GameState) => number;
  /** A trap's worth of one counter placed on it by an effect, `bluff` the generic trap's run drawn (placedCounterWorth; V-B B6). */
  placedCounter?: (state: GameState, card: CardInstance, bluff: number) => number;
  /** A rezzed card whose rez effect is done: its worth on the board as `viewer` knows it (Spin Doctor; corpCardValue; V-B B6). */
  spent?: (state: GameState, viewer: SideCode, card: CardInstance) => number;
  /** Advanceable ice: one more counter's worth, `left` still needed, in place of the Runner's cost step (iceAdvanceWorth; V-B B6). */
  advanceCounter?: (state: GameState, card: CardInstance, left: number) => number;
  /** Runner card: the AI's answer to a prompt its own text asks (B3 commit 1, one home for the Runner's per-card answers).
   * prompts.ts todayAnswer reads it at one point, after the server choice, in the chain's order; undefined leaves the
   * prompt to the rest of the chain (the many-card build, then try each answer). Only Runner cards have one: the Corp's
   * per-card answers and the cases with no card to live in (AirbladeX's prevent_damage step, the server choice, Manegarm
   * answered by the Runner) stay in prompts.ts. */
  promptAnswer?: (ask: PromptAsk) => PromptChoice | undefined;
  /** What this card's prompt shows the Runner besides its face-up cards (B3 commit 2, runner/prompt.ts): `inPlace`, the
   * key of the prompt's data naming a card it shows by its text whose place the Runner knows (MuslihaT's top card). */
  promptShows?: { inPlace: string };
  /** Programs hosted on this card install without a click (Madani): runnerRigValue prices them with the click kept (V-B B6). */
  freeInstallHosted?: true;
  /** An identity that clears tags: `tags` tags' worth with it, `turnLoss` a Corp turn's loss; tagsWorth takes the lower (V-B B6). */
  tagClear?: (state: GameState, tags: number, turnLoss: number) => number;
  /** What the Corp does with this card against a Runner holding tags (TagUse; F119). Every Corp card that uses, needs or
   * spends the Runner's tags has one; the tag clock (evaluate.ts tagLoss) reads only this, never the ifTagged flag. */
  tagUse?: TagUse;
}

/** F119: one effect of a tag use (TagUse.does, TagUse.without). Facts only, never a price: each kind is priced by its
 * owner where it is read. Today's readers (F119-S, a translation at today's prices): `trashRig` in Retribution's hand
 * plan (cardPlans.ts, trashedCardCost); `damage` in Mindscaping's and Orbital Superiority's corpTurnDamage; `runnerCredits`
 * and `corpCredits` in Bigger Picture's hand plan; `freeRez` in freeRez.ts pendingFreeRezzes. The other kinds are stated
 * for the balance steps (brief f119-punisher-field rev 1, the owners table) and read by nothing yet. */
export interface TagUseEffect {
  trashRig?: 1; // trash 1 installed Runner card (Retribution): trashedCardCost
  damage?: number; // damage dealt, meat or net (damageWorth does not tell them apart)
  coreDamage?: number; // core damage dealt (Jaguarundi, during a run: the run model's)
  endRun?: 1; // the run ends (Lamplighter, during a run: the run model's runnerTagsAtLeast)
  runnerCredits?: number; // credits the Runner loses
  corpCredits?: number; // credits the Corp gains
  corpCards?: number; // net cards the Corp gains in HQ
  runnerPoints?: number; // agenda points taken from the Runner's score area
  /** an agenda the Corp installs from the Runner's score area (IP Enforcement): its advancement counters, printed
   * advancement requirement and printed points, all public */
  corpAgenda?: { counters: number; cost: number; points: number };
  freeRez?: number; // installed ice rezzed ignoring all costs (Unleash): freeRez.ts's readers
  advance?: number; // advancement counters placed (Greasing the Palm)
  install?: number; // a card installed from HQ ignoring all costs (Synapse Global)
}

/**
 * F119: what the Corp does with this card against a Runner holding n tags. Facts only; never a price. Every function reads
 * PUBLIC facts only (counts, credits, score areas, counters, tags; never the contents of HQ or R&D or a facedown card's
 * identity), because the Runner's view reads them for cards it cannot see (RULE-HIDDEN-INFO). Every function is closed
 * form in n and finite at n = Infinity (win-now passes Infinity): no loop to n, a min before any product with n.
 */
export interface TagUse {
  /** where the tag is used: on the Corp's own turn from HQ (an operation), the identity, the Runner's score area or as the
   * agenda is scored; or not on the Corp's turn: during a run (ice), on access, or as a tag is given (tagGiven) */
  from: 'hq' | 'identity' | 'runnerScoreArea' | 'onScore' | 'run' | 'access' | 'tagGiven';
  /** tags the use needs (1 for "play only if the Runner is tagged"; 0 for a use on a tag being given) */
  needs: number;
  /** tags it removes (IP Enforcement: X; Bigger Picture: the useful count) */
  spends: (state: GameState, n: number) => number;
  /** what it does with n tags */
  does: (state: GameState, n: number) => TagUseEffect;
  /** the card's best use with no tag, if it has one; several modes: a reader takes the best (Predictive Planogram) */
  without?: (state: GameState) => TagUseEffect | TagUseEffect[];
  /** F119-S, the translation (Corp coordinator ruling, 2026-11-27): false records that today's tag clock does not count
   * this card (the ifTagged flag's set did not hold it: Mindscaping, Greasing the Palm, Oracle Thinktank), so play stays
   * identical; the first balance step decides it. Unset: the clock counts the card (a new set's entry counts by default). */
  clock?: false;
}
