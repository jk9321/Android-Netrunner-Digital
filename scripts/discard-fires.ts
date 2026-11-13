/**
 * Ice discard (spec ice-discard, bars/ice-discard.md): one JSON line per deal. Arm A: the top-level Corp's ice installs
 * on a central that discardRescue gives for a credit or draw click on the same state (called on the state; a planner
 * pick of the same install counts too, so read on against off), by central. Per game: the
 * cards the Corp discarded at the end of its turns (5.6.3a), by type, so the fires can be read against what the discard
 * became (another ice, an agenda, something else, nothing). Arm B: the top-level asset or upgrade installs made while
 * the only-iced-remote reservation holds and the old rule would have released it (onlyRemote), and where they went.
 * Plays the deal as PLAN_OFF gives.
 *   SEEDS=1001,1041 [PLAN_OFF=discardRescue] npx vite-node scripts/discard-fires.ts > out.jsonl
 */
import { GameAction, GameState, activePrompt, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { afterLineFloor, discardRescue, isCorpMain, knownIncome, reservedForAgenda } from '../src/ai/countedScore';
import { rezCostOf } from '../src/core';
import { keep } from '../src/ai/prompts';
import { tuning } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

applyPlanOff(process.env.PLAN_OFF ?? '');
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
for (const [k, seed] of seeds.entries()) {
  if (k % shards !== shard) continue;
  const p = Math.floor((seed - 1001) / 10);
  const corpDeck = corpDecks[Math.floor(p / runnerDecks.length)];
  valueLoops.clear();
  const stats = { fired: 0, hq: 0, rd: 0 };
  const corpAgent = createAgent('corp', 'normal');
  const discarded: Record<string, number> = {};
  const fires: { turn: number; firedAt: number; under: boolean; rezIn2: boolean }[] = [];
  let turnStarts = 0, broke = 0;
  let lastTurn = -1;
  const onlyRemote: { turn: number; to: string }[] = [];
  const choose = corpAgent.chooseAction.bind(corpAgent);
  corpAgent.chooseAction = (st: GameState) => {
    const a = choose(st) as GameAction & { choice?: { kind?: string; cardInstanceIds?: string[] }; cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
    // went broke: Corp turns begun under 3 credits (the batch alarm's count)
    if (isCorpMain(st) && st.turnNumber !== lastTurn) {
      lastTurn = st.turnNumber;
      turnStarts++;
      if (st.corp.credits < 3) broke++;
    }
    const card = a.type === 'INSTALL_CARD' && isCorpMain(st) ? st.corp.hq.find(x => x.instanceId === a.cardInstanceId) : undefined;
    if (card && ['asset', 'upgrade'].includes(cardDef(card).type_code)) {
      const was = tuning.plan.onlyRemoteHold;
      const res = (on: boolean) => { tuning.plan.onlyRemoteHold = on; return asSide('corp', () => (decisionContext(st, 'corp'), reservedForAgenda(st)?.id ?? null)); };
      const on = res(true), off = res(false);
      tuning.plan.onlyRemoteHold = was;
      if (on !== off) onlyRemote.push({ turn: st.turnNumber, to: a.asNewRemote ? 'new' : a.targetServerId ?? '?' });
    }
    const to = a.type === 'INSTALL_CARD' && isCorpMain(st) && (a.targetServerId === 'hq' || a.targetServerId === 'rd') ? a.targetServerId : undefined;
    if (to) {
      const same = (type: 'GAIN_CREDIT' | 'DRAW_CARD') => asSide('corp', () => (decisionContext(st, 'corp'), discardRescue(st, { type, player: 'corp' } as GameAction, c => keep(st, c, true)))) as { cardInstanceId?: string; targetServerId?: string } | null;
      const hit = [same('GAIN_CREDIT'), same('DRAW_CARD')].some(r => r?.cardInstanceId === a.cardInstanceId && r?.targetServerId === to);
      if (hit) {
        stats.fired++;
        stats[to]++;
        const c = st.corp.hq.find(x => x.instanceId === a.cardInstanceId)!;
        const { floor, income } = asSide('corp', () => (decisionContext(st, 'corp'), { floor: afterLineFloor(st, ''), income: knownIncome(st) }));
        const left = st.corp.credits - st.corp.servers[to].ice.length;
        fires.push({ turn: st.turnNumber, firedAt: st.corp.clicks, under: st.corp.credits < floor, rezIn2: left + 2 * income >= rezCostOf(st, c) });
      }
    }
    const pr = activePrompt(st);
    if (pr?.kind === 'discard' && a.choice?.kind === 'discard') for (const id of a.choice.cardInstanceIds ?? []) {
      const c = st.corp.hq.find(x => x.instanceId === id);
      const t = c ? cardDef(c).type_code : 'other';
      discarded[t] = (discarded[t] ?? 0) + 1;
    }
    return a;
  };
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDeck, runnerDecks[p % runnerDecks.length])), { corp: corpAgent, runner: createAgent('runner', 'normal') });
  const t0 = performance.now();
  try {
    for (let i = 0; i < 8000; i++) if (!game.step()) break;
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  console.log(JSON.stringify({ seed, deck: corpDeck.name, winner: game.state.winner ?? null, turns: game.state.turnNumber, score: [game.state.corp.score, game.state.runner.score], ms: Math.round(performance.now() - t0), stats, fires, discarded, onlyRemote, turnStarts, broke }));
}
