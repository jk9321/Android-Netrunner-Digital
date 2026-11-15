/**
 * ai-prompt-time evidence (AI Coordinator 2026-11-15 14:50Z and 15:20Z), one pass over every recorded Corp decision (the
 * local deals and the human games, scripts/stage-a/harness.ts):
 *  - kind "case": every Corp card prompt whose route this branch changes: the "shuffle Archives into R&D" family
 *    (shufflesArchivesIntoRD) and card prompts with exactly two more cards allowed than required and more than four
 *    candidates (now greedyCards). Each line has the candidates with their keep (keepValue + keepBonus, as prompts.ts
 *    prices a card), the answer played, the answer the route of beta would give (every answer tried, or greedyCards for
 *    more than two beyond the minimum, re-built here from the exported simulate/scoreOutcome/freeRezSaving; followChain
 *    is left out, it only follows identities' chains), and both times. Run on the base as well, "played" is beta's
 *    answer, so the old-route column checks the rebuild.
 *  - kind "fire": every Corp decision that uses Spin Doctor's ability (30053), with Archives' size and agendas.
 *  - kind "deal": per source, the Corp's decisions and total decision time.
 *   SHARD=0/64 npx vite-node scripts/prompt-time-cases.ts      (summed by scripts/prompt-time-sum.mjs)
 */
import { CardInstance, GameAction, GameState, Prompt, activePrompt, cardDef, findCardAnywhere, getLegalActions } from '../src/core';
import { keepValue } from '../src/ai/evaluate';
import { keepBonus } from '../src/ai/synergy';
import { freeRezSaving, scoreOutcome, simulate } from '../src/ai/prompts';
import * as prompts from '../src/ai/prompts';
import { clearCaches, forEachRecorded } from './stage-a/harness';

type CardsPrompt = Extract<Prompt, { kind: 'effect_cards' }>;
const archived = (s: GameState) => [...s.corp.archives.faceUp, ...s.corp.archives.faceDown];
/** On the base the family test does not exist: the same test, written out (prompts.ts shufflesArchivesIntoRD). */
const isFamily = (s: GameState, p: CardsPrompt) => {
  const own = (prompts as { shufflesArchivesIntoRD?: (s: GameState, p: CardsPrompt) => boolean }).shufflesArchivesIntoRD;
  if (own) return own(s, p);
  const ids = new Set(archived(s).map(c => c.instanceId));
  return p.side === 'corp' && p.source.step === 'shuffle' && p.candidateIds.length > 0 && p.candidateIds.every(id => ids.has(id));
};
const ids = (a: GameAction | null | undefined) => [...(((a as { choice?: { cardInstanceIds?: string[] } } | null)?.choice?.cardInstanceIds) ?? [])];
const sorted = (x: string[]) => [...x].sort();

/** Beta's route for this prompt: greedyCards past two beyond the minimum with more than four candidates, else try every answer. */
function oldAnswer(state: GameState, p: CardsPrompt): { route: string; answer: string[]; ms: number } {
  const t = performance.now();
  const base = { type: 'RESOLVE_PROMPT' as const, player: 'corp' as const, promptId: p.id };
  const score = (a: GameAction) => {
    const after = simulate(state, a);
    return after ? scoreOutcome(state, after, 'corp', undefined, true) + freeRezSaving(state, after) : -Infinity;
  };
  if (p.max - p.min > 2 && p.candidateIds.length > 4) {
    const answer = (x: string[]): GameAction => ({ ...base, choice: { kind: 'effect_cards', cardInstanceIds: x } });
    let chosen: string[] = [];
    let current = p.min === 0 ? score(answer([])) : -Infinity;
    while (chosen.length < p.max) {
      let bestId: string | null = null;
      let best = -Infinity;
      for (const id of p.candidateIds) {
        if (chosen.includes(id)) continue;
        const v = score(answer([...chosen, id]));
        if (v > best) [best, bestId] = [v, id];
      }
      if (!bestId || (chosen.length >= p.min && best <= current)) break;
      chosen = [...chosen, bestId];
      current = best;
    }
    return { route: 'greedy', answer: chosen, ms: performance.now() - t };
  }
  let best: GameAction | null = null;
  let bestScore = -Infinity;
  for (const a of getLegalActions(state, 'corp').filter(a => a.type === 'RESOLVE_PROMPT').slice(0, 200)) {
    const v = score(a);
    if (v > bestScore) [bestScore, best] = [v, a];
  }
  return { route: 'every', answer: ids(best), ms: performance.now() - t };
}

const deal = new Map<string, { decisions: number; ms: number }>();
forEachRecorded({
  decision: d => {
    const row = deal.get(d.src) ?? { decisions: 0, ms: 0 };
    row.decisions++;
    row.ms += d.ms;
    deal.set(d.src, row);
    const a = d.action as (GameAction & { cardInstanceId?: string }) | null;
    if (d.kind === 'action' && a?.type === 'USE_ABILITY' && a.cardInstanceId) {
      const c = findCardAnywhere(d.state, a.cardInstanceId);
      if (c?.cardCode === '30053') {
        const arch = archived(d.state);
        console.log(JSON.stringify({ kind: 'fire', src: d.src, i: d.i, T: d.state.turnNumber, archives: arch.length, archivesAgendas: arch.filter(x => cardDef(x).type_code === 'agenda').length, ms: Math.round(d.ms) }));
      }
    }
    const p = activePrompt(d.state);
    if (d.kind !== 'action' || !p || p.side !== 'corp' || p.kind !== 'effect_cards') return;
    const family = isFamily(d.state, p);
    const twoMore = p.max - p.min === 2 && p.candidateIds.length > 4;
    if (!family && !twoMore) return;
    const s = structuredClone(d.state);
    const card = (id: string) => {
      const c = findCardAnywhere(s, id) as CardInstance;
      const def = cardDef(c);
      return { title: def.title, type: def.type_code, points: def.agenda_points ?? 0, keep: +(keepValue(s, c) + keepBonus(s, c)).toFixed(2) };
    };
    const name = (x: string[]) => x.map(id => card(id).title);
    const old = oldAnswer(s, p);
    clearCaches();
    const played = ids(a);
    console.log(JSON.stringify({
      kind: 'case', src: d.src, i: d.i, T: d.state.turnNumber, code: p.source.cardCode, step: p.source.step, route: family ? 'family' : 'greedy2', oldRoute: old.route,
      min: p.min, max: p.max, n: p.candidateIds.length, candidates: p.candidateIds.map(card),
      played: name(played), old: name(old.answer), same: sorted(played).join() === sorted(old.answer).join(), ms: Math.round(d.ms), oldMs: Math.round(old.ms),
    }));
  },
});
for (const [src, row] of deal) console.log(JSON.stringify({ kind: 'deal', src, decisions: row.decisions, ms: Math.round(row.ms) }));
