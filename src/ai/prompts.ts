import { CardInstance, GameAction, GameState, Prompt, SideCode, activePrompt, cardDef, executeAction, findCardAnywhere, getCardDefinition, getLegalActions, isLegalAction } from '../core';
import { runnerInstallBlocker } from '../core/engine/actions/install';
import { evaluate, keepValue } from './evaluate';
import { PACE, accessWorth, placedCounterWorth } from './effectValues';
import { turnsLeft } from './cardProfiles';
import { BOTULUS, MANEGARM, RunOptions, RunnerMemory, iceCost, isTrap, runClick, runScore, serverValue, spendCost, subroutineCost, tagCost, weakestIce } from './runs';
import { encounteredIce, iceSubroutines } from '../core/engine/ice';
import { keepBonus, tuning } from './synergy';
import { perfectRecallTarget } from './corpAI';

/** Applies an action, or returns null if the engine rejects it. */
export function simulate(state: GameState, action: GameAction): GameState | null {
  try {
    return executeAction(state, action);
  } catch {
    return null;
  }
}

const hand = (state: GameState, side: SideCode) => (side === 'corp' ? state.corp.hq : state.runner.grip);
/** How much a side wants to keep a card, plus (deck-aware AI) how well it fits the deck's plan. */
const keep = (state: GameState, card: CardInstance, synergy: boolean) => keepValue(state, card, synergy) + (synergy ? keepBonus(state, card) : 0);
/** The card was on top of R&D or the stack before (so it was drawn, not fetched by name). */
const fromDeck = (state: GameState, side: SideCode, card: CardInstance) =>
  (side === 'corp' ? state.corp.rd : state.runner.stack).some(c => c.instanceId === card.instanceId);
const sumKeep = (state: GameState, cards: CardInstance[], synergy: boolean) => cards.reduce((n, c) => n + keep(state, c, synergy), 0);

/**
 * Position value after an answer, from `side`'s point of view. Beyond the
 * board evaluation it counts which cards are in hand (so the AI discards
 * its least useful cards) and, for the Runner, the run still in progress.
 */
export function scoreOutcome(before: GameState, after: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): number {
  let score = evaluate(after, side, synergy);
  // Cards that came from the deck are unknown until drawn: only the cards that left the hand count (plan.blindDraws)
  const drawn = (c: CardInstance) => tuning.plan.blindDraws && !hand(before, side).some(b => b.instanceId === c.instanceId) && fromDeck(before, side, c);
  score += 0.5 * (sumKeep(after, hand(after, side).filter(c => !drawn(c)), synergy) - sumKeep(before, hand(before, side), synergy));
  if (side === 'runner' && before.activeRun) {
    const value = serverValue(before, before.activeRun.server, 0, memory, synergy && tuning.wary, synergy && tuning.plan.urgency) * 0.8;
    if (after.activeRun && !after.activeRun.isJackedOut) score += value;
  }
  return score;
}

function answers(state: GameState, side: SideCode, synergy = false): GameAction[] {
  const legal = getLegalActions(state, side).filter(a => a.type === 'RESOLVE_PROMPT').slice(0, 200);
  const iceTrash = synergy && tuning.plan.iceTrash;
  return [...legal, ...legal.flatMap(a => makeRoomAnswers(state, a)), ...(iceTrash ? iceTrashAnswers(state) : [])];
}

/**
 * A Corp effect installing ice (Mercia B4LL4RD, Ansel 1.0): also answer
 * each server by trashing its weakest rezzed ice first (rules 8.5.6b),
 * which can make a server affordable. The outcome decides.
 */
export function iceTrashAnswers(state: GameState): GameAction[] {
  const prompt = activePrompt(state);
  if (!prompt || prompt.side !== 'corp' || prompt.kind !== 'effect_choice' || !prompt.source.data?.install) return [];
  const card = findCardAnywhere(state, String(prompt.source.data.cardId));
  if (!card || cardDef(card).type_code !== 'ice') return [];
  return prompt.options.flatMap(o => {
    const weak = o.id === 'new' ? undefined : weakestIce(state, o.id);
    if (!weak) return [];
    const action: GameAction = { type: 'RESOLVE_PROMPT', player: 'corp', promptId: prompt.id, choice: { kind: 'effect_choice', optionId: o.id, trashFirst: [weak.instanceId] } };
    return isLegalAction(state, action) ? [action] : [];
  });
}

/**
 * A Runner effect installing a program that only fits once installed
 * programs are trashed (rules 8.5.6c): the same answer, trashing one
 * program (or two, if one isn't enough) first.
 */
export function makeRoomAnswers(state: GameState, action: GameAction): GameAction[] {
  if (action.type !== 'RESOLVE_PROMPT' || action.player !== 'runner') return [];
  const prompt = activePrompt(state);
  if (!prompt || (prompt.kind !== 'effect_cards' && prompt.kind !== 'effect_choice') || !prompt.source.data?.install) return [];
  const choice = action.choice;
  const cardId = choice.kind === 'effect_cards' ? choice.cardInstanceIds[0] : choice.kind === 'effect_choice' && choice.optionId === 'install' ? String(prompt.source.data.cardId) : undefined;
  const card = cardId ? findCardAnywhere(state, cardId) : undefined;
  if (!card || cardDef(card).type_code !== 'program' || !runnerInstallBlocker(state, card)) return [];
  const programs = state.runner.rig.programs.map(c => c.instanceId);
  const singles = programs.map(id => [id]);
  const pairs = programs.flatMap((a, i) => programs.slice(i + 1).map(b => [a, b]));
  for (const options of [singles, pairs]) {
    // Each answer that installs the program
    const installs = options
      .map(trashFirst => ({ ...action, choice: { ...choice, trashFirst } }) as GameAction)
      .filter(a => {
        const after = simulate(state, a);
        return !!after && after.runner.rig.programs.some(c => c.instanceId === card.instanceId);
      });
    if (installs.length > 0) return installs;
  }
  return [];
}

function mulligan(state: GameState, prompt: Prompt, synergy: boolean): boolean {
  const cards = hand(state, prompt.side);
  // (Jeff) a Corp hand needs ice it can rez early (on 5 credits, with a credit to spare), not just any ice
  if (prompt.side === 'corp') return !cards.some(c => cardDef(c).type_code === 'ice' && (!(synergy && tuning.plan.mulliganRez) || (cardDef(c).cost ?? 0) <= 4));
  const useful = cards.some(c => /icebreaker/i.test(cardDef(c).keywords ?? '') || /gain \d+|load \d+/i.test(cardDef(c).stripped_text ?? ''));
  return !useful;
}

/** The server option ids of a "run any server" choice, if this prompt is one. */
function serverOptions(state: GameState, prompt: Prompt): string[] | null {
  if (prompt.kind !== 'effect_choice') return null;
  const ids = prompt.options.map(o => o.id);
  return ids.length > 0 && ids.every(id => state.corp.servers[id]) ? ids : null;
}

/**
 * A bad publicity the Runner gives the Corp: a credit on each run for the rest of the game
 * (rules 10.6), or the Corp derezzing ice instead (Kompromat), whichever is cheaper for it.
 */
export function badPublicityWorth(state: GameState): number {
  return Math.min(3, 0.8 * PACE.runs * turnsLeft(state));
}

/** Run-event bonuses, by the code of the card that asks which server to run. */
export function runEventOptions(cardCode: string, state?: GameState): RunOptions {
  switch (cardCode) {
    case '36010': // Kompromat: a bad publicity (or a derezzed ice) on success
      return { successBonus: state ? badPublicityWorth(state) : 2 };
    case '36002': // Take a Dive: a bad publicity on success, if a subroutine resolved (about half the time)
      return { successBonus: 0.5 * (state ? badPublicityWorth(state) : 2) };
    case '30028': // Jailbreak
      return { extraAccesses: 1 };
    case '30029': // Overclock
      return { bonusCredits: 5 };
    case '30012': // Tread Lightly
      return { rezTax: true };
    case '35014': // Clean Getaway
      return { successBonus: 6 };
    case '35005': // Shred
      return { shred: true };
    case '36012': // Tailgate: 2 more HQ accesses
      return { extraAccesses: 2 };
    case '36018': // Aircheck: 4 credits of its own, the pool locked
      return { bonusCredits: 4, poolLocked: true };
    case '36015': // Baker
      return { baker: true };
    default:
      return {};
  }
}

/** Picks an answer to the active prompt, which belongs to `side`. */
export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {
  const prompt = activePrompt(state)!;
  const base = { type: 'RESOLVE_PROMPT' as const, player: side, promptId: prompt.id };

  if (prompt.kind === 'mulligan') {
    return { ...base, choice: { kind: 'mulligan', mulligan: mulligan(state, prompt, synergy) } };
  }
  // Breach order: the cards in the root first, then the central zone, without peeking at what comes up
  if (prompt.kind === 'access_order') {
    return { ...base, choice: { kind: 'access_order', optionId: prompt.options[0].id } };
  }
  if (prompt.kind === 'discard') {
    const cards = [...hand(state, side)].sort((a, b) => keep(state, a, synergy) - keep(state, b, synergy));
    return { ...base, choice: { kind: 'discard', cardInstanceIds: cards.slice(0, prompt.count).map(c => c.instanceId) } };
  }

  const servers = side === 'runner' ? serverOptions(state, prompt) : null;
  if (servers && prompt.kind === 'effect_choice') {
    const scored = servers.map(id => ({ id, score: runScore(state, id, { ...runEventOptions(prompt.source.cardCode, state), memory, wary: synergy && tuning.wary, urgent: synergy && tuning.plan.urgency }) }));
    scored.sort((a, b) => b.score - a.score);
    return { ...base, choice: { kind: 'effect_choice', optionId: scored[0].id } };
  }

  // Manegarm Skunkworks: pay the cheaper way in if the access is worth it, on the scale runScore planned the run with
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === MANEGARM && state.activeRun) {
    const value = serverValue(state, state.activeRun.server, 0, memory, synergy && tuning.wary, synergy && tuning.plan.urgency);
    const cost: Record<string, number> = { clicks: 2 * runClick(state), pay: spendCost(state, 5) };
    const ways = prompt.options.filter(o => o.id in cost && cost[o.id] < value).sort((a, b) => cost[a.id] - cost[b.id]);
    return { ...base, choice: { kind: 'effect_choice', optionId: ways[0]?.id ?? 'end' } };
  }

  // Baker: turn the run on Archives to whichever of HQ and R&D is worth more, if either beats Archives by the credit
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '36015' && prompt.source.step === 'redirect') {
    const value = (id: string) => serverValue(state, id, 0, memory, synergy && tuning.wary, synergy && tuning.plan.urgency) - (id === 'archives' ? 0 : spendCost(state, 1));
    const best = ['hq', 'rd'].sort((a, b) => value(b) - value(a))[0];
    return { ...base, choice: { kind: 'effect_choice', optionId: value(best) > value('archives') ? best : 'no' } };
  }

  // Méliès U: the secret side is the central the Runner is likeliest to run first (its share of runs), varied by turn so it can't be read
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '36036' && prompt.source.step === 'set') {
    return { ...base, choice: { kind: 'effect_choice', optionId: meliesSide(state) } };
  }

  // Caveat Emptor: the board score doesn't see next turn's clicks, so weigh them here: the 4 extra
  // credits are worth a 2-click swing to the Runner only when the Corp is nearly broke
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '36032' && prompt.source.step === 'mode') {
    return { ...base, choice: { kind: 'effect_choice', optionId: state.corp.credits < 4 ? 'ten' : 'six' } };
  }

  // Rotary: the board score doesn't see the extra access the tag buys, so weigh it here: take the
  // tag when one more random access is worth more than what the tag costs (cheap for Vic)
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '36014' && prompt.source.step === 'breach') {
    return { ...base, choice: { kind: 'effect_choice', optionId: accessWorth(state) > tagCost(state) ? 'tag' : 'no' } };
  }

  // Perfect Recall: reveal the agenda the Runner is after
  if (side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === '36035' && prompt.source.step === 'reveal') {
    const pick = perfectRecallTarget(state) ?? prompt.candidateIds[0];
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: [pick] } };
  }

  // Botulus: break the worst subroutine
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === BOTULUS && tuning.plan.trojans) {
    const ice = encounteredIce(state);
    const subs = ice ? (iceSubroutines(state, ice)) : [];
    const worst = [...prompt.options].sort((a, b) => subroutineCost(state, subs[Number(b.id)]?.label ?? '') - subroutineCost(state, subs[Number(a.id)]?.label ?? ''))[0];
    return { ...base, choice: { kind: 'effect_choice', optionId: worst.id } };
  }

  // IP Enforcement: simulating stops before the agenda leaves the score area, so the try-each
  // search only sees the tags it costs. Take back the most points, then the quickest to re-score.
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '35066' && prompt.source.step === 'agenda') {
    const worth = (id: string) => {
      const def = cardDef(state.runner.scoreArea.find(a => a.instanceId === id)!);
      return (def.agenda_points ?? 0) * 10 - (def.advancement_cost ?? 0);
    };
    const best = [...prompt.options].sort((a, b) => worth(b.id) - worth(a.id))[0];
    return { ...base, choice: { kind: 'effect_choice', optionId: best.id } };
  }

  // AU Co.: the power counters do nothing else, so 2 cards now beat 2 cards later. (Scored as an outcome
  // the cards drawn count for nothing: plan.blindDraws hides cards from R&D.)
  if (side === 'corp' && tuning.plan.promptChains && prompt.kind === 'effect_choice' && prompt.source.cardCode === '35046' && prompt.source.step === 'use') {
    return { ...base, choice: { kind: 'effect_choice', optionId: 'use' } };
  }

  // Zahya Sadeghi (Jeff): a 1-credit gain waits while 2 clicks are left for another HQ or R&D run
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '30010' && prompt.source.step === 'gain') {
    const wait = Number(prompt.source.data?.credits ?? 0) < 2 && state.runner.clicks >= 2;
    return { ...base, choice: { kind: 'effect_choice', optionId: wait ? 'no' : 'gain' } };
  }

  // Deck-aware AI: PT Untaian's paid advancement goes where it does the most
  if (synergy && side === 'corp' && tuning.plan.identities && prompt.kind === 'effect_cards' && prompt.source.cardCode === '35047') {
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: untaianPick(state, prompt.candidateIds) } };
  }

  // Deck-aware AI: Tāo Salonga moves the hardest ice off the servers worth attacking
  if (synergy && side === 'runner' && tuning.plan.runnerIdentities && prompt.kind === 'effect_cards' && prompt.source.cardCode === '30019') {
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: taoSwap(state, memory) } };
  }

  // "Any number of cards": build the answer one card at a time
  if (prompt.kind === 'effect_cards' && prompt.max - prompt.min > 2 && prompt.candidateIds.length > 4) {
    return greedyCards(state, side, prompt, base, memory, synergy);
  }

  // Everything else: try each answer and keep the best outcome.
  const options = answers(state, side, synergy);
  let best: GameAction = options[0];
  let bestScore = -Infinity;
  for (const action of options) {
    const after = simulate(state, action);
    if (!after) continue;
    const score = scoreOutcome(state, followChain(prompt, after, side, memory, synergy), side, memory, synergy);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

/**
 * Méliès U's secret side, picked in proportion to the share of runs each
 * central gets in self-play (PACE), from a hash of the game and turn: a
 * fixed pick would let a human read it.
 */
export function meliesSide(state: GameState): 'hq' | 'rd' | 'archives' {
  const shares: ['hq' | 'rd' | 'archives', number][] = [['hq', PACE.hqShare], ['rd', PACE.rdShare], ['archives', PACE.archivesShare]];
  const total = shares.reduce((n, [, w]) => n + w, 0);
  let h = 2166136261;
  for (const ch of `${state.id}:${state.turnNumber}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let roll = ((h >>> 0) % 10000) / 10000 * total;
  for (const [id, w] of shares) {
    if (roll < w) return id;
    roll -= w;
  }
  return 'hq';
}

/**
 * PT Untaian: 1 credit for an advancement counter on an unrezzed card. An
 * agenda behind ice gets closer to scoring, a trap hits harder (Urtica
 * Cipher) or reads as an agenda; nothing worth it, or no spare credit: skip.
 */
export function untaianPick(state: GameState, candidateIds: string[]): string[] {
  if (state.corp.credits < 2) return [];
  let best: { id: string; value: number } | null = null;
  for (const server of Object.values(state.corp.servers)) {
    for (const card of [...server.root, ...server.ice]) {
      if (!candidateIds.includes(card.instanceId)) continue;
      const def = cardDef(card);
      let value = 0.3;
      if (tuning.plan.modelHacks?.bonuses && (def.type_code !== 'ice' || card.cardCode === '30063' || card.cardCode === '35076')) {
        // Model: what the counter adds on this card
        value = def.type_code === 'ice' ? 0.5 : placedCounterWorth(state, card, server.ice.length > 0);
        if (!best || value > best.value) best = { id: card.instanceId, value };
        continue;
      }
      if (def.type_code === 'agenda') value = server.ice.length > 0 ? 3 + (card.advancementCounters > 0 ? 0.5 : 0) : 0.8;
      else if (card.cardCode === '30045') value = 2.5; // Urtica Cipher: 1 more net damage
      else if (isTrap(card.cardCode)) value = 1.5;
      else if (def.type_code === 'asset') value = 1.2; // Clearinghouse and the like
      if (!best || value > best.value) best = { id: card.instanceId, value };
    }
  }
  return best && best.value >= 1 ? [best.id] : [];
}

/**
 * Tāo Salonga: the swap of 2 installed ice that most lowers what the
 * Runner pays to get into servers, weighted by what each server is worth
 * running (the same values its run choices use: an agenda remote, then HQ
 * and R&D). None if no swap saves at least about a credit on a key server.
 */
export function taoSwap(state: GameState, memory?: RunnerMemory): string[] {
  const servers = Object.values(state.corp.servers).filter(s => s.ice.length > 0);
  const weight = new Map(servers.map(s => [s.id, Math.max(0.3, serverValue(state, s.id, 0, memory, tuning.wary, tuning.plan.urgency))]));
  const cost = (ice: CardInstance) => Math.min(8, iceCost(state, ice));
  const placed = servers.flatMap(s => s.ice.map(ice => ({ ice, server: s.id })));
  let best: { ids: string[]; gain: number } | null = null;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.server === b.server) continue; // reordering one server rarely matters
      const delta = cost(a.ice) - cost(b.ice); // a moves to b's server and back
      const gain = delta * (weight.get(a.server)! - weight.get(b.server)!);
      if (!best || gain > best.gain) best = { ids: [a.ice.instanceId, b.ice.instanceId], gain };
    }
  }
  return best && best.gain >= 2 ? best.ids : [];
}

/**
 * An answer that opens the same card's next choice (AU Co.: which card to trash; Poétrï and
 * Synapse Global: which server) is judged after the AI answers that too, so the first step of a
 * good ability doesn't look like a loss on its own (plan.promptChains).
 */
function followChain(prompt: Prompt, after: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameState {
  // Identities only: following every card's chain made AI games about 4x slower
  if (!tuning.plan.promptChains || !('source' in prompt) || getCardDefinition(prompt.source.cardCode).type_code !== 'identity') return after;
  let state = after;
  for (let depth = 0; depth < 3; depth++) {
    const next = activePrompt(state);
    if (!next || next.side !== side || !('source' in next) || next.source.instanceId !== prompt.source.instanceId) break;
    const resolved = simulate(state, answerPrompt(state, side, memory, synergy));
    if (!resolved) break;
    state = resolved;
  }
  return state;
}

/** Adds the card that helps most until no card helps (and at least `min` are chosen). */
function greedyCards(
  state: GameState,
  side: SideCode,
  prompt: Extract<Prompt, { kind: 'effect_cards' }>,
  base: { type: 'RESOLVE_PROMPT'; player: SideCode; promptId: string },
  memory?: RunnerMemory,
  synergy = false
): GameAction {
  const answer = (ids: string[]): GameAction => ({ ...base, choice: { kind: 'effect_cards', cardInstanceIds: ids } });
  const value = (ids: string[]) => {
    const after = simulate(state, answer(ids));
    return after ? scoreOutcome(state, followChain(prompt, after, side, memory, synergy), side, memory, synergy) : -Infinity;
  };
  let chosen: string[] = [];
  let current = prompt.min === 0 ? value([]) : -Infinity;
  while (chosen.length < prompt.max) {
    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const id of prompt.candidateIds) {
      if (chosen.includes(id)) continue;
      const score = value([...chosen, id]);
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    if (!bestId || (chosen.length >= prompt.min && bestScore <= current)) break;
    chosen = [...chosen, bestId];
    current = bestScore;
  }
  return answer(chosen);
}
