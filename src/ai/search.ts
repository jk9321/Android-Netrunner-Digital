import { CardInstance, GameAction, GameState, SideCode, activePrompt, getCardDefinition, isLegalAction } from '../core';
import { isAdvanceable } from '../core/engine/helpers';
import { Agent } from './agent';
import { HeuristicCorpAI } from './corpAI';
import { HeuristicRunnerAI } from './runnerAI';
import { evaluate } from './evaluate';
import { GameRunner } from './playout';
import { RunnerMemory } from './runs';
import { logNudge } from './synergy';

/**
 * Hard AI: Monte Carlo look-ahead on top of the rule-based AI.
 *
 * For each decision that matters (a main-phase action, or the Corp's rez
 * choice when the Runner approaches), it takes the rule-based AI's few best
 * candidates and plays each one forward through the opponent's next turn,
 * many times, with both sides played by the rule-based AI. Before every
 * playout it re-deals what it can't see (the Runner's guesses at unrezzed
 * cards, HQ and R&D; the Corp's guesses at the Grip and Stack), so it never
 * peeks. The candidate with the best average outcome wins.
 */

export interface SearchOptions {
  /** Thinking time per decision, in milliseconds. */
  timeMs: number;
  /** Fixed number of guessed deals per decision instead of a time limit (tests). */
  samples?: number;
  /** How many of the rule-based AI's best candidates to compare. */
  candidates: number;
  /** Seed for the guesses (tests); random otherwise. */
  seed?: number;
  /** Deck-aware nudges and opponent reading, in the AI and in its look-ahead (default on). */
  synergy?: boolean;
  /** Log each move's synergy reasons to the console. */
  debug?: boolean;
  /** Stop thinking once the outcome is clear (default on; off to compare). */
  earlyStop?: boolean;
}

const DEFAULTS: SearchOptions = { timeMs: 1000, candidates: 4 };
/** How much better (in evaluation points) another move must do on average to replace the favourite. */
const MIN_GAIN = 1;
/** ...and by how many standard errors. */
const MIN_Z = 1.5;
/** The rule-based favourite is played without searching when it leads the next move by this much. */
const CLEAR_LEAD = 3;
/** Deals to play before the search may stop early because the outcome is clear. */
const MIN_SAMPLES = 6;
/** Upper bound on decisions in one playout (a safety net; turns end well before). */
const MAX_PLAYOUT_STEPS = 160;

type Random = () => number;

/** A move to compare, and the first step its playouts take. */
type Candidate<A> = { action: A; score: number; first: GameAction | 'pass-rez' };

function mulberry(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: Random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Gives the cards in `slots` the codes in `codes` (same length), in order. */
function assign(slots: CardInstance[], codes: string[]) {
  slots.forEach((card, i) => (card.cardCode = codes[i]));
}

/**
 * A copy of the game where everything `side` can't see is re-dealt at
 * random from the cards it could be, and the shuffler is reseeded.
 */
export function determinize(state: GameState, side: SideCode, random: Random, memory?: RunnerMemory): GameState {
  const s = structuredClone({ ...state, log: state.log.slice(-3) });
  s.rng = { seed: Math.floor(random() * 2 ** 32), state: Math.floor(random() * 2 ** 32) };

  if (side === 'corp') {
    // The Corp doesn't know the Grip or the order of either deck
    const hidden = [...s.runner.grip, ...s.runner.stack];
    assign(hidden, shuffle(hidden.map(c => c.cardCode), random));
    assign(s.corp.rd, shuffle(s.corp.rd.map(c => c.cardCode), random));
    return s;
  }

  // The Runner doesn't know HQ, R&D, face-down Archives or unrezzed cards it hasn't accessed
  const installed = Object.values(s.corp.servers);
  const iceSlots = installed.flatMap(sv => sv.ice).filter(c => !c.isRezzed);
  const rootSlots = installed.flatMap(sv => sv.root).filter(c => !c.isRezzed && !memory?.has(c.instanceId));
  const loose = [...s.corp.hq, ...s.corp.rd, ...s.corp.archives.faceDown];
  const pool = shuffle([...iceSlots, ...rootSlots, ...loose].map(c => c.cardCode), random);

  const take = (fits: (code: string) => boolean): string | undefined => {
    const i = pool.findIndex(fits);
    return i === -1 ? undefined : pool.splice(i, 1)[0];
  };
  const typeOf = (code: string) => getCardDefinition(code).type_code;
  for (const card of iceSlots) card.cardCode = take(code => typeOf(code) === 'ice') ?? take(code => code === card.cardCode)!;
  for (const card of rootSlots) {
    const advanced = card.advancementCounters > 0;
    card.cardCode =
      take(code => {
        const type = typeOf(code);
        if (!['agenda', 'asset', 'upgrade'].includes(type)) return false;
        return !advanced || isAdvanceable({ cardCode: code } as CardInstance);
      }) ?? take(code => code === card.cardCode)!;
  }
  // Whatever is left goes back into HQ, R&D and Archives (counts stay the same)
  assign(loose, pool);
  return s;
}

function heuristicFor(side: SideCode, synergy: boolean, memory?: RunnerMemory): Agent {
  if (side === 'corp') return new HeuristicCorpAI({ synergy });
  const runner = new HeuristicRunnerAI({ synergy });
  memory?.forEach((code, id) => runner.knownCards().set(id, code));
  return runner;
}

/**
 * Plays from `state` (already re-dealt) with the rule-based AI on both
 * sides until the end of the opponent's next turn, and scores the result
 * for `side`.
 */
function playout(state: GameState, side: SideCode, first: GameAction | 'pass-rez', synergy: boolean, memory?: RunnerMemory): number {
  const runner = new GameRunner(state, { corp: heuristicFor('corp', synergy), runner: heuristicFor('runner', synergy, memory) });
  if (first === 'pass-rez') runner.passRezWindow();
  else runner.apply(first);

  // Stop once the turn has changed hands twice (our turn ends, then theirs)
  let handovers = 0;
  let lastActive = runner.state.activePlayer;
  for (let i = 0; i < MAX_PLAYOUT_STEPS && handovers < 2; i++) {
    if (!runner.step()) break;
    if (runner.state.activePlayer !== lastActive) {
      handovers++;
      lastActive = runner.state.activePlayer;
    }
    if (runner.state.log.length > 40) runner.state = { ...runner.state, log: runner.state.log.slice(-5) };
  }
  return evaluate(runner.state, side, synergy);
}

export class SearchAI implements Agent {
  readonly side: SideCode;
  private base: HeuristicCorpAI | HeuristicRunnerAI;
  private options: SearchOptions;
  private random: Random;

  constructor(side: SideCode, options: Partial<SearchOptions> = {}) {
    this.side = side;
    this.options = { ...DEFAULTS, ...options };
    const synergy = this.options.synergy ?? true;
    this.base = side === 'corp' ? new HeuristicCorpAI({ synergy }) : new HeuristicRunnerAI({ synergy });
    this.random = mulberry(this.options.seed ?? Math.floor(Math.random() * 2 ** 32));
  }

  private get memory(): RunnerMemory | undefined {
    return this.base instanceof HeuristicRunnerAI ? this.base.knownCards() : undefined;
  }

  chooseAction(state: GameState): GameAction {
    // Prompts and the steps of a run follow the rule-based AI's judgement
    if (activePrompt(state) || state.activeRun) return this.base.chooseAction(state);
    if (this.base instanceof HeuristicRunnerAI) this.base.observe(state);
    const ranked = this.base.rankMainActions(state).filter(c => c.score > -Infinity);
    if (ranked.length === 0) return this.base.chooseAction(state);
    if (ranked[0].action.type === 'SCORE_AGENDA') return ranked[0].action;
    // Only one sensible move, or the favourite is far ahead: no need to think it over
    if (ranked.length === 1 || ranked[0].score - ranked[1].score >= CLEAR_LEAD) {
      this.base.notePlayed(ranked[0].action);
      return ranked[0].action;
    }
    const best = this.search(state, ranked.slice(0, this.options.candidates).map(c => ({ ...c, first: c.action })), this.options.timeMs).action;
    this.base.notePlayed(best); // keeps the rule-based AI's loop guard in step
    if (this.options.debug) logNudge(state, this.side, best);
    return best;
  }

  chooseRez(state: GameState, cards: CardInstance[]): GameAction | null {
    if (!(this.base instanceof HeuristicCorpAI)) return null;
    const suggested = this.base.chooseRez(state, cards);
    // action null: let the Runner carry on without rezzing
    const options: Candidate<GameAction | null>[] = [
      { action: null, score: suggested ? 0 : 1, first: 'pass-rez' },
      ...cards.flatMap(card => {
        const action: GameAction = { type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId };
        // Cards the Corp can't afford to rez aren't worth playing out
        if (!isLegalAction(state, action)) return [];
        return [{ action, score: suggested && 'cardInstanceId' in suggested && suggested.cardInstanceId === card.instanceId ? 1 : 0, first: action }];
      }),
    ];
    if (suggested?.type === 'USE_ABILITY') options.push({ action: suggested, score: 1, first: suggested });
    options.sort((a, b) => b.score - a.score); // the rule-based AI's choice first
    return this.search(state, options, this.options.timeMs / 2).action;
  }

  /**
   * Compares candidates on the same guessed deals. The rule-based AI's
   * favourite (the first candidate) stands unless another candidate does
   * clearly better across the deals, so noise in a few playouts can't
   * talk the AI out of a sound move. It stops early once no other
   * candidate can still plausibly beat the favourite.
   */
  private search<C extends Candidate<GameAction | null>>(state: GameState, candidates: C[], timeMs: number): C {
    if (candidates.length === 1) return candidates[0];
    const values: number[][] = candidates.map(() => []);
    const deadline = Date.now() + timeMs;
    const wanted = this.options.samples;
    let samples = 0;
    while (wanted ? samples < wanted : samples < 3 || Date.now() < deadline) {
      const seed = Math.floor(this.random() * 2 ** 32);
      candidates.forEach((candidate, i) => {
        // The same guessed deal (and dice) for every candidate, so they're compared fairly
        const world = determinize(state, this.side, mulberry(seed), this.memory);
        values[i].push(playout(world, this.side, candidate.first, this.options.synergy ?? true, this.memory));
      });
      samples++;
      if (samples >= 200) break;
      if (this.options.earlyStop !== false && samples >= MIN_SAMPLES && settled(values)) break;
    }
    let best = 0;
    let bestGain = MIN_GAIN;
    for (let i = 1; i < candidates.length; i++) {
      const { mean, stderr } = gainOver(values, i);
      if (mean > bestGain && mean > MIN_Z * stderr) {
        best = i;
        bestGain = mean;
      }
    }
    return candidates[best];
  }
}

/**
 * How much candidate `i` beats the favourite (candidate 0) by on the same
 * deals: the mean difference, its standard error, and a generous upper
 * bound (mean + 2 standard errors) on what it could really be.
 */
function gainOver(values: number[][], i: number): { mean: number; stderr: number; upper: number } {
  const diffs = values[i].map((v, k) => v - values[0][k]);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / Math.max(1, diffs.length - 1);
  const stderr = Math.sqrt(variance / diffs.length);
  return { mean, stderr, upper: mean + 2 * stderr };
}

/**
 * True once more deals are unlikely to change the choice: either no
 * candidate could still beat the favourite by MIN_GAIN, or one already beats
 * it clearly and no other could catch up with it.
 */
function settled(values: number[][]): boolean {
  const gains = values.slice(1).map((_, i) => gainOver(values, i + 1));
  if (gains.every(g => g.upper < MIN_GAIN)) return true;
  const leader = gains.reduce((best, g) => (g.mean > best.mean ? g : best));
  const lower = leader.mean - 2 * leader.stderr;
  return lower > MIN_GAIN && gains.every(g => g === leader || g.upper < lower);
}
