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
     * Self-play (new vs new) Corp 43.6%, was 36.6%; Jeff's target 50 ±5%.
     */
    /** Corp (round 3): keep credits to rez ice on two key servers (R&D, an agenda remote, HQ holding agendas). */
    rezMoney: true,
    /** Corp (round 3): ice R&D first, then HQ; more HQ ice only while it holds agendas. */
    centralIce: true,
    /** Corp (round 3): ice counts by what it costs the Runner to get through (free: not there); servers they keep getting into want more. */
    iceDepth: true,
    /** Corp (round 3): one scoring remote: no assets in it, new remotes iced only once it has 2 layers and rez money; money assets iced once attacked. */
    oneRemote: true,
    /** Corp (round 3): no half-advanced agendas: advance only when it can be scored next turn behind ice it can rez. */
    agendaTiming: true,
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
