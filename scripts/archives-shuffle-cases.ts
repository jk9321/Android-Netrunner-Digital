/**
 * ai-prompt-time: the Corp prompts that shuffle the Corp's own Archives cards into R&D (step shuffle, every
 * candidate in Archives: Spin Doctor, Longevity Serum, Descent with only Archives agendas), at every recorded Corp
 * decision with one open: each candidate's worth by `keep` (keepValue + keepBonus, as prompts.ts prices a card),
 * the answer the AI gave, and the time.
 *   SHARD=0/2 npx vite-node scripts/archives-shuffle-cases.ts
 */
import { GameAction, GameState, activePrompt, cardDef, findCardAnywhere } from '../src/core';
import { keepValue } from '../src/ai/evaluate';
import { keepBonus } from '../src/ai/synergy';
import { forEachRecorded } from './stage-a/harness';

const inArchives = (s: GameState, id: string) => [...s.corp.archives.faceUp, ...s.corp.archives.faceDown].some(c => c.instanceId === id);
forEachRecorded({
  decision: d => {
    const p = activePrompt(d.state);
    if (d.kind !== 'action' || !p || p.side !== 'corp' || p.kind !== 'effect_cards' || p.source.step !== 'shuffle') return;
    if (!p.candidateIds.length || !p.candidateIds.every(id => inArchives(d.state, id))) return;
    const a = d.action as (GameAction & { choice?: { cardInstanceIds?: string[] } }) | null;
    const card = (id: string) => {
      const c = findCardAnywhere(d.state, id)!;
      const def = cardDef(c);
      return { id, title: def.title, type: def.type_code, points: def.agenda_points ?? 0, keep: +(keepValue(d.state, c) + keepBonus(d.state, c)).toFixed(2) };
    };
    console.log(JSON.stringify({ src: d.src, i: d.i, T: d.state.turnNumber, code: p.source.cardCode, min: p.min, max: p.max, rd: d.state.corp.rd.length, rdAgendas: d.state.corp.rd.filter(c => cardDef(c).type_code === 'agenda').length, candidates: p.candidateIds.map(card), answer: (a?.choice?.cardInstanceIds ?? []).map(id => findCardAnywhere(d.state, id) ? cardDef(findCardAnywhere(d.state, id)!).title : id), ms: Math.round(d.ms) }));
  },
});
