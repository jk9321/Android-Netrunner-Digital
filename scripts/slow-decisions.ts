/**
 * Planner speed P0 (spec-planner-speed.md): every Corp main-phase decision's time (chooseAction) over a set of deals,
 * Normal v Normal. Mean, p95, max, and the count over 5 s and 10 s per 100 games; for each decision over 5 s, whether
 * scoreNow had a line on that click (winNow.ts scoreNowPlan), whether a held two-turn line (corpAI heldLine,
 * countedScore.ts scoreInTwoPick) was being continued, or neither, and the number of remotes.
 *
 * Planner budget: each decision's threat budgets (threatStats.budgeted) and the planner's (plannerStats.lastBudgets) are
 * recorded; DCACHE=0 keeps the threat cache across decisions (plan.decisionCache off), CAP=n caps the planner at n
 * threat budgets (PLANNER.budgetCap), DIFF=1 also plays a cut decision's left-out candidates to count changed picks.
 *
 *   DEALS=1001,1071 npx vite-node scripts/slow-decisions.ts
 */
import { GameState, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { scoreNowPlan } from '../src/ai/winNow';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { PLANNER, plannerStats } from '../src/ai/turnPlanner';
import { threatStats } from '../src/ai/threatModel';
import { tuning } from '../src/ai/synergy';
import { HeldLine, heldLaterStep } from '../src/ai/countedScore';

if (process.env.DCACHE === '0') (tuning.plan as Record<string, unknown>).decisionCache = false;
if (process.env.CAP) PLANNER.budgetCap = Number(process.env.CAP);
let planBudgets = 0;
let cut = false;
let cuts = 0;
let changed = 0;
plannerStats.onCandidates = side => {
  if (side !== 'corp') return;
  planBudgets += plannerStats.lastBudgets ?? 0;
  if (plannerStats.lastCut) cut = true;
};
if (process.env.DIFF === '1')
  plannerStats.onCut = (capped, uncapped) => {
    if (JSON.stringify(capped) !== JSON.stringify(uncapped)) changed++;
  };
const rows: { seed: number; turn: number; s: number; budgets: number; planBudgets: number }[] = [];

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const deals = (process.env.DEALS ?? '').split(',').filter(Boolean).map(Number);
const ms: number[] = [];
const slow: { seed: number; turn: number; s: number; remotes: number; kind: 'scoreNow' | 'held' | 'neither' }[] = [];
let games = 0;
/** Review R3: decisions where a held line's later-turn step decided the click (the planner is skipped), by kind. */
const heldSteps = { score: 0, advance: 0 };
for (const seed of deals) {
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  const corp = createAgent('corp', 'normal');
  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = (s: GameState) => {
    const heldLine = (corp as unknown as { heldLine: HeldLine | null }).heldLine;
    const held = !!heldLine;
    const later = asSide('corp', () => heldLaterStep(s, heldLine));
    if (later) heldSteps[later.type === 'SCORE_AGENDA' ? 'score' : 'advance']++;
    planBudgets = 0;
    cut = false;
    const b0 = threatStats.budgeted;
    const t = performance.now();
    const a = choose(s);
    const d = performance.now() - t;
    ms.push(d);
    rows.push({ seed, turn: s.turnNumber, s: +(d / 1000).toFixed(2), budgets: threatStats.budgeted - b0, planBudgets });
    if (cut) cuts++;
    if (d > 5000) {
      const score = asSide('corp', () => (decisionContext(s, 'corp'), scoreNowPlan(s)));
      slow.push({ seed, turn: s.turnNumber, s: +(d / 1000).toFixed(1), remotes: Object.values(s.corp.servers).filter(v => v.isRemote).length, kind: score ? 'scoreNow' : held ? 'held' : 'neither' });
    }
    return a;
  };
  const runner = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp, runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 6000 && runner.step(); i++);
  games++;
}
const sorted = [...ms].sort((x, y) => x - y);
const per100 = (n: number) => +((n * 100) / games).toFixed(1);
const by = (k: string, min: number) => slow.filter(x => x.kind === k && x.s > min).length;
console.log(JSON.stringify({
  games, decisions: ms.length, meanMs: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length), p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]), maxS: +(sorted[sorted.length - 1] / 1000).toFixed(1),
  over5per100: per100(slow.length), over10per100: per100(slow.filter(x => x.s > 10).length),
  over5: { scoreNow: by('scoreNow', 5), held: by('held', 5), neither: by('neither', 5) },
  over10: { scoreNow: by('scoreNow', 10), held: by('held', 10), neither: by('neither', 10) },
  slow,
  cutPer100Decisions: +((cuts * 100) / ms.length).toFixed(2),
  cutPicksChanged: changed,
  heldSteps,
  rows,
}));
