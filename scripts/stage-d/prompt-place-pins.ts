/**
 * Stage D item 6 step 1 (stage-d/item6-install-prompts/brief.md section 3, "Ladder"): the trace of the two D3 pins
 * (tests/stageDPins.test.ts: #49 #219 Humanoid Resources, #50 #252 Top-Down Solutions). For each board: the prompt,
 * HQ, the servers, the Corp's credits and clicks, today's answer (a fresh Normal Corp, as the pin asks), which layer of
 * answerPrompt gave it (the run term, a per-card block, the fallback), the fallback's score of every answer, and what the
 * owners say: the order over the prompt's cards at each offered server (freeInstallOrder, the Synapse port), each
 * candidate's line and whether it is behind, and place(card, ctx)[0] for the order's first card.
 *   npx vite-node scripts/stage-d/prompt-place-pins.ts
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, activePrompt, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { answerPrompt, scoreOutcome, simulate } from '../../src/ai/prompts';
import { freeInstallOrder } from '../../src/ai/corp/candidates';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { asSide } from '../../src/ai/pricing';
import { clearCaches } from '../stage-a/harness';

const at = (n: number, move: number): GameState => {
  const r = JSON.parse(readFileSync(`tests/fixtures/human-games/report-${n}.json`, 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of (r.moves as GameAction[]).slice(0, move)) s = executeAction(s, m);
  console.log(`report-${n}: corp ${r.config.corpDeck?.name ?? r.config.corpDeck?.id ?? '?'} (${r.config.corpAI ?? r.config.mode ?? ''}), recorded move ${move}: ${JSON.stringify(r.moves[move])}`);
  return s;
};
const t = (s: GameState, id: string) => {
  const c = findCardAnywhere(s, id);
  return c ? `${cardDef(c).title} [${cardDef(c).type_code}, cost ${cardDef(c).cost ?? '-'}]` : id;
};

for (const [n, m] of [[49, 219], [50, 252]] as const) {
  clearCaches();
  const s = at(n, m);
  const p = activePrompt(s)!;
  console.log(`T${s.turnNumber} ${s.activePlayer} credits ${s.corp.credits} clicks ${s.corp.clicks} run ${JSON.stringify(s.activeRun?.server ?? null)} keep ${asSide('corp', () => rezMoney(s).keep)}`);
  console.log(`prompt ${p.kind} ${'source' in p ? `${p.source.cardCode}:${p.source.step}` : ''} "${(p as { message?: string }).message}" min ${(p as { min?: number }).min} max ${(p as { max?: number }).max}`);
  if (p.kind === 'effect_cards') for (const id of p.candidateIds) console.log(`  candidate ${id} ${t(s, id)}`);
  console.log(`  HQ: ${s.corp.hq.map(c => cardDef(c).title).join(', ')}`);
  for (const v of Object.values(s.corp.servers)) console.log(`  ${v.id}: ice [${v.ice.map(c => `${cardDef(c).title}${c.isRezzed ? '*' : ''}`).join(', ')}] root [${v.root.map(c => `${cardDef(c).title}${c.isRezzed ? '*' : ''}`).join(', ')}]`);
  console.log(`  Runner: credits ${s.runner.credits}, score ${s.runner.score}, Corp score ${s.corp.score}; rig ${[...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => cardDef(c).title).join(', ')}`);
  const today = createAgent('corp', 'normal').chooseAction(structuredClone(s));
  console.log(`  today (chooseAction): ${JSON.stringify((today as { choice?: unknown }).choice)}`);
  clearCaches();
  const direct = asSide('corp', () => answerPrompt(structuredClone(s), 'corp', undefined, true));
  console.log(`  answerPrompt(synergy): ${JSON.stringify((direct as { choice?: unknown }).choice)}`);
  // The fallback's scores
  if (p.kind === 'effect_cards') {
    const base = { type: 'RESOLVE_PROMPT' as const, player: 'corp' as const, promptId: p.id };
    for (const ids of [[], ...p.candidateIds.map(id => [id])]) {
      const a = { ...base, choice: { kind: 'effect_cards' as const, cardInstanceIds: ids } } as GameAction;
      const after = simulate(s, a);
      const next = after && activePrompt(after);
      const score = after ? asSide('corp', () => scoreOutcome(s, after, 'corp', undefined, true)) : null;
      console.log(`  fallback ${ids.length ? t(s, ids[0]) : 'decline'}: ${score === null ? 'illegal' : score.toFixed(3)}; next prompt ${next ? `${next.kind} ${'source' in next ? next.source.step : ''}` : 'none'}`);
    }
    // The owners: the order over the candidates at every server, as the Synapse port asks it (ignoring all costs)
    const servers = [...Object.keys(s.corp.servers), 'new'];
    const order = asSide('corp', () => freeInstallOrder(s, servers));
    console.log(`  order (freeInstallOrder over HQ x ${servers.length} servers, ${order.length} installs):`);
    for (const c of order.slice(0, 12)) console.log(`    line ${c.line}${c.behind ? ' behind' : ''} ${t(s, c.card!)} -> ${(c.action as { targetServerId?: string; asNewRemote?: boolean }).asNewRemote ? 'new' : (c.action as { targetServerId?: string }).targetServerId} keys ${JSON.stringify(c.keys.map(k => Math.round(k * 100) / 100))}`);
  }
}
