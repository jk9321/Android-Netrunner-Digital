/**
 * ai-runner-fixes bar (brief-runner-fixes.md): the four behaviour numbers per game on the local deals (seeds 1001 + 40k,
 * Normal v Normal), plus the Runner's decision time and each game's moves (to count the games a branch changes). Run on
 * the base tree and the head tree (copy this file into scripts/) and compare.
 *   - central runs through damage ice: runs on HQ or R&D with rezzed ice that does damage (net, meat or core)
 *   - assets trashed: accessed assets the Runner paid to trash (rule 1.19.2)
 *   - budget-failed runs: at a Runner main decision, servers with rezzed ice whose ETR credits the Runner can pay
 *     (iceCreditNeed against runBudget) that runScore still bars (-Infinity) though the access is worth something
 *   - Drone uses: Devadatta Drone's breach prompt answered "use"
 *   - Runner flatlines by cause (review R1): the step that flatlined it was in a run's access (a steal's or a card's damage),
 *     in an encounter (ice), on the Corp's turn (with the grip it began that turn on), or other; and the Runner turns that
 *     ended on an empty grip
 *
 *   npx vite-node scripts/runner-fixes-behaviour.ts -- out.jsonl [deals] [first k]
 */
import { writeFileSync } from 'node:fs';
import { GameState, activePrompt, cardDef, createInitialGameState, getLegalActions } from '../src/core';
import { GameRunner } from '../src/ai/playout';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { Agent, createAgent } from '../src/ai';
import { asSide } from '../src/ai/synergy';
import { decisionContext } from '../src/ai/handValues';
import { iceCreditNeed, runBudget, runScore, serverValue } from '../src/ai/runs';

const [out, dealsArg, fromArg] = process.argv.slice(2).filter(a => a !== '--');
const deals = Number(dealsArg ?? 56);
const from = Number(fromArg ?? 0);
const DRONE = '35031';
const damaging = (s: GameState, id: string) => s.corp.servers[id].ice.some(i => i.isRezzed && /(net|meat|core) damage/i.test(cardDef(i).stripped_text ?? ''));

const hash = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0; return h; };
const rows: string[] = [];
const corp = ALL_DECKS.filter(d => d.side === 'corp');
const runner = ALL_DECKS.filter(d => d.side === 'runner');
for (let k = from; k < from + deals; k++) {
  const seed = 1001 + 40 * k;
  const pairing = (seed - 1001) / 10;
  const c = corp[Math.floor(pairing / runner.length) % corp.length];
  const r = runner[pairing % runner.length];
  const n = { flatAccess: 0, flatIce: 0, flatCorpTurn: 0, flatOther: 0, corpTurnGrip: -1, emptyTurnEnds: 0, damageIceRuns: 0, assetsTrashed: 0, budgetFailed: 0, droneUses: 0, dronePrompts: 0, ms: 0, decisions: 0, maxMs: 0 };
  const moves: string[] = [];
  const agent: Agent = createAgent('runner');
  const choose = agent.chooseAction.bind(agent);
  agent.chooseAction = (s: GameState) => {
    const p = activePrompt(s);
    if (!p && !s.activeRun && s.activePlayer === 'runner' && s.runner.clicks > 0) {
      asSide('runner', () => {
        decisionContext(s, 'runner');
        const legal = getLegalActions(s, 'runner');
        for (const a of legal) {
          if (a.type !== 'INITIATE_RUN') continue;
          const ice = s.corp.servers[a.targetServerId].ice.filter(i => i.isRezzed);
          if (!ice.length) continue;
          const need = ice.reduce((m, i) => m + iceCreditNeed(s, i), 0);
          if (need <= runBudget(s) && serverValue(s, a.targetServerId, 0, undefined, true) > 0 && runScore(s, a.targetServerId, { wary: true }) === -Infinity) n.budgetFailed++;
        }
      });
    }
    const start = performance.now();
    const a = choose(s);
    const d = performance.now() - start;
    n.ms += d;
    n.maxMs = Math.max(n.maxMs, d);
    n.decisions++;
    if (a.type === 'INITIATE_RUN' && (a.targetServerId === 'hq' || a.targetServerId === 'rd') && damaging(s, a.targetServerId)) n.damageIceRuns++;
    if (p && a.type === 'RESOLVE_PROMPT') {
      const choice = a.choice as { kind: string; trash?: boolean; optionId?: string };
      if (p.kind === 'access_trash' && choice.trash) {
        const id = (p as { cardInstanceId: string }).cardInstanceId;
        const card = Object.values(s.corp.servers).flatMap(v => v.root).find(x => x.instanceId === id);
        if (card && cardDef(card).type_code === 'asset') n.assetsTrashed++;
      }
      if ('source' in p && p.source.cardCode === DRONE) {
        n.dronePrompts++;
        if (choice.optionId === 'use') n.droneUses++;
      }
    }
    return a;
  };
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp'), runner: agent });
  let corpTurnGrip = -1;
  for (let i = 0; i < 6000 && !gr.state.winner && gr.state.turnNumber <= 80; i++) {
    const before = gr.state;
    if (!gr.step()) break;
    const after = gr.state;
    if (before.activePlayer === 'runner' && after.activePlayer === 'corp') {
      corpTurnGrip = after.runner.grip.length;
      if (corpTurnGrip === 0) n.emptyTurnEnds++;
    }
    if (after.winner === 'corp' && /flatline/i.test(after.winReason ?? '')) {
      const run = before.activeRun;
      if (before.activePlayer === 'corp' && !run) {
        n.flatCorpTurn++;
        n.corpTurnGrip = corpTurnGrip;
      } else if (run?.encounter) n.flatIce++;
      else if (run && (run.phase === 'access' || run.breached)) n.flatAccess++;
      else n.flatOther++;
    }
    const g = gr.state;
    moves.push(`${g.turnNumber}:${g.corp.credits}:${g.runner.credits}:${g.corp.clicks}:${g.runner.clicks}:${g.runner.grip.length}:${g.corp.hq.length}:${g.corp.score}:${g.runner.score}`);
  }
  rows.push(JSON.stringify({ k, seed, corp: c.id, runner: r.id, winner: gr.state.winner ?? null, turns: gr.state.turnNumber, ...n, ms: Math.round(n.ms), maxMs: Math.round(n.maxMs), moves: hash(JSON.stringify(moves)), steps: moves.length }));
  console.error(`deal ${k}: ${gr.state.winner} T${gr.state.turnNumber}`);
}
writeFileSync(out, rows.join('\n') + '\n');
