/**
 * Part B fire count (spec jeff-games-48-50): plays the deals as PLAN_OFF gives and, at every Corp prompt, answers it
 * with plan.chainEnd off and on (decisions changed by prompt kind, and ms per answer each way). Also, per game:
 * Warm Reception / Janaina pick steps where the generic answer differs from the card's own; asset and upgrade installs
 * (click or effect) straight into the scoring remote's free root while an agenda is in HQ, split by whether holdCost
 * finds a line for that remote then (horizon: what the Corp ends the turn on plus next turn's income and clicks, less
 * afterLineFloor); and installs that trash one of the Corp's own root cards (8.5.6a), by click or effect.
 *   SEEDS=1001,1041 [PLAN_OFF=+chainEnd] [SHARD=0/4] npx vite-node scripts/prompt-fires.ts > out.jsonl
 */
import { GameAction, GameState, activePrompt, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff, tuning } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { answerPrompt, genericAnswer } from '../src/ai/prompts';
import { afterLineFloor, holdCost, knownIncome, scoringRemote } from '../src/ai/countedScore';

applyPlanOff(process.env.PLAN_OFF ?? '');
const type = (c: { cardCode: string }) => cardDef(c as never).type_code;
const title = (code: string) => cardDef({ cardCode: code } as never).title;
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const answerWith = (s: GameState, on: boolean, f = answerPrompt): { a: string; ms: number } => {
  const keep = tuning.plan;
  tuning.plan = { ...keep, chainEnd: on };
  try {
    const t = performance.now();
    const a = asSide('corp', () => { decisionContext(s, 'corp'); return f(s, 'corp', undefined, true); }) as GameAction & { choice?: unknown };
    return { a: JSON.stringify(a.choice ?? null), ms: performance.now() - t };
  } finally {
    tuning.plan = keep;
  }
};
const roots = (s: GameState) => new Map(Object.values(s.corp.servers).flatMap(v => v.root.map(c => [c.instanceId, { server: v.id, code: c.cardCode }] as const)));
for (const [i, seed] of seeds.entries()) {
  if (i % shards !== shard) continue;
  const p = Math.floor((seed - 1001) / 10);
  const corpDeck = corpDecks[Math.floor(p / runnerDecks.length)];
  valueLoops.clear();
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDeck, runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const prompts: Record<string, { n: number; changed: number }> = {};
  let msOff = 0, msOn = 0, nAns = 0;
  const warm = { n: 0, differ: 0 };
  const straight: { how: string; type: string; card: string; holds: boolean }[] = [];
  const ownTrash: { how: string; trashed: string; by: string }[] = [];
  try {
    for (let k = 0; k < 8000; k++) {
      const s: GameState = game.state;
      const pr = activePrompt(s);
      if (pr && pr.side === 'corp' && pr.kind !== 'mulligan') {
        const key = 'source' in pr ? `${title(pr.source.cardCode)}/${pr.source.step}` : pr.kind;
        const off = answerWith(s, false);
        const on = answerWith(s, true);
        msOff += off.ms; msOn += on.ms; nAns++;
        const e = (prompts[key] ??= { n: 0, changed: 0 });
        e.n++;
        if (off.a !== on.a) e.changed++;
        if ('source' in pr && ['34098', '34115'].includes(pr.source.cardCode) && pr.source.step === 'pick') {
          warm.n++;
          if (answerWith(s, true, genericAnswer).a !== on.a) warm.differ++;
        }
      }
      // Installs: before and after one step
      const scoring = scoringRemote(s);
      const agendas = s.corp.hq.filter(x => type(x) === 'agenda');
      const before = roots(s);
      const freeRoot = !!scoring && !scoring.root.some(x => ['agenda', 'asset'].includes(type(x)));
      const how = pr ? (pr.side === 'corp' ? 'effect' : 'other') : s.activePlayer === 'corp' ? 'click' : 'other';
      if (!game.step()) break;
      const t = game.state;
      const after = roots(t);
      const added = [...after].filter(([id]) => !before.has(id));
      if (added.length === 0) continue;
      for (const [id, info] of before) {
        if (!after.has(id) && added.some(([, a]) => a.server === info.server)) ownTrash.push({ how, trashed: title(info.code), by: title(added.find(([, a]) => a.server === info.server)![1].code) });
      }
      if (scoring && freeRoot && agendas.length) {
        for (const [, a] of added) {
          const ty = type({ cardCode: a.code });
          if (a.server !== scoring.id || (ty !== 'asset' && ty !== 'upgrade')) continue;
          const floor = Math.min(...agendas.map(x => afterLineFloor(s, x.instanceId)));
          const horizon = s.corp.credits + Math.max(0, s.corp.clicks - 1) + knownIncome(s) + s.corp.maxClicks + (s.corp.bonusClicksNextTurn ?? 0) - floor;
          straight.push({ how, type: ty, card: title(a.code), holds: holdCost(s, scoring.ice, horizon) !== null });
        }
      }
    }
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  console.log(JSON.stringify({ seed, deck: corpDeck.name, winner: game.state.winner ?? null, turns: game.state.turnNumber, nAns, msOff: Math.round(msOff), msOn: Math.round(msOn), prompts, warm, straight, ownTrash }));
}
