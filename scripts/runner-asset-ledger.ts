/**
 * The human side of the asset ledger (AI Coordinator 2026-11-12, Jeff: "I trash unused regoliths regularly against the
 * AI. Usually because they are easy to get to"). Jeff's Runner games against the Corp AI replayed
 * (tests/fixtures/human-games, config.ai 'corp'). Every econ asset copy the AI Corp installed (its card entry's profile
 * pays credits, when the turn begins or for a click, and loads more than its rez cost): the ice on its server when it
 * went in and when it left, rezzed or not, the credits it gave the Corp (taken off it: rule 1.10, or by its ability),
 * and whether Jeff trashed it, on which turn, the credits left on it then and what he paid (his credits before the
 * trash less after: the printed trash cost, 2.6.1, plus any change). Measurement only. Deck-list driven.
 *
 *   npx vite-node scripts/runner-asset-ledger.ts > ledger.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { profileOf } from '../src/ai/cardProfiles';

const DIR = 'tests/fixtures/human-games';
const roots = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.root.map(c => ({ c, v })));
const econ = (c: CardInstance) => {
  const p = cardDef(c).type_code === 'asset' ? profileOf(c.cardCode) : undefined;
  return !!p && p.pay > 0 && p.load > (cardDef(c).cost ?? 0);
};

interface Copy { title: string; every: string; cost: number; trash: number; installed: number; iceIn: number; rezzed?: number; gave: number; trashed?: { turn: number; ice: number; left: number; paid: number; rezzed: boolean }; leftAtEnd?: number }

for (const file of readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
  const report = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  if (report.config.ai !== 'corp' || !report.moves?.length) continue;
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const copies = new Map<string, Copy>();
  for (const move of report.moves as GameAction[]) {
    let n: GameState;
    try {
      n = executeAction(s, move);
    } catch {
      break;
    }
    for (const { c, v } of roots(n)) if (econ(c) && !copies.has(c.instanceId))
      copies.set(c.instanceId, { title: cardDef(c).title, every: profileOf(c.cardCode)!.every, cost: cardDef(c).cost ?? 0, trash: cardDef(c).trash_cost ?? 0, installed: s.turnNumber, iceIn: v.ice.length, gave: 0 });
    for (const { c, v } of roots(s)) {
      const e = copies.get(c.instanceId);
      if (!e || e.trashed) continue;
      const after = roots(n).find(x => x.c.instanceId === c.instanceId)?.c;
      if (after?.isRezzed && e.rezzed === undefined) e.rezzed = s.turnNumber;
      const took = (c.tokens.credit ?? 0) - (after?.tokens.credit ?? 0);
      if (after && took > 0) e.gave += took;
      if (!after && s.activePlayer === 'runner') e.trashed = { turn: s.turnNumber, ice: v.ice.length, left: c.tokens.credit ?? 0, paid: Math.max(0, s.runner.credits - n.runner.credits), rezzed: c.isRezzed };
    }
    s = n;
  }
  for (const [id, e] of copies) if (!e.trashed) e.leftAtEnd = roots(s).find(x => x.c.instanceId === id)?.c.tokens.credit ?? 0;
  console.log(JSON.stringify({ game: file, deck: report.config.corpDeck.name, turns: s.turnNumber, winner: s.winner ?? null, copies: [...copies.values()] }));
}
