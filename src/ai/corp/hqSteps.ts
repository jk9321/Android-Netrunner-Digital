import { GameAction, GameState, activePrompt, cardDef, findCardAnywhere } from '../../core';
import { simulate } from '../prompts';
import { freeInstallOrder } from './candidates';
import { freeOperationPick } from '../incomeLine';

/**
 * Q0a, the Corp's own HQ steps (Jeff 2026-11-22: "it activates Humanoid Resources but never carries out the steps").
 * A card's effect on the Corp's own turn, outside a run, that asks the Corp to pick a card from HQ and then installs it,
 * or plays an operation from HQ, spends no click (rules 1.16.6, 1.16.7: the install and play costs are still paid; 5.2.6:
 * only a Corp action costs a click). The fallback's one-step score cannot see either: a pick changes nothing until the
 * install step after it (every answer ties, and the decline is listed first), and the operation's play pays the hand's
 * half-keep (prompts.ts scoreOutcome; V-C item 2's debt), above what an econ operation nets. Both read an owner the
 * Corp already has instead:
 *   - an install pick and its server: the order's own install moves for the HQ cards (corp/candidates.ts
 *     freeInstallOrder, as Synapse Global's pick reads it), the first one the order does not put behind; none: today's
 *     answer.
 *   - an operation pick: Money step M1's net (incomeLine.ts freeOperationPick), the econ operation that nets the most
 *     credits; none: today's answer.
 * The deciding Corp only (ctx.counted): the planner's rollouts keep today's answers (V-C item 4's count: following the
 * chain inside the playouts is what cost the time and the near steals). The steps are read from the engine's typed
 * prompts (a pick whose answer opens an install step for that card, `source.data.install`), never from a card list.
 */
export function hqStepAnswer(state: GameState): GameAction | null {
  const prompt = activePrompt(state);
  if (!prompt || prompt.side !== 'corp' || state.activePlayer !== 'corp' || state.activeRun || state.winner) return null;
  if (!('source' in prompt)) return null;
  const base = { type: 'RESOLVE_PROMPT' as const, player: 'corp' as const, promptId: prompt.id };
  const inHQ = (id: string) => state.corp.hq.some(c => c.instanceId === id);

  if (prompt.kind === 'effect_cards' && prompt.min === 0 && prompt.max >= 1 && prompt.candidateIds.length > 0 && prompt.candidateIds.every(inHQ)) {
    // An install pick: some candidate's answer opens the install step for that card from the same source
    const opens = (id: string) => {
      const after = simulate(state, { ...base, choice: { kind: 'effect_cards', cardInstanceIds: [id] } });
      const next = after && activePrompt(after);
      return next?.kind === 'effect_choice' && 'source' in next && next.source.instanceId === prompt.source.instanceId && !!next.source.data?.install && String(next.source.data.cardId) === id
        ? next.options.map(o => o.id)
        : null;
    };
    const steps = prompt.candidateIds.map(id => ({ id, servers: opens(id) })).filter((x): x is { id: string; servers: string[] } => !!x.servers);
    if (steps.length > 0) {
      const servers = [...new Set(steps.flatMap(x => x.servers))];
      const pick = freeInstallOrder(state, servers).find(c => !c.behind && c.card && steps.some(x => x.id === c.card));
      return pick?.card ? { ...base, choice: { kind: 'effect_cards', cardInstanceIds: [pick.card] } } : null;
    }
    // An operation pick: every candidate an operation in HQ
    if (prompt.max === 1 && prompt.candidateIds.every(id => cardDef(findCardAnywhere(state, id)!).type_code === 'operation')) {
      const id = freeOperationPick(state, prompt.candidateIds.map(cardInstanceId => ({ cardInstanceId, action: { ...base, choice: { kind: 'effect_cards', cardInstanceIds: [cardInstanceId] } } })));
      return id ? { ...base, choice: { kind: 'effect_cards', cardInstanceIds: [id] } } : null;
    }
    return null;
  }

  // The install step of a card picked from HQ: the order's server for it
  if (prompt.kind === 'effect_choice' && prompt.source.data?.install) {
    const cardId = String(prompt.source.data.cardId);
    if (!inHQ(cardId)) return null;
    const options = prompt.options.map(o => o.id);
    const move = freeInstallOrder(state, options).find(c => !c.behind && c.card === cardId);
    const a = move?.action as (GameAction & { targetServerId?: string; asNewRemote?: boolean }) | undefined;
    if (!a) return null;
    const server = a.asNewRemote || !a.targetServerId ? 'new' : a.targetServerId;
    return options.includes(server) ? { ...base, choice: { kind: 'effect_choice', optionId: server } } : null;
  }
  return null;
}
