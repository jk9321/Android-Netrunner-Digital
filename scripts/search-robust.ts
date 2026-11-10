/**
 * Spec-search S2 robustness (AI Coordinator 2026-11-09): do the held lines plan.searchLines accepted still beat their
 * rule line by more than SEARCH.margin when every line is read on more reply samples? Reads the positions
 * scripts/search-holds.ts dumped with DUMP=accepted, replays each decision with REPLY.samples = N (default 8) and
 * prints, per position, the 2-sample gain, the N-sample gain and whether the held line still stands.
 *
 *   npx vite-node scripts/search-robust.ts -- <dump dir> [samples]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { GameAction, GameState } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { REPLY } from '../src/ai/runnerReply';
import { SEARCH, plannerStats } from '../src/ai/turnPlanner';

const [dir, samplesArg] = process.argv.slice(2).filter(a => a !== '--');
const samples = Number(samplesArg ?? 8);
tuning.plan.searchLines = true;
tuning.plan.searchSamples = false;
const files = readdirSync(dir).filter(f => f.startsWith('hold-accepted-') && f.endsWith('.json'));
const rows: { file: string; gain2: number; gainN: number | null; builds: boolean | null; stands: boolean; picked: boolean }[] = [];
for (const file of files) {
  const { gain, action, state } = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as { gain: number; action: GameAction; state: GameState };
  const key = JSON.stringify(action);
  let seen: { gain: number; builds: boolean; accepted: boolean } | null = null;
  plannerStats.onHold = (_s, a, h) => {
    if (JSON.stringify(a) === key) seen = h;
  };
  REPLY.samples = samples;
  const chosen = createAgent('corp').chooseAction(structuredClone(state));
  REPLY.samples = 2;
  const h = seen as { gain: number; builds: boolean; accepted: boolean } | null;
  rows.push({ file, gain2: gain, gainN: h ? h.gain : null, builds: h ? h.builds : null, stands: !!h?.accepted, picked: JSON.stringify(chosen) === key });
}
rows.sort((a, b) => b.gain2 - a.gain2);
for (const r of rows) console.log(`${r.file}\t2-sample gain ${r.gain2.toFixed(1)}\t${samples}-sample gain ${r.gainN === null ? '-' : r.gainN.toFixed(1)}\tstands ${r.stands}\tpicked ${r.picked}`);
const stand = rows.filter(r => r.stands).length;
console.log(JSON.stringify({ positions: rows.length, samples, margin: SEARCH.margin, stillStand: stand, alsoPicked: rows.filter(r => r.stands && r.picked).length, medianGain2: rows.map(r => r.gain2).sort((a, b) => a - b)[rows.length >> 1], medianGainN: rows.map(r => r.gainN ?? -Infinity).sort((a, b) => a - b)[rows.length >> 1] }));
