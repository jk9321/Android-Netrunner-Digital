/**
 * Step 4 Stage C debugging aid: one saved state (a test fixture or a slow-deal.ts save), the Corp's turn played from it
 * by a Normal Corp of the new core (corpCore, rolloutLines; CORE=old for the ranking), printing at each main-phase
 * decision the candidate list (corp/candidates.ts: line, behind, keys) and the move made.
 *   STATE=tests/fixtures/bug-report-4-turn13.json npx vite-node scripts/stage-c/turn-trace.ts
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, cardDef, executeAction, findCardAnywhere, getLegalActions } from '../../src/core';
import { createAgent } from '../../src/ai';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { corpCandidates } from '../../src/ai/corp/candidates';
import { isCorpMain } from '../../src/ai/corp/lines';

const name = (s: GameState, a: GameAction) => {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  const at = 'targetServerId' in a && a.targetServerId ? '@' + a.targetServerId : a.type === 'INSTALL_CARD' ? '@new' : '';
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${at}`;
};
const core = process.env.CORE ?? 'new';
withPricing({ plan: { ...plan(), corpCore: core === 'new', rolloutLines: core === 'new' } }, () => {
  let s: GameState = JSON.parse(readFileSync(process.env.STATE ?? '', 'utf8'));
  const corp = createAgent('corp', process.env.LEVEL === 'hard' ? 'hard' : 'normal', process.env.LEVEL === 'hard' ? { samples: 6, seed: 1 } : undefined);
  for (let i = 0; i < 25 && s.activePlayer === 'corp' && !s.winner; i++) {
    const main = isCorpMain(s);
    const list = main ? asSide('corp', () => (decisionContext(s, 'corp'), corpCandidates(s, getLegalActions(s, 'corp'), { held: null, freeExhausted: false }))) : [];
    const a = corp.chooseAction(s);
    console.log(`T${s.turnNumber} ${s.turnStep?.kind ?? ''} clicks ${s.corp.clicks} credits ${s.corp.credits} HQ ${s.corp.hq.map(c => cardDef(c).title).join(', ')} -> ${name(s, a)}`);
    for (const c of list.slice(0, Number(process.env.TOP ?? 10))) console.log(`   L${c.line}${c.behind ? ' behind' : ''} [${c.keys.map(k => +k.toFixed(2)).join(' ')}] ${name(s, c.action)}`);
    s = executeAction(s, a);
    if (a.type === 'END_TURN') break;
  }
  console.log(`end: HQ ice ${s.corp.servers.hq.ice.map(c => cardDef(c).title + (c.isRezzed ? '*' : '')).join(', ')}`);
});
