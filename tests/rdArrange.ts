import { GameState, createCardInstance, executeAction, getCardScript } from '../src/core';

const SEEKER = '36040'; // Knowledge Seeker: "Look at the top 4 cards of R&D and arrange them in any order."

/**
 * The Corp arranges the top 4 of R&D in secret through the engine (Knowledge Seeker's subroutine, then its three
 * arrange prompts answered as actions; 8.3.3), putting them in reverse order. Returns the new state and the order.
 */
export function corpArrangesTop4(s0: GameState): [GameState, string[]] {
  const s = structuredClone(s0);
  const seeker = createCardInstance(s, SEEKER);
  seeker.isRezzed = true;
  s.corp.servers.hq.ice.push(seeker);
  const top4 = s.corp.rd.slice(0, 4).map(c => c.instanceId);
  getCardScript(SEEKER)!.ice!.subroutines[1].resolve({ state: s, card: seeker, side: 'corp' });
  let t = s;
  for (const id of [top4[3], top4[2], top4[1]]) {
    const p = t.pendingPrompts[0];
    t = executeAction(t, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_cards', cardInstanceIds: [id] } });
  }
  return [t, [top4[3], top4[2], top4[1], top4[0]]];
}
