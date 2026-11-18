/**
 * Stage D item 2, step 1 (brief sections 2 and 5): a preview of how often a different input for "where the Runner runs"
 * changes a Corp decision, on the human games where a person played the Runner (HUMAN to choose others). At every
 * state where the Corp acts (as scripts/stage-a/harness.ts replayHuman: main phase and prompts, and the rez windows of
 * a run) a fresh Normal Corp is asked under each arm, the replay following the recorded moves. No file under src/
 * changes: an arm sets the exported constants in this process for the one decision, then puts them back, so EVERY
 * reader of PACE.runs, the PACE shares and STEAL.run reads the arm (the three flat sites and the card formulas that read
 * the same shares: an upper bound on what an owner read by the three sites alone would change).
 *  - base: today;
 *  - record: this Runner's runs so far, today's shares as the prior at strength K (8: the person sample's fit,
 *    runner-runs-counts.mjs P2), runs a turn shrunk the same way toward 1.01; a remote's run chance 1 - exp(-runs x
 *    its share) for STEAL.run (one number: the agenda remote's, else the most-run remote's);
 *  - people: the flat shares and runs a turn measured on the 21 person-Runner games (runner-runs-counts.mjs), no record.
 * One JSON line per decision that changes under any arm, and a summary line per game.
 *   SHARD=0/4 npx vite-node scripts/stage-d/runner-runs-fire.ts > fire-0.jsonl
 */
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, wantsStop } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { rezCandidates } from '../../src/ai/playout';
import { PACE, STEAL } from '../../src/ai/effectValues';
import { clearCaches, humanFiles } from '../stage-a/harness';
import { clearBuildTargets, valueLoops } from '../../src/ai/valueModel';
import { clearDeckShares } from '../../src/ai/iceValues';

const K = Number(process.env.K ?? 8);
const BASE = { runs: PACE.runs, hqShare: PACE.hqShare, rdShare: PACE.rdShare, archivesShare: PACE.archivesShare, remoteShare: PACE.remoteShare, steal: STEAL.run };
// runner-runs-counts.mjs on the 21 person-Runner games (2026-11-17): 238 runs in 280 turns; HQ 0.395, R&D 0.294, Archives 0.017, remotes 0.294
const PEOPLE = { runs: 0.85, hqShare: 0.395, rdShare: 0.294, archivesShare: 0.017, remoteShare: 0.294 };
type Runs = { server: string; successful: boolean }[];

function lambda(state: GameState, record: Runs[], prior: typeof PEOPLE, k: number): Record<string, number> {
  const open = Object.keys(state.corp.servers);
  const remotes = open.filter(id => state.corp.servers[id].isRemote);
  const p: Record<string, number> = { hq: prior.hqShare, rd: prior.rdShare, archives: prior.archivesShare };
  for (const r of remotes) p[r] = prior.remoteShare / Math.max(1, remotes.length);
  const pt = Object.values(p).reduce((a, b) => a + b, 0);
  const n: Record<string, number> = {};
  let N = 0;
  for (const turn of record)
    for (const r of turn)
      if (open.includes(r.server)) {
        n[r.server] = (n[r.server] ?? 0) + 1;
        N++;
      }
  const all = record.reduce((a, t) => a + t.length, 0);
  const runs = k === Infinity ? prior.runs : (all + k * prior.runs) / (record.length + k);
  const out: Record<string, number> = {};
  for (const id of Object.keys(p)) out[id] = k === Infinity ? (runs * p[id]) / pt : (runs * ((n[id] ?? 0) + (k * p[id]) / pt)) / (N + k);
  return out;
}

function set(state: GameState, l: Record<string, number> | null) {
  Object.assign(PACE, { runs: BASE.runs, hqShare: BASE.hqShare, rdShare: BASE.rdShare, archivesShare: BASE.archivesShare, remoteShare: BASE.remoteShare });
  STEAL.run = BASE.steal;
  if (!l) return;
  const total = Object.values(l).reduce((a, b) => a + b, 0);
  const remotes = Object.keys(state.corp.servers).filter(id => state.corp.servers[id].isRemote);
  PACE.runs = Math.max(1e-6, total);
  PACE.hqShare = (l.hq ?? 0) / PACE.runs;
  PACE.rdShare = (l.rd ?? 0) / PACE.runs;
  PACE.archivesShare = (l.archives ?? 0) / PACE.runs;
  PACE.remoteShare = remotes.reduce((a, id) => a + (l[id] ?? 0), 0) / PACE.runs;
  const withAgenda = remotes.filter(id => state.corp.servers[id].root.some(c => cardDef(c).type_code === 'agenda'));
  const pick = [...(withAgenda.length ? withAgenda : remotes)].sort((a, b) => (l[b] ?? 0) - (l[a] ?? 0))[0];
  if (pick) STEAL.run = 1 - Math.exp(-(l[pick] ?? 0));
}

function clearAll() {
  clearCaches();
  clearBuildTargets();
  clearDeckShares();
  valueLoops?.clear();
}

function ask(s: GameState, rez: boolean, cards?: CardInstance[]): string {
  clearAll();
  const agent = createAgent('corp', 'normal');
  const a = rez ? (agent.chooseRez?.(structuredClone(s), cards!) ?? null) : agent.chooseAction(structuredClone(s));
  return JSON.stringify(a);
}

function game(file: string) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const src = file.split('/').pop()!;
  valueLoops.clear();
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const record: Runs[] = [];
  let corpTurn = -1;
  const tally = { decisions: 0, record: 0, people: 0, ms: 0 };
  let i = 0;
  for (const move of report.moves as GameAction[]) {
    if (s.activePlayer === 'corp' && s.turnNumber !== corpTurn) {
      corpTurn = s.turnNumber;
      if (s.turnNumber > 1) record.push(s.runnerLastTurnRuns.map(r => ({ ...r })));
    }
    const side = actingSide(s);
    const window = s.priority;
    const rezWindow = s.pendingPrompts.length === 0 && window && window.holder === 'corp' && s.activePlayer === 'runner' && (window.step === 'approach_ice' || window.step === 'approach_server');
    let asked = false;
    let cards: CardInstance[] | undefined;
    if (side === 'corp' && !s.winner) {
      if (rezWindow) {
        if (wantsStop({ ...s, stops: { corp: 'ai', runner: 'ai' } }, 'corp', window)) {
          asked = true;
          cards = rezCandidates(s, window.step as 'approach_ice' | 'approach_server');
        }
      } else if (!(window && window.holder === 'corp' && s.activePlayer === 'runner')) asked = true;
    }
    if (asked) {
      const t = performance.now();
      try {
        const rec = record;
        set(s, null);
        const base = ask(s, !!rezWindow, cards);
        set(s, lambda(s, rec, BASE, K));
        const recd = ask(s, !!rezWindow, cards);
        set(s, lambda(s, rec, PEOPLE, Infinity));
        const people = ask(s, !!rezWindow, cards);
        set(s, null);
        tally.decisions++;
        if (recd !== base) tally.record++;
        if (people !== base) tally.people++;
        if (recd !== base || people !== base)
          console.log(JSON.stringify({ src, i, turn: s.turnNumber, kind: rezWindow ? 'rez' : 'action', base: base.slice(0, 120), record: recd === base ? '=' : recd.slice(0, 120), people: people === base ? '=' : people.slice(0, 120) }));
      } catch (e) {
        set(s, null);
        console.error(`${src} #${i}: ${(e as Error).message}`);
      }
      tally.ms += performance.now() - t;
      i++;
    }
    try {
      s = executeAction(s, move);
    } catch {
      break;
    }
  }
  console.log(JSON.stringify({ summary: src, ...tally, ms: Math.round(tally.ms) }));
}

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const files = humanFiles().filter(f => JSON.parse(readFileSync(f, 'utf8')).config.ai === (process.env.AI ?? 'corp'));
files.forEach((f, k) => {
  if (k % shards === shard) game(f);
});
