// One Corp decision on a dumped position, timed (profile with node --cpu-prof): FILE=pos.json npx vite-node scripts/profile-decision.ts
import { readFileSync } from 'node:fs';
import { GameState } from '../src/core';
import { HeuristicCorpAI } from '../src/ai';
import { threatStats } from '../src/ai/threatModel';
import { plannerStats } from '../src/ai/turnPlanner';
const s: GameState = JSON.parse(readFileSync(process.env.FILE!, 'utf8'));
const b0 = threatStats.budgeted;
const t = performance.now();
const a = new HeuristicCorpAI({ synergy: true }).chooseAction(s);
console.log(JSON.stringify({ ms: Math.round(performance.now() - t), action: a, budgets: threatStats.budgeted - b0, planner: plannerStats.decisions }));
