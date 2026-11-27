import { createInitialGameState, executeAction, getLegalActions, createRng, GameState } from '../../../src/core';
import { deckGameSetup } from '../../../src/data/decks';
import { FUZZ_CORPS, FUZZ_RUNNERS, pickAction } from '../../engine-fuzz-check';
import { actingSide } from '../../../src/core/engine/priority';
const args = process.argv.slice(2).filter(a => a !== '--');
const seed = Number(args[0]); const at = Number(args[1]);
const corp = FUZZ_CORPS[seed % FUZZ_CORPS.length];
const runner = FUZZ_RUNNERS[Math.floor(seed / FUZZ_CORPS.length) % FUZZ_RUNNERS.length];
const rng = createRng(seed ^ 0x5eed);
let s: GameState = createInitialGameState(deckGameSetup(seed, corp, runner));
for (let i = 0; i < at; i++) {
  const a = pickAction(getLegalActions(s, actingSide(s)!), rng)!;
  const n = executeAction(s, a);
  if (i + 1 === at) {
    console.log('prompt before', JSON.stringify(s.pendingPrompts[0]?.source ?? s.pendingPrompts[0]?.kind), 'action', JSON.stringify(a));
    console.log('log', n.log.slice(s.log.length).map(l => l.message).join(' | '));
    console.log('marks before', JSON.stringify(s.corp.rdKnownToRunner), '\nmarks after', JSON.stringify(n.corp.rdKnownToRunner));
    console.log('hqList before', JSON.stringify(s.corp.knownToRunner), '\nhqList after', JSON.stringify(n.corp.knownToRunner));
  }
  s = n;
}
