/**
 * Stage D item 6 step 1 (design-answer.md section 2.3, the narrower candidate): at the two D3 pins, the fallback's score
 * (scoreOutcome) of decline against each pick with its server question answered, beside the plain board value
 * (evaluate). The gap between the two is the fallback's hand term: 0.5 x keep of each card that leaves HQ.
 *   npx vite-node scripts/stage-d/prompt-place-chain-scores.ts
 */
import { readFileSync } from 'node:fs';
import type { GameAction, GameState } from '../../src/core';
import { activePrompt, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import '../../src/ai';
import { scoreOutcome, simulate } from '../../src/ai/prompts';
import { asSide } from '../../src/ai/pricing';
import { evaluate } from '../../src/ai/evaluate';

type AnyPrompt = { id: string; candidateIds?: string[]; options?: { id: string }[] };
const R = (p: AnyPrompt, choice: object) => ({ type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice }) as GameAction;
for (const [n, mv] of [[49, 219], [50, 252]] as const) {
  const r = JSON.parse(readFileSync(`tests/fixtures/human-games/report-${n}.json`, 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of (r.moves as GameAction[]).slice(0, mv)) s = executeAction(s, m);
  const p = activePrompt(s) as unknown as AnyPrompt;
  const dec = simulate(s, R(p, { kind: 'effect_cards', cardInstanceIds: [] }))!;
  const f = (x: number) => x.toFixed(3);
  console.log(`#${n} decline: score ${f(asSide('corp', () => scoreOutcome(s, dec, 'corp', undefined, true)))}, board ${f(asSide('corp', () => evaluate(dec, 'corp')))}`);
  for (const id of p.candidateIds ?? []) {
    const a1 = simulate(s, R(p, { kind: 'effect_cards', cardInstanceIds: [id] }));
    const p2 = a1 && (activePrompt(a1) as unknown as AnyPrompt | undefined);
    for (const o of p2?.options ?? []) {
      const a2 = simulate(a1!, R(p2!, { kind: 'effect_choice', optionId: o.id }));
      if (!a2) continue;
      const sc = asSide('corp', () => scoreOutcome(s, a2, 'corp', undefined, true));
      const ev = asSide('corp', () => evaluate(a2, 'corp'));
      console.log(`#${n} ${cardDef(findCardAnywhere(s, id)!).title} -> ${o.id}: score ${f(sc)}, board ${f(ev)}, hand term ${f(sc - ev)}`);
    }
  }
}
