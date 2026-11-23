import { GameAction, GameState, activePrompt, cardDef, findCardAnywhere } from '../../core';
import { ownCorpReader, simulate } from '../prompts';
import { TurnFlag, turnFlag } from '../../core/engine/cardEffects';
import { freeInstallOrder } from './candidates';
import { HeldLine } from './lines';
import { freeOperationPick } from '../incomeLine';

/** Q0a's own install pick, valid for the deciding Corp's next decision only: the prompt's source and the card picked. */
export interface HqPick {
  source: string;
  card: string;
}

/**
 * Q0a, the Corp's own HQ steps (Jeff 2026-11-22: "it activates Humanoid Resources but never carries out the steps").
 * A card's effect on the Corp's own turn, outside a run, that asks the Corp to pick a card from HQ and then installs it,
 * or plays an operation from HQ, spends no click (rules 1.16.6, 1.16.7: the install and play costs are still paid; 5.2.6:
 * only a Corp action costs a click). The fallback's one-step score cannot see either: a pick changes nothing until the
 * install step after it (every answer ties, and the decline is listed first), and the operation's play pays the hand's
 * half-keep (prompts.ts scoreOutcome; V-C item 2's debt), above what an econ operation nets. Both read an owner the
 * Corp already has instead:
 *   - an install pick and its server: the order's own install moves for the HQ cards (corp/candidates.ts
 *     freeInstallOrder with the step's `held` line: the install cost is what the prompt charges, and inside the main
 *     phase the held line is read as the main phase reads it; spec-ruling.md 7 R1 R2), the first one the order does not
 *     put behind; none: today's answer. The server step is answered only after Q0a's own pick of that card from the
 *     same source (`last`), and only when every option is an install (R5).
 *   - an operation pick: Money step M1's net (incomeLine.ts freeOperationPick), the econ operation that nets the most
 *     credits; none: today's answer.
 * Left to today's answers: a prompt with a reader of its own in prompts.ts (ownCorpReader: Synapse Global, Warm
 * Reception, Janaína; R4), a pick that may also play an operation (Pivot), and an install whose answer, on the engine's
 * own board after it, moves the prompt's source card (Mercia B4LL4RD, R3: the order does not price the root card that
 * travels with the ice; registry debt) or rezzes the card too (Eminent Domain: the order prices the install only).
 * The deciding Corp only (ctx.counted): the planner's rollouts keep today's answers (V-C item 4's count: following the
 * chain inside the playouts is what cost the time and the near steals). The steps are read from the engine's typed
 * prompts (a pick whose answer opens an install step for that card, `source.data.install`), never from a card list.
 */
export function hqStepAnswer(state: GameState, held: HeldLine | null, last: HqPick | null): { action: GameAction; pick: HqPick | null } | null {
  const prompt = activePrompt(state);
  if (!prompt || prompt.side !== 'corp' || state.activePlayer !== 'corp' || state.activeRun || state.winner) return null;
  if (!('source' in prompt) || ownCorpReader(prompt)) return null;
  const base = { type: 'RESOLVE_PROMPT' as const, player: 'corp' as const, promptId: prompt.id };
  const source = prompt.source.instanceId;
  const inHQ = (id: string) => state.corp.hq.some(c => c.instanceId === id);
  const step = { held: held ? structuredClone(held) : null };

  if (prompt.kind === 'effect_cards' && prompt.min === 0 && prompt.max >= 1 && prompt.candidateIds.length > 0 && prompt.candidateIds.every(inHQ)) {
    const pick = (id: string): GameAction => ({ ...base, choice: { kind: 'effect_cards', cardInstanceIds: [id] } });
    // An install pick: some candidate's answer opens the install step for that card from the same source
    const opens = (id: string) => {
      const after = simulate(state, pick(id));
      return after ? installStep(after, source, id) : null;
    };
    const isOp = (id: string) => cardDef(findCardAnywhere(state, id)!).type_code === 'operation';
    // A pick that may also play an operation (Pivot: "play or install 1 card from HQ") is left to the fallback
    const steps = prompt.candidateIds.some(isOp) ? [] : prompt.candidateIds.map(id => ({ id, servers: opens(id) })).filter((x): x is { id: string; servers: string[] } => !!x.servers);
    if (steps.length > 0) {
      const servers = [...new Set(steps.flatMap(x => x.servers))];
      const move = freeInstallOrder(state, servers, step).find(c => !c.behind && c.card && steps.some(x => x.id === c.card));
      if (!move?.card) return null;
      const after = simulate(state, pick(move.card));
      if (!after || !plainInstall(after, source, move.card, serverOf(move.action))) return null;
      return { action: pick(move.card), pick: { source, card: move.card } };
    }
    // An operation pick: every candidate an operation in HQ, and only the answers the engine counts as a play (its
    // operations-played turn flag; a pick that trashes or reveals the card is never one)
    if (prompt.max === 1 && prompt.candidateIds.every(isOp)) {
      const plays = (id: string) => {
        const after = simulate(state, pick(id));
        return !!after && turnFlag(after, TurnFlag.operationsPlayed) > turnFlag(state, TurnFlag.operationsPlayed);
      };
      const id = freeOperationPick(state, prompt.candidateIds.filter(plays).map(cardInstanceId => ({ cardInstanceId, action: pick(cardInstanceId) })));
      return id ? { action: pick(id), pick: null } : null;
    }
    return null;
  }

  // The install step of a card Q0a picked from HQ at the decision before: the order's server for it
  if (prompt.kind === 'effect_choice' && prompt.source.data?.install) {
    const cardId = String(prompt.source.data.cardId);
    if (last?.source !== source || last.card !== cardId || !inHQ(cardId)) return null;
    const options = installStep(state, source, cardId);
    if (!options) return null;
    const move = freeInstallOrder(state, options, step).find(c => !c.behind && c.card === cardId);
    const server = move ? serverOf(move.action) : null;
    if (!server || !options.includes(server) || !plainInstall(state, source, cardId, server)) return null;
    return { action: { ...base, choice: { kind: 'effect_choice', optionId: server } }, pick: null };
  }
  return null;
}

/** A prompt option id for an install move: 'new' or the server's id. */
const serverOf = (a: GameAction): string | null => {
  if (a.type !== 'INSTALL_CARD') return null;
  const i = a as GameAction & { targetServerId?: string; asNewRemote?: boolean };
  return i.asNewRemote || !i.targetServerId ? 'new' : i.targetServerId;
};

/** The open prompt's options when it is the install step of `cardId` from `source` and every option is an install (a server or a new remote); else null. */
function installStep(state: GameState, source: string, cardId: string): string[] | null {
  const p = activePrompt(state);
  if (p?.kind !== 'effect_choice' || p.source.instanceId !== source || !p.source.data?.install || String(p.source.data.cardId) !== cardId) return null;
  const ids = p.options.map(o => o.id);
  return ids.length > 0 && ids.every(id => id === 'new' || id in state.corp.servers) ? ids : null;
}

/** Where an installed card sits (its server), or null when it is not installed. */
const installedAt = (s: GameState, id: string) => Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id))?.id ?? null;

/**
 * The install step answered at `server` (state at that step) installs the card and nothing more that the order does not
 * price, on the engine's own board after it: the prompt's source card stays where it was (R3) and the card is not rezzed
 * with it (Eminent Domain's install and rez).
 */
function plainInstall(state: GameState, source: string, cardId: string, server: string | null): boolean {
  const p = activePrompt(state);
  if (!server || p?.kind !== 'effect_choice') return false;
  const after = simulate(state, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId: server } });
  if (!after) return false;
  const card = Object.values(after.corp.servers).flatMap(v => [...v.root, ...v.ice]).find(c => c.instanceId === cardId);
  return installedAt(after, source) === installedAt(state, source) && !!card && !card.isRezzed;
}
