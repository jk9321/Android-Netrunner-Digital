/** Part D pins: a fresh Normal Corp's pick at a move of a report-format game. FIX=file AT=91,103 npx vite-node scripts/trap-pins.ts */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
const r = JSON.parse(readFileSync(process.env.FIX!, 'utf8'));
type A = GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
for (const at of process.env.AT!.split(',').map(Number)) {
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of (r.moves as GameAction[]).slice(0, at)) s = executeAction(s, m);
  const name = (a: A) => `${a.type} ${a.cardInstanceId ? cardDef(findCardAnywhere(s, a.cardInstanceId)!).title : ''} ${a.targetServerId ?? (a.asNewRemote ? 'new' : '')}`;
  const pick = createAgent('corp', 'normal').chooseAction(structuredClone(s)) as A;
  console.log(`#${at} T${s.turnNumber} cr ${s.corp.credits} cl ${s.corp.clicks} | game: ${name(r.moves[at])} | now: ${name(pick)}`);
}
