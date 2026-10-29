import { CardInstance, SideCode } from '../types/card';
import { EffectSource, PromptChoice } from '../types/prompts';
import { CardInstance as Card } from '../types/card';
import { GameState, RunState } from '../types/state';

export interface EffectContext {
  state: GameState;
  /** The card whose ability is resolving. */
  card: CardInstance;
  side: SideCode;
  /** For operations and events: played from HQ or the grip (Petty Cash cares). */
  playedFromHand?: boolean;
}

export type EffectAnswer = Extract<PromptChoice, { kind: 'effect_choice' | 'effect_cards' }>;

/**
 * Scripted behavior for one card, keyed by card code in the registry.
 * Hooks mutate the state directly and may queue prompts; when a prompt is
 * answered, onPromptAnswer is called with the step name the script chose.
 */
export interface CardScript {
  /** Extra play restrictions. Return a reason to forbid playing. */
  canPlay?(ctx: EffectContext): string | null;
  /** Resolves an operation or event after its costs are paid. */
  onPlay?(ctx: EffectContext): void;
  /** Continues a multi-step effect after a prompt this script queued is answered. */
  onPromptAnswer?(ctx: EffectContext, source: EffectSource, answer: EffectAnswer): void;
  /** Ice behavior: subroutines, strength modifiers, encounter/rez triggers. */
  ice?: IceScript;
  /** Icebreaker behavior: what it breaks, costs, and strength abilities. */
  breaker?: BreakerScript;
  /** Install cost change for Runner cards (e.g. Carmen). Negative = cheaper. */
  installCostModifier?(state: GameState, card: Card): number;
  /**
   * The current value of a counted effect ("for each...", "X is..."), shown
   * when the card is hovered. Uses the same formula the effect resolves with.
   */
  liveValue?(state: GameState, card: Card): string | null;

  /** Reactions to game events while this card is active (see engine/triggers.ts). */
  triggers?: TriggerHandlers;
  /** Abilities the controller can trigger on this active card (USE_ABILITY). */
  abilities?: CardAbility[];
  /** Constant effects while this card is active. */
  modifiers?: CardModifiers;
  /** "When the Runner accesses this card": active even while the card is inactive (Urtica Cipher). */
  onAccessed?(ctx: EffectContext, where: AccessZone): void;
  /** "While the Runner is accessing this card in R&D, they must reveal it" (Byte!): the Corp sees the access. */
  revealedOnRdAccess?: boolean;
  /** A mid-access ability this active card offers on each access (Carnivore). */
  accessAbility?: AccessAbility;
  /** A run started by this card is successful (Red Team, Jailbreak, Conduit). */
  onRunSuccessful?(ctx: EffectContext): void;
  /**
   * A run started by this card would approach the server (Baker, with
   * RunState.bakerRedirect): may ask a question and, once answered, must call
   * approachServer() itself. Returns true if it paused the approach.
   */
  onWouldApproachServer?(ctx: EffectContext): boolean;
  /** An additional cost the Corp pays to score `agenda` while this card is active (Word on the Street). */
  payScoreCost?(ctx: EffectContext, agenda: Card): void;
  /** A run started by this card ends (Charm Offensive). */
  onRunEnds?(ctx: EffectContext, run: RunState): void;
  /** "As an additional cost to play this event/operation, spend [click]" (Double cards). */
  extraClicks?: number;
  /** Extra rez requirement, checked instead of "enough credits" (Plutus, Biawak). Return a reason to forbid. */
  rezBlocker?(state: GameState, card: Card, cost: number): string | null;
  /** Pays a rez cost with extras or alternatives, then calls completeRez (maybe after a prompt). */
  payRez?(ctx: EffectContext, cost: number): void;
  /** Hosted credits on this card can pay for this (recurring credits: Azimat, Mahkota Langit Grid; Open Market). */
  paysFor?(state: GameState, self: Card, purpose: PaymentPurpose): boolean;
  /** Recurring credits: refilled to this many when installed or rezzed and before its controller's turn begins. */
  recurringCredits?: number;
  /** Cards hosted faceup on this card can be played or installed as if they were in the grip (Bling). */
  hostedPlayable?: boolean;
  /** Ice subtypes a program hosted on ice gives its host (Chromatophores). */
  grantsIceSubtypes?: IceSubtype[];
  /** The Runner cannot trash this card while it is rezzed (Kessleroid). */
  runnerCannotTrash?: boolean;
  /** Identity: the Corp may install agendas faceup (BANGUN). */
  agendasFaceUp?: boolean;
  /** Trash this card when its last hosted credit is taken ("When it is empty, trash it"). */
  trashWhenEmpty?: boolean;
  /** Extra effect when emptied, after it is trashed (Nico Campaign: draw 1 card). */
  onEmptied?(ctx: EffectContext): void;
  /** Abilities still apply for the rest of the run if this is trashed while accessed (AMAZE Amusements). */
  persistent?: boolean;
  /** Runner program that must be installed on a piece of ice (Botulus, Tranquilizer). */
  installsOnIce?: boolean;
  /** Extra play restriction checked before a Runner card is installed. Return a reason to forbid. */
  canInstall?(ctx: EffectContext): string | null;
  /** Change to this operation's or event's play cost (Tailgate). Negative = cheaper. */
  playCostModifier?(state: GameState, card: Card): number;
  /** Change to this card's own rez cost, active while it is unrezzed (Reverb, Hype Machine; rules 9.1.8d). */
  ownRezCostModifier?(state: GameState, card: Card): number;
  /** Where this upgrade may be installed: 'central' (The Red Room) or 'hq-rd' (Flagship). */
  installOnly?: 'central' | 'hq-rd';
  /** "Install only faceup" agenda: installed faceup and active while installed (Sacrifice Zone Expansion, rules 3.2.3a). */
  installFaceUpOnly?: boolean;
  /**
   * An additional cost to steal `agenda`: its own (Méliès City Luxury Line,
   * active even while inactive, rules 9.1.8e; `self` is the agenda) or one
   * an active card adds to every agenda (Magistrate Revontulet).
   */
  stealCost?(state: GameState, self: Card, agenda: Card): { clicks?: number; credits?: number } | null;
  /** Subroutines this card can give a piece of ice (Stick and Poke), referred to by index from EncounterState.grantedSubs. */
  grantedSubroutines?: Subroutine[];
  /** This card can host installed Runner cards (Hackerspace): installing one onto it is allowed when this returns true. */
  hostsInstalled?(state: GameState, self: Card, card: Card): boolean;
  /** Credits off the install cost of a card installed onto this one (Hackerspace: 1). */
  hostedInstallDiscount?: number;
  /** Cards in hostedCards are facedown: the Corp can't see them (Read-Write Share). */
  hostedFaceDown?: boolean;
  /** Hosted credits on this card can be spent during runs, on anything (Methuselah, Touchstone). */
  paysDuringRuns?: boolean;
  /** "When this card would be uninstalled": runs before an installed Corp card leaves play (Luana Campos). */
  onUninstall?(ctx: EffectContext): void;
  /** While this card is rezzed, runs against its server cannot be declared successful (Flagship, rules 6.8.4a). */
  blocksSuccess?: boolean;
  /** While rezzed (and persistent once trashed), the Runner cannot access more than 1 card other than this one during runs on its server (Flagship, rules 7.4.2b). */
  limitsAccessToOne?: boolean;
}

/**
 * Game events that card abilities react to. Handlers receive the context of
 * the reacting card (its controller as `side`), not the card that caused the
 * event, which is in the event itself.
 */
export type TriggerEvent =
  | { type: 'turn_begins'; side: SideCode }
  | { type: 'action_phase_ends'; side: SideCode }
  | { type: 'discard_phase_ends'; side: SideCode }
  /** Cards a player discarded at the end of their turn to reach their maximum hand size. */
  | { type: 'discarded_to_hand_size'; side: SideCode; cards: Card[] }
  /** `paid` is the credits spent on the install (Bling: "without spending credits"). */
  | { type: 'installed'; card: Card; paid?: number }
  | { type: 'rezzed'; card: Card }
  | { type: 'advanced'; card: Card; hadCounters: boolean }
  | { type: 'agenda_scored'; card: Card; serverId: string }
  /** `serverId`: the server attacked when it was stolen (Perfect Recall's "stolen from this server"). */
  | { type: 'agenda_stolen'; card: Card; serverId?: string }
  | { type: 'successful_run'; server: string }
  | { type: 'approach_server'; server: string }
  | { type: 'run_ends'; server: string; successful: boolean; accessedCount: number; stoleAgenda: boolean }
  | { type: 'tags_taken'; count: number }
  | { type: 'tags_removed'; count: number }
  | { type: 'trashed_on_access'; card: Card }
  | { type: 'run_begins'; server: string }
  | { type: 'approach_ice'; ice: Card; server: string }
  | { type: 'encounter_ice'; ice: Card }
  | { type: 'breach_server'; server: string }
  | { type: 'card_accessed'; card: Card; where: AccessZone }
  /** The Runner trashed a Corp card (on access or by a card ability). */
  | { type: 'runner_trashed_corp_card'; card: Card; wasInstalled: boolean; wasRezzed: boolean }
  | { type: 'operation_played'; card: Card }
  | { type: 'damage_dealt'; damage: 'net' | 'meat' | 'core'; amount: number; byCorp: boolean }
  /** The Corp trashed cards from HQ (Hansei Review, sabotage, ...). */
  | { type: 'hq_trashed'; count: number }
  /** A player gained credits through an ability on `source` (The Zwicky Group). */
  | { type: 'credits_gained'; side: SideCode; amount: number; source: Card }
  | { type: 'agenda_forfeited'; card: Card }
  | { type: 'bad_publicity_taken'; count: number }
  /** The Runner broke subroutines on `ice` with `breaker` (null: an ability on the ice, like a bioroid's). */
  | { type: 'subroutines_broken'; ice: Card; breaker: Card | null; count: number }
  /** The Runner passed a piece of ice; `fullyBroken` only when passed after an encounter in which they fully broke it (rules 6.1.3f). */
  | { type: 'ice_passed'; ice: Card; server: string; fullyBroken: boolean; outermost: boolean }
  /** The Runner fully broke the encountered ice (rules 6.5.7a). */
  | { type: 'ice_fully_broken'; ice: Card }
  | { type: 'event_played'; card: Card }
  /** Facedown cards in Archives were turned faceup (Nurse Hạnh). */
  | { type: 'archives_turned_faceup'; count: number }
  /** A piece of hardware was trashed, from any location (Hiram "0mission" Svensson). */
  | { type: 'hardware_trashed'; card: Card }
  /** The Runner spent credits from outside their credit pool during a run (Shackleton Grid). */
  | { type: 'credits_spent_outside_pool'; amount: number };

/** Where a card was accessed from. */
export type AccessZone = 'installed' | 'hq' | 'rd' | 'archives';

export type TriggerType = TriggerEvent['type'];

export type TriggerHandlers = {
  [K in TriggerType]?: (ctx: EffectContext, event: Extract<TriggerEvent, { type: K }>) => void;
};

/**
 * An ability on an active card. Costs are checked and paid in this order:
 * clicks, credits, hosted counters; then `resolve` runs; then the card is
 * trashed or removed from the game if that is part of the cost (so the
 * effect can still read the card's counters, as with Fermenter).
 */
export interface CardAbility {
  label: string;
  /** Usable only while this card is in Archives (Petty Cash). */
  fromArchives?: boolean;
  /** The Corp can use this while the agenda is in the Runner's score area (Next Big Thing). */
  fromRunnerScoreArea?: boolean;
  /** Either player can use this ability (Detente); the user pays its costs. */
  anyPlayer?: boolean;
  /** Click abilities can only be used in the controller's action phase. */
  clicks?: number;
  credits?: number;
  /** Hosted counters spent from this card (Botulus, Leech: 'virus'). */
  counters?: { type: CounterType; count: number };
  trashSelf?: boolean;
  removeSelfFromGame?: boolean;
  oncePerTurn?: boolean;
  /** Usable only while this card is in HQ (Tocsin: "reveal and trash this ice from HQ"). */
  fromHQ?: boolean;
  /** The credits can only come from stealth cards (Corsair). */
  stealthOnly?: boolean;
  /** Extra condition. Return a reason to forbid using the ability now. */
  canUse?(ctx: EffectContext): string | null;
  resolve(ctx: EffectContext): void;
}

export type CounterType = 'credit' | 'virus' | 'power' | 'agenda';

/** What a payment is for, so cards with restricted credits know whether they can help. */
export type PaymentPurpose =
  /** Only credits from stealth cards ("Spend credits only from stealth cards": Corsair, Lampades, Baker). */
  | { kind: 'stealth' }
  | { kind: 'rez'; card: Card }
  | { kind: 'install'; card: Card }
  | { kind: 'trash'; card: Card }
  | { kind: 'other' };

export interface CardModifiers {
  /** +memory units while active (Runner hardware). */
  memory?: number;
  /** +maximum hand size for the controller while active (a function when it depends on the game: Hackerspace). */
  handSize?: number | ((state: GameState, self: Card) => number);
  /** Change to the install cost of a Runner card (DZMZ Optimizer). Negative = cheaper. */
  runnerInstallCost?(state: GameState, self: Card, installing: Card): number;
  /** Cards drawn by the first basic draw action each turn, instead of 1 (Verbal Plasticity). */
  firstBasicDraw?: number;
  /** Extra cards to access when breaching a server (Docklands Pass). */
  breachAccesses?(state: GameState, self: Card, serverId: string): number;
  /** Strength for the icebreaker hosting this card (GAMEDRAGON™ Pro). */
  hostStrength?: number;
  /** Strength increases on the hosting icebreaker last for the rest of the run (GAMEDRAGON™ Pro). */
  boostsLastForRun?: boolean;
  /** Change to the rez cost of a Corp card (Fransofia Ward: +1 for ice). */
  rezCost?(state: GameState, self: Card, rezzing: Card): number;
  /** Change to the trash cost of a Corp card (Mahkota Langit Grid). */
  trashCost?(state: GameState, self: Card, trashing: Card, serverId: string | undefined): number;
  /** Change to the strength of each piece of ice (The Tungsten Tailor: -1). */
  iceStrength?(state: GameState, self: Card, ice: Card): number;
  /** Clicks off the play action for this operation (Synchrocyclotron: the first double each turn). */
  playClickDiscount?(state: GameState, self: Card, playing: Card): number;
}

/**
 * A mid-access ability offered while the Runner accesses a card (Carnivore).
 * `use` pays the cost (possibly via a prompt) and then trashes the accessed
 * card with trashAccessedCard().
 */
export interface AccessAbility {
  label: string;
  canUse(ctx: EffectContext, accessed: Card): boolean;
  use(ctx: EffectContext, accessed: Card): void;
}

export interface Subroutine {
  /** Short text shown in the UI. */
  label: string;
  /** Resolves the subroutine. May queue prompts; resolution resumes after they are answered. */
  resolve(ctx: EffectContext): void;
}

export interface IceScript {
  subroutines: Subroutine[];
  /** Change to printed strength (e.g. Palisade on remotes). */
  strengthModifier?(state: GameState, ice: Card): number;
  /** "When the Runner encounters this ice" (Funhouse). */
  onEncounter?(ctx: EffectContext): void;
  /** "When you rez this ice during a run against this server" (Ping). */
  onRezDuringRunOnServer?(ctx: EffectContext): void;
  /** The printed subroutines can only be broken with a fracter (Semak-samun). */
  fracterOnly?: boolean;
  /** "X[credit]: Break 1 subroutine on this ice. Only the Runner can use this ability." (N-Pot) */
  runnerBreakCost?: number;
  /** A bioroid's own click break ability, instead of "[Lose click]: Break 1 subroutine" (Ansel 2.0: lose 2 clicks, up to 2). */
  clickBreak?: { clicks: number; max: number };
  /** "When the Runner passes this ice" (Vertigo). */
  onPass?(ctx: EffectContext): void;
  /** "Whenever the Runner bypasses this ice" (Lethe). */
  onBypassed?(ctx: EffectContext): void;
  /** "Whenever an encounter with this ice ends" (Knowledge Seeker). */
  onEncounterEnds?(ctx: EffectContext): void;
}

export type IceSubtype = 'barrier' | 'code gate' | 'sentry';

export interface BreakerScript {
  /** Ice subtype this breaker's interface ability works on; 'any' for AI breakers. */
  breaks: IceSubtype | 'any';
  /** Most subroutines one use of the break ability can break. */
  breakMax: number;
  breakCost(state: GameState, breaker: Card): number;
  boostCost: number | ((state: GameState, breaker: Card) => number);
  boostAmount(state: GameState, breaker: Card): number;
  /** Constant change to printed strength (e.g. Echelon). */
  strengthModifier?(state: GameState, breaker: Card): number;
  /** Called after the break ability is used (e.g. Mayfly's trash-at-run-end). */
  onBreakUsed?(state: GameState, breaker: Card): void;
}
