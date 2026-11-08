/**
 * Time per Corp decision and where it goes (Fable review 2026-11-07: beta ran ~3x slower per game after item 3).
 * Plays the first Corp decisions of the human games' positions (tests/fixtures/human-games) and the planner fixture
 * with the Normal Corp, and prints the time per decision and the threat's share (calls, budgets, ms).
 *
 *   [PLAN_OFF=...] npx vite-node scripts/threat-profile.ts -- [decisions per file] [normal|hard]
 */
import { readFileSync, readdirSync } from "node:fs";
import { GameState, createInitialGameState, executeAction } from "../src/core";
import { deckGameSetup } from "../src/data/decks";
import { createAgent } from "../src/ai";
import { applyPlanOff } from "../src/ai/synergy";
import { batchTokens } from "./oracle-ice";
import { threatStats } from "../src/ai/threatModel";
import { replyStats } from "../src/ai/runnerReply";
import { oracleStats } from "../src/ai/oracle";

// Batch-only tokens (ORACLE_ICE, money) are board setups for corp-losses.ts, not plan switches: dropped here
applyPlanOff(batchTokens(process.env.PLAN_OFF ?? "").plan);
const [nArg, levelArg] = process.argv.slice(2).filter((a) => a !== "--");
const perFile = Number(nArg ?? 6);
const level = (levelArg ?? "normal") as "normal" | "hard";
threatStats.timing = true;
let replies = 0;
replyStats.onSamples = () => replies++;

/** Corp decision positions: each human game replayed to its middle Corp turns. */
function positions(): GameState[] {
  const dir = "tests/fixtures/human-games";
  const out: GameState[] = [];
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const g = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    if (!g.moves?.length || g.config?.ai !== "runner") continue; // Jeff's Corp games: the AI is the Runner
    let s = createInitialGameState(
      deckGameSetup(g.config.seed, g.config.corpDeck, g.config.runnerDeck),
    );
    if (g.startStops) s = { ...s, stops: g.startStops };
    const mid = Math.floor(g.moves.length / 3);
    let last = -Infinity;
    for (let i = 0; i < g.moves.length; i++) {
      try {
        s = executeAction(s, g.moves[i]);
      } catch (err) {
        if (process.env.DEBUG) console.error(f, i, `${err}`);
        break;
      }
      if (
        i >= mid &&
        i - last > 20 &&
        s.activePlayer === "corp" &&
        s.pendingPrompts.length === 0 &&
        !s.activeRun &&
        s.corp.clicks >= 2
      ) {
        out.push(s);
        last = i;
        if (out.filter((x) => x.id === s.id).length >= perFile) break;
      }
    }
  }
  return out;
}

const list = positions();
const corp = createAgent(
  "corp",
  level,
  level === "hard" ? { samples: 6, candidates: 3, seed: 1 } : {},
);
const times: number[] = [];
const t0 = performance.now();
for (const s of list) {
  const t = performance.now();
  corp.chooseAction(s);
  times.push(performance.now() - t);
}
const total = performance.now() - t0;
times.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    plan: process.env.PLAN_OFF ?? "",
    level,
    decisions: times.length,
    meanMs: Math.round(total / times.length),
    p50: Math.round(times[Math.floor(times.length / 2)]),
    max: Math.round(times[times.length - 1]),
    replies,
    threatCalls: threatStats.calls,
    threatKeyed: threatStats.keyed,
    threatBudgeted: threatStats.budgeted,
    threatKeyMs: Math.round(threatStats.keyMs),
    threatBudgetMs: Math.round(threatStats.budgetMs),
    replyBudgeted: threatStats.replyBudgeted,
    replyBudgetMs: Math.round(threatStats.replyBudgetMs),
    oracleTurns: oracleStats.turns,
    oracleHits: oracleStats.hits,
    oracleMs: Math.round(oracleStats.ms),
    threatShare: +((threatStats.keyMs + threatStats.budgetMs) / total).toFixed(
      2,
    ),
  }),
);
