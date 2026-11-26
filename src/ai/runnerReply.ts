import { CardInstance, GameState, RdKnownCard, cardDef, createRng, getCardDefinition, knownInRd, nextFloat, shuffleInPlace } from '../core';
import { certainInArchives, certainInHand, isAdvanceable } from '../core/engine/helpers';
import { knownToCorpInRd, rdSharesKnownToRunner, runnerRdMarksForCorp } from '../core/engine/rdKnowledge';
import type { RunnerMemory } from './runs';
import { HeuristicCorpAI } from './corpAI';
import { GameRunner } from './playout';
import { HeuristicRunnerAI } from './runnerAI';
import { pointValue, pointsTerm, sampledEndWorth } from './valueModel';
import { turnSeed } from './threatModel';
import { inReply, note, tally } from './diagnostics';
import { currentDecisionSeed, searchPiece } from './turnPlanner';
import { plan } from './pricing';
import { corpKnowsRd, corpSeenGrip, replySamples, setOraclePlayout } from './oracle';

// plan.oracle.safestRemote's play-out: the batch Runner (HeuristicRunnerAI, its planner on) against the rule-based Corp
setOraclePlayout(start => new GameRunner(start, { corp: new HeuristicCorpAI({ planner: false }), runner: new HeuristicRunnerAI({}) }));

/**
 * The Runner's reply (Jeff, 2026-10-28; plan.runnerReply): the Corp's
 * planner plays each candidate turn on through the Runner's next turn, with
 * the Runner AI standing in for the Runner, and scores the board it leaves.
 * Agenda safety and ice protection are then what the Runner's turn does to
 * them, not a guessed steal chance.
 *
 * No peeking: the Corp doesn't know the Runner's grip and stack, or the order
 * of its own R&D, so each sample redeals the Runner's grip from its unseen
 * cards (grip and stack shuffled together) and shuffles R&D, with a fresh
 * random seed for the rest of the turn.
 */
export const REPLY = {
  /** Runner turns played out per candidate. */
  samples: 2,
  /** Steps in one Runner turn (a safety net). */
  maxSteps: 300,
  /** plan.replyContenders: the samples the planner's two best candidates get on top of the first `samples`. */
  extra: 2,
  /**
   * plan.replyContenders: the extra samples are played only when the best two candidates are closer than this. At Jeff's
   * positions (human-agreement --noise, 2026-11-08) one candidate's two reply samples differ by a median 7.06 and the
   * best two candidates by a median 2.45: a gap under 4 is well inside one sample's noise, a wider one is left to the
   * first samples, which keeps the time per decision nearer the base.
   */
  contendGap: 4,
};

/** Which samples a reply plays: guessHidden deals `from` .. `from + count - 1`. */
export interface ReplyRange { from: number; count: number }

/** Whether the Corp planner's reply is this sampled Runner turn (corpAI.ts plan: plan.runnerReply). plan.replyContenders plays extra samples only then. */
export function sampledReply(): boolean {
  return !!plan().runnerReply;
}

/**
 * R&D positions whose card the Runner knows exactly (plan.keepKnownRd; Gemini's second audit, 2026-11-05): the Runner's
 * deal keeps them. Not the Corp's (7.1.2: corpKnownRdSlots); the Hard AI's determinize still reads this (registry debt).
 */
export function knownRdSlots(state: GameState): Set<number> {
  const slots = new Set<number>();
  // B4a 7(e): an exact mark not open to doubt (no `left`) is where its card is (the engine's invariant); no id is read
  for (const e of knownInRd(state)) if (e.lo === e.hi && !e.left) slots.add(e.lo);
  return slots;
}

/** R&D positions whose card the Corp knows (rdKnownToCorp; 4.2.3, 10.2.2b): kept by the Corp's deal only (red team corp-rd-memory finding 7). */
export function corpKnownRdSlots(state: GameState): Set<number> {
  const slots = new Set<number>();
  for (const e of knownToCorpInRd(state)) if (state.corp.rd[e.at]?.instanceId === e.id) slots.add(e.at);
  return slots;
}

/**
 * The Runner's memory of R&D as the Corp can know it on its deal `rd` (red team corp-rd-memory finding 1): the Corp does
 * not see what the Runner accesses (7.1.2) or arranges (8.3.3a) there, so an entry for a card the Corp doesn't know
 * names the first dealt card in its range no other entry took (dropped if none): it never points at a moved card. A
 * share a shuffle left (B4a 7(e), red team b4 finding 6) names a dealt card at a random free place, not the top one.
 */
function runnerRdMemoryOnDeal(state: GameState, rd: CardInstance[], fixed: Set<number>, random: () => number): GameState['corp']['rdKnownToRunner'] {
  const marks = runnerRdMarksForCorp(state);
  if (!marks.length) return [];
  const taken = new Set([...fixed]);
  const out: RdKnownCard[] = [];
  const name = (e: RdKnownCard, at: number) => {
    taken.add(at);
    out.push({ ...e, id: rd[at].instanceId, code: rd[at].cardCode });
  };
  for (const { mark: e, corpAt } of marks) {
    if (corpAt !== undefined && fixed.has(corpAt)) out.push(e);
    else if (e.n0) {
      const open = rd.map((_, i) => i).filter(i => !taken.has(i));
      if (open.length) name(e, open[Math.floor(random() * open.length)]);
    } else {
      let at = e.lo;
      while (at <= Math.min(e.hi, rd.length - 1) && taken.has(at)) at++;
      if (at <= Math.min(e.hi, rd.length - 1)) name(e, at);
    }
  }
  return out;
}

/** R&D shuffled except at `fixed` positions (`canonical`: the loose cards put in instance-id order first, plannerSeed). */
function shuffleRdKeeping<T extends { instanceId: string }>(rng: Parameters<typeof shuffleInPlace>[0], rd: T[], fixed: Set<number>, canonical = false): T[] {
  const rest = rd.filter((_, i) => !fixed.has(i));
  const loose = shuffleInPlace(rng, canonical ? byId(rest) : rest);
  return rd.map((c, i) => (fixed.has(i) ? c : loose.shift()!));
}

const byId = <T extends { instanceId: string }>(cards: T[]): T[] => [...cards].sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));

/** The deal's shuffler for sample `k` and the order the cards are dealt from (shared by both sides' guesses). */
function dealFor(state: GameState, k: number) {
  const common = searchPiece('plannerSeed');
  const rng = createRng(((common ? currentDecisionSeed() ?? turnSeed(state) : state.rng?.state ?? 1) ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0);
  const order = common ? byId : <T,>(cards: T[]) => cards;
  return { rng, order, common };
}

/**
 * `state` with the cards the Corp can't see dealt at random (sample `k`): the Corp's view.
 *
 * plan.plannerSearch plannerSeed (structural review item 4): the seed is the decision's (turnPlanner.ts
 * currentDecisionSeed: the game, turn and clicks left; outside a decision the threat's turnSeed), not the end state's rng, and the cards are dealt from a fixed order (by instance id). The
 * planner's candidates end in different rng states whenever one of them drew or shuffled, so each was compared on its
 * own deal as well as its own line; now all candidates of a decision see the same guessed grip, stack and R&D order. Nothing
 * new is read: the same cards are hidden, only which guess is drawn changes.
 */
export function guessHidden(state: GameState, k: number): GameState {
  const { rng, order, common } = dealFor(state, k);
  // plan.keepKnownHand (Gemini audit, 2026-11-01): grip cards the Corp has seen (MuslihaT, Mutual Favor) stay where they are
  const known = corpSeenGrip(state, 'reply'); // plan.oracle.grip: the whole grip
  const seen = state.runner.grip.filter(c => known.has(c.instanceId));
  const unseen = shuffleInPlace(rng, order([...state.runner.grip.filter(c => !known.has(c.instanceId)), ...state.runner.stack]));
  const grip = [...seen, ...unseen.slice(0, state.runner.grip.length - seen.length)];
  const stack = unseen.slice(state.runner.grip.length - seen.length);
  // plan.oracle.rd: the Corp knows its R&D order, so its guess keeps it; otherwise the places the Corp knows stay put
  if (corpKnowsRd()) return { ...state, rng: createRng(rng.state), runner: { ...state.runner, grip, stack }, corp: { ...state.corp, rd: [...state.corp.rd] } };
  const fixed = corpKnownRdSlots(state);
  const rd = shuffleRdKeeping(rng, [...state.corp.rd], fixed, common);
  const rdKnownToRunner = runnerRdMemoryOnDeal(state, rd, fixed, () => nextFloat(rng));
  return { ...state, rng: createRng(rng.state), runner: { ...state.runner, grip, stack }, corp: { ...state.corp, rd, rdKnownToRunner } };
}

/**
 * The Corp cards whose identity the Runner can't see, by the slot they fill (rule 10.2.2a): unrezzed ice it doesn't know
 * (B3 commit 0: an ice it saw rezzed stays known through a derez, runnerKnows; rule 1.12.5, "A card that is turned faceup
 * or facedown is still the same object"; the pool unrezzedDamageRisk reads already leaves it out); facedown root
 * cards it hasn't seen (accessed, `memory`; shown in place, runnerKnows; faceup); and the loose cards, HQ, R&D less the
 * places it knows exactly (knownRdSlots), and facedown Archives (what it knows of those is dealt back by code and count). One owner for "which Corp cards the Runner can't see": the deal below, the Hard AI's determinize
 * (search.ts) and the deciding Runner's prompt guard (runnerAI.ts promptAnswer) all read it.
 */
export function runnerUnknownSlots(state: GameState, memory?: RunnerMemory): { ice: CardInstance[]; root: CardInstance[]; loose: CardInstance[] } {
  const installed = Object.values(state.corp.servers);
  const ice = installed.flatMap(sv => sv.ice).filter(c => !c.isRezzed && !c.runnerKnows);
  // plan.keepKnownRd: faceup installed cards (BANGUN, Sacrifice Zone Expansion) are public, and so are the cards it has accessed
  const root = installed.flatMap(sv => sv.root).filter(c => !c.isRezzed && !memory?.has(c.instanceId) && !(c.faceUp || c.runnerKnows));
  // B4a 7(e): HQ and facedown Archives are loose whole; the cards the Runner surely knows there are dealt back by code
  // and count (dealRunnerUnknowns), not kept by instance (brief ruling 5)
  const fixedRd = knownRdSlots(state);
  const loose = [...state.corp.hq, ...state.corp.rd.filter((_, i) => !fixedRd.has(i)), ...state.corp.archives.faceDown];
  return { ice, root, loose };
}

/**
 * Re-deals, in place, every Corp card the Runner can't see (runnerUnknownSlots) at random from the cards it could be,
 * by giving the fixed instances other codes, so the board keeps its shape (instance ids, counters, runnerKnows): an
 * unrezzed ice gets an ice, a facedown root card an agenda, asset or upgrade (an advanced one an advanceable card), and
 * whatever is left goes back into HQ, R&D and Archives (sizes unchanged). `s` must be a copy whose slot cards may be
 * changed. `canonical` (plan.plannerSeed): the codes are dealt from a fixed order (sorted), so the deal depends only on
 * which cards are unseen, not on where they really are. The one owner of "the Runner's guess of the Corp's hidden cards"
 * (ai-honest-runner-view; red team 3): guessRunnerView and the Hard AI's determinize both call it.
 */
export function dealRunnerUnknowns(s: GameState, random: () => number, memory?: RunnerMemory, canonical = false): void {
  const { ice, root, loose } = runnerUnknownSlots(s, memory);
  const codes = [...ice, ...root, ...loose].map(c => c.cardCode);
  if (canonical) codes.sort();
  for (let i = codes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [codes[i], codes[j]] = [codes[j], codes[i]];
  }
  const take = (fits: (code: string) => boolean): string | undefined => {
    const i = codes.findIndex(fits);
    return i === -1 ? undefined : codes.splice(i, 1)[0];
  };
  const typeOf = (code: string) => getCardDefinition(code).type_code;
  const isRoot = (code: string) => ['agenda', 'asset', 'upgrade'].includes(typeOf(code));
  // Every slot's own code is in the pool, so each kind has at least as many codes as slots: an ice slot always finds an
  // ice, and a root slot a root card as long as the advanced slots (the constrained ones; advanced is public) are dealt
  // first and fall back to any root card (a card advanced by an effect need not be advanceable), not to their own code,
  // which an earlier slot may have taken (review R1)
  const dealt = (code: string | undefined): string => {
    if (code === undefined) throw new Error('dealRunnerUnknowns: a slot found no code (the pool lost a slot card)');
    return code;
  };
  // B4a 7(e): what the Runner surely knows of a hidden zone is dealt there first, by code and count, at least that many
  // copies (10.2.2b, 1.12.3): HQ and facedown Archives by the count rule, R&D by a mark not open to doubt (an interval
  // mark inside its places, a shuffle's share anywhere in R&D; exact places are not dealt)
  const kept = new Set<CardInstance>();
  const keep = (slots: CardInstance[], code: string) => {
    const open = slots.filter(c => !kept.has(c));
    const got = open.length ? take(c => c === code) : undefined;
    if (got === undefined) return;
    const card = open[Math.floor(random() * open.length)];
    card.cardCode = got;
    kept.add(card);
  };
  const looseOf = (zone: CardInstance[]) => loose.filter(c => zone.includes(c));
  for (const [zone, certain] of [[s.corp.hq, certainInHand(s, 'corp')], [s.corp.archives.faceDown, certainInArchives(s)]] as const) {
    const slots = looseOf(zone);
    for (const [code, n] of certain) for (let i = 0; i < n; i++) keep(slots, code);
  }
  const rdLoose = looseOf(s.corp.rd);
  for (const e of [...knownInRd(s), ...rdSharesKnownToRunner(s)]) {
    if (e.left || (e.lo === e.hi && !e.n0)) continue;
    keep(e.n0 ? rdLoose : rdLoose.filter(c => { const at = s.corp.rd.indexOf(c); return at >= e.lo && at <= e.hi; }), e.code);
  }
  for (const card of ice) card.cardCode = dealt(take(code => typeOf(code) === 'ice'));
  const advanced = root.filter(c => c.advancementCounters > 0);
  for (const card of advanced) card.cardCode = dealt(take(code => isRoot(code) && isAdvanceable({ cardCode: code } as CardInstance)) ?? take(isRoot));
  for (const card of root.filter(c => c.advancementCounters <= 0)) card.cardCode = dealt(take(isRoot));
  loose.filter(c => !kept.has(c)).forEach((card, i) => (card.cardCode = codes[i]));
}

/** A copy of `state` whose Corp cards outside the identity are new objects (so a deal can recode them in place). */
function withCorpCardCopies(state: GameState): GameState {
  const copy = <T extends object>(cards: T[]): T[] => cards.map(c => ({ ...c }));
  const corp = state.corp;
  const servers = Object.fromEntries(Object.entries(corp.servers).map(([id, sv]) => [id, { ...sv, ice: copy(sv.ice), root: copy(sv.root) }]));
  return { ...state, corp: { ...corp, hq: copy(corp.hq), rd: copy(corp.rd), archives: { ...corp.archives, faceDown: copy(corp.archives.faceDown) }, servers } };
}

/**
 * `state` as the Runner can know it (sample `k`): the Runner's view, for the deciding Runner's ranking and its planner's
 * playouts (plan.hiddenDraws, Jeff 2026-11-14: "AI runner should not see its own draws"; rule 10.2.2a). The Runner
 * knows its grip; the order of its stack is hidden information, so the stack is shuffled, and the shuffler is reseeded
 * so a later shuffle can't be foreseen either. The engine records no stack position the Runner knows (a card put on top
 * of the stack, damage.ts uninstallRunnerCard 'stackTop', is not remembered), so no position is kept.
 *
 * The Corp's hidden cards are re-dealt too (ai-honest-runner-view, valuation audit VAL-OPP-DECK-AVERAGE): every Corp
 * card the Runner can't see gets a guessed identity (dealRunnerUnknowns), so "a card from the Corp's deck" (cardRate,
 * the Corp formulas' card input, the R&D counters) and the facedown cards the playouts meet read a guess, not where
 * the unseen cards really are. `memory`: the cards the deciding Runner has accessed, which keep their identity.
 */
export function guessRunnerView(state: GameState, k: number, memory?: RunnerMemory): GameState {
  const { rng, order, common } = dealFor(state, k);
  const stack = shuffleInPlace(rng, order([...state.runner.stack]));
  const view = withCorpCardCopies(state);
  dealRunnerUnknowns(view, () => nextFloat(rng), memory, common);
  // The Corp's memory of R&D is not the Runner's to read (red team 2026-11-16 corp-rd-memory, finding 7; 4.2.2)
  return { ...view, rng: createRng(rng.state), runner: { ...state.runner, stack }, corp: { ...view.corp, rdKnownToCorp: undefined } };
}

/** Remotes with an agenda and no ice (the open-steal loss; the diagnostics count the reply turns that began with one, and how many ran it). */
const nakedAgendaRemotes = (s: GameState) =>
  Object.values(s.corp.servers)
    .filter(v => v.isRemote && v.ice.length === 0 && v.root.some(c => cardDef(c).type_code === 'agenda'))
    .map(v => v.id);

/**
 * Agendas left in an open remote that the sampled Runner happened not to
 * run (Jeff, 2026-10-29; plan.openSteal): counted as stolen anyway, a swing
 * of their points from the Corp's clock to the Runner's.
 */
function openAgendaLoss(state: GameState, ids: string[]): number {
  let loss = 0;
  for (const server of Object.values(state.corp.servers)) {
    for (const card of server.root) {
      if (!ids.includes(card.instanceId)) continue;
      const points = cardDef(card).agenda_points ?? 1;
      loss += pointValue(state.runner.score + points) - pointValue(state.runner.score) + pointValue(state.corp.score + points) - pointValue(state.corp.score);
    }
  }
  return loss;
}

/** Plays the Runner's next turn from the end of a Corp turn; the average of `leaf` over the samples (`range`: plan.replyContenders' extra ones). */
export function runnerReply(end: GameState, synergy: boolean, leaf: (state: GameState) => number, range: ReplyRange = { from: 0, count: replySamples(REPLY.samples) /* plan.oracle.think: more samples */ }): number {
  let total = 0;
  const values: number[] = [];
  let rootBoard: number | undefined; // the reply root's board, read once, only when a sample ends the game
  const undoReply = inReply();
  try {
    for (let k = range.from; k < range.from + range.count; k++) {
      const gr = new GameRunner(guessHidden(end, k), {
        corp: new HeuristicCorpAI({ synergy, planner: false }),
        runner: new HeuristicRunnerAI({ synergy, planner: false }),
      });
      let runnerTurn = false;
      const naked = nakedAgendaRemotes(gr.state);
      const nakedAgendas = naked.flatMap(id => gr.state.corp.servers[id].root.filter(c => cardDef(c).type_code === 'agenda').map(c => c.instanceId));
      const ran = new Set<string>();
      try {
        for (let i = 0; i < REPLY.maxSteps && !gr.state.winner; i++) {
          if (!gr.step()) break;
          const s = gr.state;
          if (s.activeRun) ran.add(s.activeRun.server);
          if (s.activePlayer === 'runner') runnerTurn = true;
          else if (runnerTurn && !s.activeRun) break;
        }
      } catch {
        // A reply that breaks the engine is scored where it stopped
      }
      tally('reply', 'nakedAgendaTurns', naked.length);
      tally('reply', 'nakedAgendaRuns', naked.filter(id => ran.has(id)).length);
      // (Jeff's bug report, 2026-10-31; plan.openStealUnrun) only agendas in remotes the Runner didn't run: one it ran and
      // was stopped from (The Red Room, LEO) survived the run it was counted stolen for
      const unrun = plan().openStealUnrun ? naked.filter(id => !ran.has(id)).flatMap(id => gr.state.corp.servers[id]?.root.map(c => c.instanceId) ?? []) : nakedAgendas;
      // Audit Step 1: a game end in this sample is one deal of hidden cards, a chance, not a certainty:
      // priced on the point clock from the reply root's board (valueModel sampledEndWorth, 1.7.2) instead of the leaf's ±1000
      const last = gr.state;
      const settle = !!last.winner;
      if (settle) rootBoard ??= leaf({ ...end, winner: null, winReason: null }) - pointsTerm(end);
      const value = settle
        ? sampledEndWorth(last.winner!, rootBoard!)
        : leaf(last) - (plan().openSteal ? openAgendaLoss(gr.state, nakedAgendas.filter(id => unrun.includes(id))) : 0);
      values.push(value);
      total += value;
    }
  } finally {
    undoReply();
  }
  note(d => d.onReplySamples?.(values));
  return total / range.count;
}
