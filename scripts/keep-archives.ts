import { readFileSync } from 'node:fs';
import '../src/ai';
import { GameState, activePrompt, cardDef, findCardAnywhere } from '../src/core';
import { keepValue } from '../src/ai/evaluate';
import { keepBonus } from '../src/ai/synergy';
import { answerPrompt } from '../src/ai/prompts';
const s: GameState = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const p = activePrompt(s)! as any;
console.log(p.source.cardCode, p.source.step, p.min, p.max, 'credits', s.corp.credits, 'T', s.turnNumber);
for (const id of p.candidateIds) { const c = findCardAnywhere(s, id)!; console.log(`  ${cardDef(c).title} (${cardDef(c).type_code}${cardDef(c).agenda_points ? ' ' + cardDef(c).agenda_points + 'pt' : ''}) keep ${keepValue(s, c).toFixed(2)} bonus ${keepBonus(s, c).toFixed(2)}`); }
const a = answerPrompt(structuredClone(s), 'corp', undefined, true) as any;
console.log('current answer:', a.choice.cardInstanceIds.map((id: string) => cardDef(findCardAnywhere(s, id)!).title));
