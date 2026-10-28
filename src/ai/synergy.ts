import { CardInstance, GameAction, GameState, SideCode, cardDef, findCardAnywhere } from '../core';
import { THEMES, Theme, ThemeWeights, cardSynergy } from './synergyTags';

/**
 * Deck-aware nudges for the rule-based AI.
 *
 * Each side keeps a profile of what its own cards do and reward (see
 * synergyTags.ts), counting the identity most, cards in hand or installed
 * next and cards still in the deck least; trashed cards don't count. So
 * the profile follows the game: it shifts as cards are drawn, installed or
 * lost. A move that feeds a theme the deck pays off for, or that puts a
 * payoff down while its enablers are around, gets a small bonus.
 *
 * Each side also reads the opponent's public cards (identity, installed
 * and rezzed cards, discards) and favours counters to what they rely on:
 * starving an econ-reliant opponent, purging a virus deck, clearing tags
 * against a tag-punishing Corp.
 *
 * The nudge is capped well below the main scores, so it breaks ties and
 * tips close calls but never overrides the AI's core judgement.
 */

/** Most a nudge can add to one move, in credit units. */
export const MAX_NUDGE = 1;
/** Weights, tuned with AI-vs-AI batches (scripts/ai-match.sh). */
export const tuning = {
  /*
   * Measured with new-vs-old batches on System Gateway + Elevation
   * (2026-10-25): the own-deck nudge cost both sides games (their plain
   * scoring already plays these decks well), and the Corp's opponent
   * reading and hand-keeping did too. The Runner's opponent reading and
   * hand-keeping won games. So only those are on for now; the rest is
   * ready to re-test with scripts/ai-match.sh as sets with deeper combos
   * arrive.
   */
  /** Own-deck synergy term of the move nudge, per side. */
  synergy: { corp: 0, runner: 0 } as Record<SideCode, number>,
  /** Opponent-reading term of the move nudge, per side. */
  counter: { corp: 0, runner: 1 } as Record<SideCode, number>,
  /** Synergy when choosing which cards to keep in hand, per side. */
  keep: { corp: 0, runner: 1 } as Record<SideCode, number>,
  /** Over-advance Dividends agendas. */
  dividends: true,
  /** Runner: trap caution from the traps the Corp has shown. */
  wary: true,
  /** Corp: sell traps as agendas, and the naked-agenda reverse bluff. */
  bluff: true,
  /** Corp: purge sooner against a virus deck. */
  purge: true,
  /**
   * Corp: the naked-agenda reverse bluff (Jeff, 2026-10-26): only after the Runner has seen a
   * trap and while the Corp still has unseen traps, at most once a game, and weighted low
   * unless it is early or the Runner is short of credits or cards.
   */
  reverseBluff: true,
  /** Planning terms (round 2): each can be switched off for batches. */
  plan: {
    /*
     * Round 2 batches (663 deals per piece, 2026-10-25): Runner, all on +10
     * games over round 1; leaving one out: saving up was worth +6, tag
     * threat +2, urgency +1, breakers for seen ice -4. Corp, all on -31: ice
     * placement cost about 23 games as a flat bonus (now reworked to shift
     * between choices), tag threat -4, score setups +1. Noise is about ±16,
     * so only ice placement was a real signal; the rule is to keep pieces
     * that play more like a person unless they are clearly negative.
     */
    /** Tags are worth more while the Corp holds cards that punish them (per deciding side). */
    tagThreat: { corp: true, runner: true } as Record<SideCode, boolean>,
    /** Icebreakers for the ice types the Corp has shown are worth more. */
    breakerFocus: true,
    /** Runner: run an agenda the Corp could finish next turn now; defend harder late in the game. */
    urgency: true,
    /** Runner: take money toward a run it can't afford yet. */
    saveUp: true,
    /** Corp: plays that let an agenda be scored this turn (Seamless Launch, KPI...), and tagging before scoring Orbital Superiority. */
    scoreSetup: true,
    /** Corp: ice the Runner can't break, on servers under attack, mixing types. */
    icePlacement: true,
    /** Corp: guard agendas by their stakes (points, a winning steal, counters), HQ while it holds them. */
    agendaStakes: true,
    /*
     * Round 3 batches (1,105 deals, Corp only, 2026-10-25): all on +46 games
     * vs the old Corp (round 2 alone was -15). Leaving one out: rez money
     * was worth +22, agenda timing +27, central ice -12 (HQ steals rose; a
     * variant that keeps HQ's ice need was -8 vs no change: noise, kept as
     * the more human rule). HQ order (first HQ ice once R&D has one): +53.
     * Ice depth: as half a layer for breakable ice -25 (dropped); by the
     * Runner's cost to get through (v2) -5 vs without it, kept (noise).
     * One scoring remote: +104 vs old (49.0%; +56 over round 3 without it).
     * Rez money also on the Corp's own turn (assets) and fewer asset
     * remotes: +121 vs old (50.6%). Self-play (new vs new) Corp 45.4%, was
     * 36.6% before round 3; Jeff's target is 50 ±5%.
     */
    /** Corp (round 3): keep credits to rez ice on two key servers (R&D, an agenda remote, HQ holding agendas). */
    rezMoney: true,
    /** Corp (round 3): ice R&D first, then HQ; more HQ ice only while it holds agendas. */
    centralIce: true,
    /** Corp (round 3): ice counts by what it costs the Runner to get through (free: not there); servers they keep getting into want more. */
    iceDepth: true,
    /** Corp (round 3): one scoring remote: no assets in it, new remotes iced only once it has 2 layers and rez money; money assets iced once attacked. */
    oneRemote: true,
    /*
     * Identity plans (2026-10-25): self-play, Pork Chops + Peculiarity, 520
     * games: Corp 39.6% on vs 36.3% off (each deck about +3 points);
     * flatline wins 91 vs 65. All decks: new Corp +113 vs old (noise vs +121).
     */
    /** Identity plans: BANGUN's faceup agenda bait, PT Untaian's end-of-turn advancement (and the Runner reading faceup agendas). */
    identities: true,
    /* Tāo swap: used on 128 of 244 chances (was 6 of 221); self-play with the two Tāo decks, 1,360 games: Runner 55.8% vs 54.9% off (noise, kept). */
    /** Runner identity plans: Tāo Salonga's ice swap. */
    runnerIdentities: true,
    /** Corp: an agenda left over the Runner's turn only behind 2 real layers, or ice that costs more than the Runner has. */
    exposure: true,
    /* Funded depth (2026-10-26, self-play, 2,210 games): Corp 42.9% -> 44.8%; remote steals 1,714 -> 1,472, behind ice it couldn't afford to rez 883 -> 499. */
    /** Corp (Jeff): an agenda left over the Runner's turn counts unrezzed ice as a layer only if it can still pay to rez it. */
    fundedDepth: true,
    /*
     * Agenda money (2026-10-26, self-play after the Botulus fix, 2,210 games
     * each): main 43.0%, agenda money on 45.0%, plus funded ice plans 42.8%,
     * funded ice plans alone 40.9%. Funded ice plans lose about 2 points
     * (more ice where money was the problem): off, kept for re-testing.
     */
    /** Corp (Jeff): spending (plays, installs, rezzes elsewhere) keeps the money to rez an installed agenda's ice. */
    agendaMoney: true,
    /** Corp (Jeff): ice planning counts unrezzed ice as a layer only if it can be paid for. */
    fundedIcePlans: false,
    /*
     * Ice pacing (2026-10-27, self-play, 2,210 games): 46.8% -> 46.2% (noise).
     * Steals behind unrezzed ice the Corp couldn't afford: remote 287 -> 196,
     * R&D 581 -> 301, HQ 517 -> 268. Kept (Jeff's rule, plays like a person).
     */
    /** Corp (Jeff): no ice it can't afford to rez on top of its unrezzed ice already out, unless HQ is over the hand-size limit. */
    icePacing: true,
    /* Ice trashing (2026-10-27, self-play, 2,210 games each): 40.4% off -> 40.1% on (noise). Kept: plays like a person when short of money. */
    /** Corp: when installing ice, weigh trashing the weakest rezzed ice there first (rules 8.5.6b), on its own turn and for effects (Mercia). */
    iceTrash: true,
    /*
     * Opening round (2026-10-27, self-play, 2,210 games each). Before the
     * Manegarm fix: mulligan only 46.7%, + placement 46.1%, + centrals first
     * 45.0%, all three 47.0% (base 46.2%). After it: base 40.7%, all three
     * 40.4%. Neutral overall: R&D points 3,483 -> 2,974, remote 3,483 ->
     * 3,797. Bare R&D on the Runner's first turn 74% -> 37%. Kept (Jeff's
     * rule: within noise, plays like a person).
     */
    /** Corp (Jeff): R&D, and HQ while it holds agendas, get their first ice before any remote; HQ first while it holds agendas. */
    centralsFirst: true,
    /*
     * Entry gate (2026-10-27, self-play, 2,210 games each): off 40.1%, margin 2 39.9%, 4 39.6%, 6 36.5%. Remote points
     * fell (3,856 -> 2,609 at 4) but agendas waited in HQ instead (turns with an agenda stuck in HQ 8.5 -> 10.8) and HQ and
     * R&D steals rose. Off: holding agendas back only moves the steals.
     */
    /** Corp: leave an agenda out only behind ice that costs the Runner this much more than they have (0 = off: 2 layers or credits + 2). */
    entryGate: 0,
    /** Corp (Jeff): ice that would stop this Runner goes on a server that matters (R&D, the scoring remote, HQ holding agendas). */
    stopperPlacement: true,
    /** ...and remotes wait for their ice until then. */
    centralsFirstRemotes: false,
    /** Corp (Jeff): mulligan a hand with no ice it can rez early (rez cost 4 or less). */
    mulliganRez: true,
    /* Money target (2026-10-26, self-play, 2,210 games): off 42.7%, 0.3 46.8%, 0.6 46.8%. Kept the milder weight. */
    /** Corp (Jeff): aim for a surplus that rezzes the unrezzed ice on the centrals and scoring remote (credits-worth per credit short; 0 = off). */
    moneyTarget: 0.3,
    /** Corp: an agenda remote's rez reserve covers all its unrezzed ice. */
    deepReserve: false,
    /** Corp (Jeff): push agendas through a remote the Runner can't get into yet. */
    tempo: true,
    /** Corp: purge by what the counters do (Conduit, Tranquilizer...) against the 3 clicks it costs. */
    purgeValue: true,
    /** Corp: no ice it can't rez, nor ice that eats the rez money for ice already out. */
    affordIce: true,
    /*
     * Run budget (2026-10-26, self-play, 2,210 games): runs the Runner paid
     * into and lost fell from 1,536 to 1,265, jack-outs before known ice from
     * 282 to 9. Runner +36 games (Corp 44.2% -> 42.8%). Rez allowance alone:
     * within noise (kept, plays more like a person).
     */
    /** Runner: while breaking, keep the credits the rezzed ice further in needs; don't pay into a run it can't finish. */
    runBudget: true,
    /** Runner: a run that pays for outer ice counts the risk that unrezzed ice further in gets rezzed and stops it. */
    rezAllowance: true,
    /** Corp (round 3): no half-advanced agendas: advance only when it can be scored next turn behind ice it can rez. */
    agendaTiming: true,
    /*
     * Draw and money round (2026-10-26, self-play): all on Corp 45.4% (2,210
     * games). Off on 1,105: saveForOps 39.8%, blindDraws 42.0%, pettyCash,
     * hostedMoney and dig within noise. drawValue off for both sides 48.0%
     * (2,210), for either side alone within noise; kept (Jeff's rule: within
     * noise and plays more like a person).
     */
    /** Both sides (Jeff): a card in hand is worth about a credit up to the hand-size limit, not half of one (per deciding side). */
    drawValue: { corp: true, runner: true } as Record<SideCode, boolean>,
    /** Both sides: prompt answers don't count what the drawn cards are (the AI can't know), only how many. */
    blindDraws: true,
    /** Both sides (Jeff): draw harder for a missing answer (money, ice, a breaker) still in the deck, more under pressure (per side). */
    dig: { corp: true, runner: true } as Record<SideCode, boolean>,
    /** Corp (Jeff): taking credits off an asset (Regolith Mining License) counts as the money gained, not as board value lost. */
    hostedMoney: false,
    /* Rez money (2026-10-26, 2,210 self-play games): both on 46.7%, neither 47.2% (noise). Halving upgrade worth in empty remotes instead cost about 2 points. */
    /** Corp (Jeff): rez money for the cheapest run-ending ice on R&D (HQ, agenda remotes) even behind rezzed ice that doesn't stop runs. */
    iceReserve: false,
    /** Corp (Jeff): upgrades in a remote with no agenda can go out early, but are rezzed only with the ice reserve left over. */
    idleUpgrades: true,
    /** Corp: Petty Cash first thing in the turn (it can only be played then, and replays from Archives). */
    pettyCash: true,
    /** Corp: click for credits toward a money operation in HQ it can't afford yet (Hedge Fund, Subsidy...). */
    saveForOps: true,
    /** Runner: Botulus counters count as free breaks when costing ice; trojans go on the ice they help most, not doubled up. */
    trojans: true,
    /** Runner (Jeff): on bioroid ice, spend spare clicks on the worst subroutines, not only the run-ending ones. */
    bioroidClicks: true,
    /*
     * Value model step 2 (docs/ai-value-model-plan.md, Jeff 2026-10-27): the
     * new exchange rates in valueModel.ts. Self-play, 2,210 games each: all
     * off 40.1% Corp, all on 38.6%. Leave-one-out: no credit slide 41.0%, no
     * click rate 37.7%, no points clock 38.5%, no hand filter 38.2%. Per side:
     * the Runner's credit slide is worth about +2.6 points to the Runner, the
     * Corp's about +0.7 to the Corp (noise). The flat 1.25 click rate loses
     * for both sides (Corp's -2.5 to the Corp, Runner's -2 to -3 to the
     * Runner): off, kept for re-testing once a click is priced by the best
     * play in hand as planned. Points clock and hand filter: noise, kept.
     */
    /** Both sides: a click is worth 1.25 credits (at least 1), not 1 (per deciding side). */
    clickRate: { corp: false, runner: false } as Record<SideCode, boolean>,
    /** Both sides: credits slide against a need (the deck's build target or the board's need, whichever is more) instead of a flat bonus under 6 (per deciding side). */
    creditSlide: { corp: true, runner: true } as Record<SideCode, boolean>,
    /** Both sides: agenda points are worth more the closer they take a side to 7. */
    pointClock: true,
    /** Both sides: one card over the hand-size limit is a small plus (you discard your worst card), not nothing. */
    handFilter: true,
    /*
     * Value model step 6 (2026-10-27, self-play, 2,210 games each, base
     * 39.0%): off one at a time affordIce 38.5, deepReserve 38.6, iceReserve
     * 38.7, agendaMoney 37.9, icePacing 37.6, moneyTarget 37.0, rezMoney 35.5;
     * the first three off together 38.9 (noise). deepReserve and iceReserve
     * off (the credit slide now covers them; kept for re-testing). affordIce
     * stays on: without it the Corp installs ice it can't rez (Pharos with 9
     * credits left), which Jeff's rule forbids. With agendaMoney and
     * icePacing off too 33.6: those two stay on, as do moneyTarget and
     * rezMoney. hostedMoney off: the step 4 profile prices Regolith, the
     * only card it applied to.
     */
    /*
     * Step 3 (self-play, 2,210 games each, click rate off): off 37.7% Corp,
     * on 35.2%, Runner's only 34.8%: the Runner +2.5 to 3 points, the Corp's
     * within noise (kept). A flat 0.75 per Smartware credit first cost the
     * Runner 8 points (it stacked Smartware instead of running); each stacked
     * credit now waits a turn longer and is worth less.
     */
    /** Both sides (step 3, Jeff): counters are worth what they do on their card (counterValues.ts), not a flat rate per type (per deciding side). */
    counterEffects: { corp: true, runner: true } as Record<SideCode, boolean>,
    /** Both sides (step 4): money cards are worth what they will still pay out before the game ends (cardProfiles.ts). */
    cardProfiles: true,
    /** Both sides (Jeff, 2026-10-28): payouts that come when the turn begins keep full worth less the risk of losing the card; clicked payouts wait 7% a turn (cardProfiles.ts). */
    payoutRisk: true,
    /** Both sides (Jeff, 2026-10-28): the last 31 hand-set cards priced from what they do (effectValues.ts). */
    effectValues: true,
    /** Runner (Jeff, 2026-10-28): runs scored in the model's units, credits on the slide, steals on the point clock (runs.ts). */
    runModel: true,
    /** Jeff, 2026-10-28: Fermenter and other virus counters banked and at risk of a purge; Conduit counters worth the accesses still to come; one-use breakers (Mayfly) worth one run. */
    cardFixes: true,
    /** Value hacks replaced by the model, by group (Jeff, 2026-10-28; effectValues.ts). */
    modelHacks: { rez: true, rezPriority: true, purge: true, bonuses: true, iceAdvance: true } as Record<string, boolean>,
    /** Per deciding side (Jeff, 2026-10-28): its own hand valued card by card, by what each will do once played (handValues.ts). */
    handByCard: { corp: true, runner: true } as Record<SideCode, boolean>,
    /** Both sides: subroutine costs (tags, damage, trashed cards, lost credits) from the rates (runs.ts). */
    subCosts: true,
    /** Both sides (step 5, Jeff): ice is worth what it costs the Runner to get past it, not its rez cost (per deciding side). */
    iceInCredits: { corp: true, runner: true } as Record<SideCode, boolean>,
    /** Both sides (step 5b): breakers are worth the full stops they save across the Corp's decklist ice, less late in the game (per deciding side). */
    breakerCredits: { corp: true, runner: true } as Record<SideCode, boolean>,
  },
};

const IDENTITY = 3;
const LIVE = 1.5; // in hand or installed
const DECK = 0.5; // still in the deck
const SEEN = 1; // the opponent's discards and scored cards
const HAND_PAYOFF = 1; // a payoff in hand, about to come down
/** Basic actions (draw, advance, run) are taken over and over, so their nudge is much smaller. */
const BASIC = 0.4;

/** 0 for nothing, about 0.5 for a few cards' worth, approaching 1 for a deck built on it. */
const sat = (x: number) => (x <= 0 ? 0 : x / (x + 4));

// Move features beyond the card themes, used by the counters below.
type Feature = Theme | 'purge' | 'cleanTags' | 'trashEcon' | 'bigHand' | 'iceHq' | 'iceRd';
type Features = Partial<Record<Feature, number>>;

/** What to favour against an opponent leaning on a theme: their theme -> my move features. */
const COUNTERS: Record<SideCode, Partial<Record<Theme, Features>>> = {
  corp: {
    econ: { denial: 1, trashEcon: 1.5 }, // starve them: credit loss, trash their money resources
    virus: { purge: 1.5 },
    hq: { iceHq: 1 },
    rd: { iceRd: 1 },
  },
  runner: {
    econ: { trashEcon: 1.5, denial: 1 }, // trash their money assets, make them lose credits
    tags: { cleanTags: 1.5 },
    damage: { bigHand: 1.5 },
    operations: { hq: 0.5 },
  },
};

export interface Profile {
  /** How much of each theme the side's cards do (enablers), deck included. */
  supply: Record<Theme, number>;
  /** How much the side's cards reward each theme (payoffs), deck included. */
  demand: Record<Theme, number>;
  /**
   * Payoffs in play now (identity, installed, in hand): feeding a theme only
   * pays when something is there to collect.
   */
  live: Record<Theme, number>;
}

const empty = (): Record<Theme, number> => Object.fromEntries(THEMES.map(t => [t, 0])) as Record<Theme, number>;

function add(profile: Profile, card: CardInstance, weight: number, liveWeight = 0) {
  const { gives, wants } = cardSynergy(cardDef(card));
  for (const [t, w] of Object.entries(gives ?? {})) profile.supply[t as Theme] += w * weight;
  for (const [t, w] of Object.entries(wants ?? {})) {
    profile.demand[t as Theme] += w * weight;
    profile.live[t as Theme] += w * liveWeight;
  }
}

const blank = (): Profile => ({ supply: empty(), demand: empty(), live: empty() });

const corpInstalled = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.root, ...s.ice]);
const runnerInstalled = (state: GameState) => {
  const rig = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources];
  return [...rig, ...rig.flatMap(c => c.hostedCards ?? [])];
};

function buildOwn(state: GameState, side: SideCode): Profile {
  const p = blank();
  const [identity, hand, installed, deck] =
    side === 'corp'
      ? [state.corp.identity, state.corp.hq, corpInstalled(state), state.corp.rd]
      : [state.runner.identity, state.runner.grip, runnerInstalled(state), state.runner.stack];
  add(p, identity, IDENTITY, IDENTITY);
  for (const c of installed) add(p, c, LIVE, LIVE);
  for (const c of hand) add(p, c, LIVE, HAND_PAYOFF);
  for (const c of deck) add(p, c, DECK);
  return p;
}

/** What `side` can see of the other side's plan: identity, public cards, discards. */
function buildOpponent(state: GameState, side: SideCode): Profile {
  const p = blank();
  if (side === 'runner') {
    add(p, state.corp.identity, IDENTITY);
    for (const c of corpInstalled(state)) if (c.isRezzed || c.faceUp) add(p, c, LIVE);
    for (const c of [...state.corp.archives.faceUp, ...state.corp.scoreArea, ...state.runner.scoreArea]) add(p, c, SEEN);
  } else {
    add(p, state.runner.identity, IDENTITY);
    for (const c of runnerInstalled(state)) add(p, c, LIVE);
    for (const c of state.runner.heap) add(p, c, SEEN);
  }
  return p;
}

const ownCache = { corp: new WeakMap<GameState, Profile>(), runner: new WeakMap<GameState, Profile>() };
const oppCache = { corp: new WeakMap<GameState, Profile>(), runner: new WeakMap<GameState, Profile>() };

/** `side`'s own deck profile in this position. */
export function deckProfile(state: GameState, side: SideCode): Profile {
  let p = ownCache[side].get(state);
  if (!p) ownCache[side].set(state, (p = buildOwn(state, side)));
  return p;
}

/** `side`'s read of the opponent in this position, from public information only. */
export function opponentProfile(state: GameState, side: SideCode): Profile {
  let p = oppCache[side].get(state);
  if (!p) oppCache[side].set(state, (p = buildOpponent(state, side)));
  return p;
}

/** The card an action plays or installs (from hand), if any. */
function actionCard(state: GameState, action: GameAction): CardInstance | undefined {
  if (action.type !== 'INSTALL_CARD' && action.type !== 'PLAY_OPERATION_OR_EVENT') return undefined;
  const id = action.cardInstanceId;
  const hand = action.player === 'corp' ? state.corp.hq : [...state.runner.grip, ...runnerInstalled(state)];
  return hand.find(c => c.instanceId === id) ?? findCardAnywhere(state, id) ?? undefined;
}

const ECON_RESOURCE = (card: CardInstance) => (cardSynergy(cardDef(card)).gives?.econ ?? 0) >= 1;

/** The themes and counter features a move hits (before weighting). */
function moveFeatures(state: GameState, side: SideCode, action: GameAction): { features: Features; wants: ThemeWeights; card?: CardInstance } {
  const features: Features = {};
  const bump = (f: Feature, w = 1) => (features[f] = (features[f] ?? 0) + w);
  const card = actionCard(state, action);
  let wants: ThemeWeights = {};
  if (card) {
    const syn = cardSynergy(cardDef(card));
    for (const [t, w] of Object.entries(syn.gives ?? {})) bump(t as Theme, w);
    wants = syn.wants ?? {};
    const type = cardDef(card).type_code;
    if (type === 'operation') bump('operations');
    if (type === 'ice' && action.type === 'INSTALL_CARD') {
      if (action.targetServerId === 'hq') bump('iceHq');
      if (action.targetServerId === 'rd') bump('iceRd');
    }
  }
  switch (action.type) {
    case 'DRAW_CARD': {
      const [size, limit] = side === 'corp' ? [state.corp.hq.length, state.corp.handSizeLimit] : [state.runner.grip.length, state.runner.handSizeLimit];
      if (size < limit) bump('draw', BASIC);
      if (side === 'runner' && size <= 2) bump('bigHand');
      break;
    }
    case 'ADVANCE_CARD':
      bump('advance', BASIC);
      break;
    case 'PURGE_VIRUS':
      bump('purge');
      break;
    case 'REMOVE_TAG':
      bump('cleanTags');
      break;
    case 'TRASH_RESOURCE': {
      const target = state.runner.rig.resources.find(c => c.instanceId === action.cardInstanceId);
      if (target && ECON_RESOURCE(target)) bump('trashEcon');
      break;
    }
    case 'INITIATE_RUN': {
      const id = action.targetServerId;
      bump('runs', BASIC);
      if (id === 'hq' || id === 'rd' || id === 'archives') bump(id, BASIC);
      const root = state.corp.servers[id]?.root ?? [];
      if (root.some(c => c.isRezzed && cardDef(c).type_code === 'asset' && ECON_RESOURCE(c))) bump('trashEcon');
      if (root.some(c => cardDef(c).type_code !== 'agenda' && (c.isRezzed || c.advancementCounters === 0))) bump('trash', 0.5);
      break;
    }
  }
  return { features, wants, card };
}

export interface Nudge {
  bonus: number;
  /** Why, for the debug log: "econ→payoff 0.4" and the like. */
  reasons: string[];
}

/**
 * The deck-aware bonus for a move, capped at MAX_NUDGE. Never negative:
 * a move off-plan simply gets no help.
 */
export function nudge(state: GameState, side: SideCode, action: GameAction, explain = false): Nudge {
  const { features, wants, card } = moveFeatures(state, side, action);
  const own = deckProfile(state, side);
  const opp = opponentProfile(state, side);
  // Leave the card itself out of the profile it is judged against
  const self = card ? cardSynergy(cardDef(card)) : {};
  const reasons: string[] = [];
  let synergy = 0;
  for (const [f, w] of Object.entries(features)) {
    if (!(f in own.demand)) continue;
    const t = f as Theme;
    const v = w * sat(own.live[t] - (self.wants?.[t] ?? 0) * HAND_PAYOFF);
    if (v > 0.01) {
      synergy += v;
      if (explain) reasons.push(`feeds ${t} payoffs +${(v * tuning.synergy[side]).toFixed(2)}`);
    }
  }
  for (const [t, w] of Object.entries(wants)) {
    const v = (w ?? 0) * sat(own.supply[t as Theme] - (self.gives?.[t as Theme] ?? 0) * LIVE);
    if (v > 0.01) {
      synergy += v;
      if (explain) reasons.push(`pays off ${t} +${(v * tuning.synergy[side]).toFixed(2)}`);
    }
  }
  let counter = 0;
  for (const [theirs, answers] of Object.entries(COUNTERS[side])) {
    const lean = sat(opp.supply[theirs as Theme]);
    if (lean <= 0) continue;
    for (const [f, w] of Object.entries(answers ?? {})) {
      const v = lean * (w ?? 0) * (features[f as Feature] ?? 0);
      if (v > 0.01) {
        counter += v;
        if (explain) reasons.push(`counters their ${theirs} (${f}) +${(v * tuning.counter[side]).toFixed(2)}`);
      }
    }
  }
  const bonus = Math.min(MAX_NUDGE, tuning.synergy[side] * synergy + tuning.counter[side] * counter);
  return { bonus, reasons: reasons.filter(r => !r.endsWith('+0.00')) }; // weights at 0 add nothing
}

/** Extra reason to keep a card in hand: how well it fits the deck's plan (0 to about 1). */
export function keepBonus(state: GameState, card: CardInstance): number {
  const side = cardDef(card).side_code as SideCode;
  const own = deckProfile(state, side);
  const syn = cardSynergy(cardDef(card));
  let v = 0;
  for (const [t, w] of Object.entries(syn.gives ?? {})) v += (w ?? 0) * sat(own.demand[t as Theme] - (syn.wants?.[t as Theme] ?? 0) * LIVE);
  for (const [t, w] of Object.entries(syn.wants ?? {})) v += (w ?? 0) * sat(own.supply[t as Theme] - (syn.gives?.[t as Theme] ?? 0) * LIVE);
  return Math.min(1, tuning.keep[side] * v);
}

/** How hard the opponent leans on a theme, 0 to 1 (e.g. "is this Runner econ-reliant?"). */
export function opponentLean(state: GameState, side: SideCode, theme: Theme): number {
  return sat(opponentProfile(state, side).supply[theme]);
}

// ---- Debug log: which tag pushed each move ----

let debug = false;

/** Logs every top-level AI move with the synergy and opponent-read reasons behind it. */
export function setSynergyDebug(on: boolean) {
  debug = on;
}

export function logNudge(state: GameState, side: SideCode, action: GameAction) {
  if (!debug) return;
  const { bonus, reasons } = nudge(state, side, action, true);
  const card = 'cardInstanceId' in action && action.cardInstanceId ? findCardAnywhere(state, action.cardInstanceId) : null;
  const what = `${action.type}${card ? ` ${cardDef(card).title}` : ''}${action.type === 'INITIATE_RUN' ? ` ${action.targetServerId}` : ''}`;
  console.debug(`[AI ${side}] ${what}: nudge +${bonus.toFixed(2)}${reasons.length ? ` (${reasons.join('; ')})` : ''}`);
}
