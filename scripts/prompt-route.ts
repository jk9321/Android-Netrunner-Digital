/**
 * ai-prompt-time measurement: the Corp prompts that take the greedyCards route once its test is
 * `prompt.max - prompt.min >= 2` (was `> 2`): card prompts with exactly two more cards allowed than required and more than
 * four candidates. At every recorded Corp decision with such a prompt open (the local deals and the human games), one line
 * of JSON: where, the prompt (card code, step, min, max, candidates), the answer and the time. Run it on the base and on
 * the branch and compare with scripts/prompt-route-sum.mjs (answers matched by place and prompt; a deal stops matching
 * once a different answer changes the game).
 *   SHARD=0/2 npx vite-node scripts/prompt-route.ts > base-0.jsonl
 */
import { GameAction, activePrompt } from '../src/core';
import { forEachRecorded } from './stage-a/harness';

forEachRecorded({
  decision: d => {
    const p = activePrompt(d.state);
    if (d.kind !== 'action' || !p || p.side !== 'corp' || p.kind !== 'effect_cards') return;
    if (p.max - p.min !== 2 || p.candidateIds.length <= 4) return;
    const a = d.action as (GameAction & { choice?: { cardInstanceIds?: string[] } }) | null;
    const key = `${d.src}|${d.i}|T${d.state.turnNumber}|${p.source.cardCode}:${p.source.step}|${[...p.candidateIds].sort().join(',')}`;
    console.log(JSON.stringify({ key, src: d.src, code: p.source.cardCode, step: p.source.step, min: p.min, max: p.max, n: p.candidateIds.length, answer: [...(a?.choice?.cardInstanceIds ?? [])].sort(), ms: Math.round(d.ms) }));
  },
});
