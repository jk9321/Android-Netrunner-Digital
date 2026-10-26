import { CardInstance, GameAction, GameState, Prompt, SideCode, activePrompt, cardDef, executeAction, getLegalActions } from '../core';
import { evaluate, keepValue } from './evaluate';
import { RunOptions, RunnerMemory, iceCost, isTrap, runScore, serverValue } from './runs';
import { keepBonus, tuning } from './synergy';

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

function answers(state: GameState, side: SideCode): GameAction[] {
  return getLegalActions(state, side).filter(a => a.type === 'RESOLVE_PROMPT').slice(0, 200);
}

function mulligan(state: GameState, prompt: Prompt): boolean {
  const cards = hand(state, prompt.side);
  if (prompt.side === 'corp') return !cards.some(c => cardDef(c).type_code === 'ice');
  const useful = cards.some(c => /icebreaker/i.test(cardDef(c).keywords ?? '') || /gain \d+|load \d+/i.test(cardDef(c).stripped_text ?? ''));
  return !useful;
}

/** The server option ids of a "run any server" choice, if this prompt is one. */
function serverOptions(state: GameState, prompt: Prompt): string[] | null {
  if (prompt.kind !== 'effect_choice') return null;
  const ids = prompt.options.map(o => o.id);
  return ids.length > 0 && ids.every(id => state.corp.servers[id]) ? ids : null;
}

/** Run-event bonuses, by the code of the card that asks which server to run. */
export function runEventOptions(cardCode: string): RunOptions {
  switch (cardCode) {
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
    default:
      return {};
  }
}

/** Picks an answer to the active prompt, which belongs to `side`. */
export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {
  const prompt = activePrompt(state)!;
  const base = { type: 'RESOLVE_PROMPT' as const, player: side, promptId: prompt.id };

  if (prompt.kind === 'mulligan') {
    return { ...base, choice: { kind: 'mulligan', mulligan: mulligan(state, prompt) } };
  }
  if (prompt.kind === 'discard') {
    const cards = [...hand(state, side)].sort((a, b) => keep(state, a, synergy) - keep(state, b, synergy));
    return { ...base, choice: { kind: 'discard', cardInstanceIds: cards.slice(0, prompt.count).map(c => c.instanceId) } };
  }

  const servers = side === 'runner' ? serverOptions(state, prompt) : null;
  if (servers && prompt.kind === 'effect_choice') {
    const scored = servers.map(id => ({ id, score: runScore(state, id, { ...runEventOptions(prompt.source.cardCode), memory, wary: synergy && tuning.wary, urgent: synergy && tuning.plan.urgency }) }));
    scored.sort((a, b) => b.score - a.score);
    return { ...base, choice: { kind: 'effect_choice', optionId: scored[0].id } };
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
  const options = answers(state, side);
  let best: GameAction = options[0];
  let bestScore = -Infinity;
  for (const action of options) {
    const after = simulate(state, action);
    if (!after) continue;
    const score = scoreOutcome(state, after, side, memory, synergy);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
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
    return after ? scoreOutcome(state, after, side, memory, synergy) : -Infinity;
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
