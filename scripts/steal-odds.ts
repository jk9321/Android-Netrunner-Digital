/**
 * How well the Corp AI judges agenda safety (Jeff, 2026-10-28): at the start
 * of each Runner turn, the steal chance the value model gives each installed
 * agenda (evaluate.ts agendaWorth: stealOdds, and the older AGENDA_RUN x
 * runSuccess) against whether the Runner stole it that turn, with the Brier
 * score of each guess (lower is better). Also agendas held in HQ.
 *
 *   H2H=corp|new SHARD=i/n npx vite-node scripts/steal-odds.ts -- [games per pairing] [normal|hard] > out.json
 *   node scripts/steal-odds-sum.mjs out/*.json
 *
 * H2H=corp plays the new Corp against the old Runner (checkout in ./old, as head-to-head.ts); new is self-play.
 */
import { resolve } from 'node:path';
import { createInitialGameState, cardDef, GameState } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { runSuccess, stealOdds } from '../src/ai/effectValues';
import { AGENDA_RUN } from '../src/ai/evaluate';
import { tuning } from '../src/ai/synergy';

// A switch written +name turns it on instead (pieces that are off by default)
for (const key of (process.env.PLAN_OFF ?? '').split(',').filter(Boolean)) {
  const on = key.startsWith('+');
  const [name, side] = key.replace(/^\+/, '').split('.');
  const plan = tuning.plan as Record<string, unknown>;
  if (side) plan[name] = { ...(plan[name] as object), [side]: on };
  else plan[name] = on;
}

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const vsOld = process.env.H2H === 'corp';
const old = vsOld ? ((await import(resolve(process.env.OLD_AI ?? 'old', 'src/ai/index.ts'))) as { createAgent: typeof createAgent }) : null;

/** The guesses compared: the old one, and stealOdds with 0 to 4 credits of income before the run. */
const GUESSES: Record<string, (s: GameState, server: string) => number> = {
  old: (s, v) => AGENDA_RUN * runSuccess(s, v),
  income0: (s, v) => stealOdds(s, v, undefined, 0),
  income2: (s, v) => stealOdds(s, v, undefined, 2),
  income3: (s, v) => stealOdds(s, v, undefined, 3),
  income4: (s, v) => stealOdds(s, v, undefined, 4),
};
const brier: Record<string, number> = Object.fromEntries(Object.keys(GUESSES).map(k => [k, 0]));
type Tally = { n: number; predicted: number; ran: number; stolen: number; guesses?: Record<string, number> };
const tally = (): Tally => ({ n: 0, predicted: 0, ran: 0, stolen: 0, guesses: {} });
const bins: Record<string, Tally> = {};
const byIce: Record<string, Tally> = {};
const byAdvanced: Record<string, Tally> = {};
const hq: Record<string, Tally> = {};
const add = (t: Record<string, Tally>, key: string, predicted: number, ran: boolean, stolen: boolean, guesses: Record<string, number> = {}) => {
  const x = (t[key] ??= tally());
  for (const [g, p] of Object.entries(guesses)) x.guesses![g] = (x.guesses![g] ?? 0) + p;
  x.n++;
  x.predicted += predicted;
  if (ran) x.ran++;
  if (stolen) x.stolen++;
};
const BIN = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6, 1.01];
const binOf = (p: number) => {
  const top = BIN.find(b => p < b) ?? 1.01;
  const i = BIN.indexOf(top);
  return `${i === 0 ? 0 : BIN[i - 1]}-${Math.min(1, top)}`;
};

type Watch = { id: string; server: string; predicted: number; guesses: Record<string, number>; ice: string; advanced: number };
const watchRemotes = (s: GameState): Watch[] =>
  Object.values(s.corp.servers)
    .filter(v => v.isRemote)
    .flatMap(v =>
      v.root
        .filter(c => cardDef(c).type_code === 'agenda')
        .map(c => ({
          id: c.instanceId,
          server: v.id,
          predicted: stealOdds(s, v.id),
          guesses: Object.fromEntries(Object.entries(GUESSES).map(([k, f]) => [k, f(s, v.id)])),
          ice: `${v.ice.filter(i => i.isRezzed).length}/${v.ice.length}`,
          advanced: c.advancementCounters,
        })),
    );

let seed = 1000;
let pairing = 0;
let deal = 0;
const stride = Math.max(10, games);
for (const c of DECKS.filter(d => d.side === 'corp')) for (const r of DECKS.filter(d => d.side === 'runner')) {
  pairing++;
  for (let g = 0; g < games; g++) {
    seed = 1000 + (pairing - 1) * stride + g + 1;
    if (deal++ % shards !== shard) continue;
    const agent = (side: 'corp' | 'runner') =>
      (side === 'runner' && old ? old.createAgent : createAgent)(side, level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {});
    const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: agent('corp'), runner: agent('runner') });
    let watch: Watch[] = [];
    let hqAgendas: string[] = [];
    try {
      for (let steps = 0; steps < 4000 && gr.state.turnNumber <= 80; steps++) {
        const before = gr.state;
        if (!gr.step()) break;
        const after = gr.state;
        if (before.activePlayer !== 'runner' && after.activePlayer === 'runner') {
          watch = watchRemotes(after);
          hqAgendas = after.corp.hq.filter(h => cardDef(h).type_code === 'agenda').map(h => h.instanceId);
        }
        if (before.activePlayer === 'runner' && after.activePlayer !== 'runner' && !before.activeRun) {
          const stolen = new Set(after.runner.scoreArea.map(x => x.instanceId));
          const ranOn = new Set(before.runsThisTurn.map(run => run.server));
          for (const w of watch) {
            const ran = ranOn.has(w.server);
            const y = stolen.has(w.id) ? 1 : 0;
            for (const [g, p] of Object.entries(w.guesses)) brier[g] += (p - y) ** 2;
            add(bins, binOf(w.predicted), w.predicted, ran, !!y, w.guesses);
            add(byIce, w.ice, w.predicted, ran, !!y, w.guesses);
            add(byAdvanced, String(Math.min(3, w.advanced)), w.predicted, ran, !!y, w.guesses);
          }
          if (hqAgendas.length) add(hq, String(Math.min(3, hqAgendas.length)), 0, ranOn.has('hq'), hqAgendas.some(id => stolen.has(id)));
          watch = [];
          hqAgendas = [];
        }
      }
    } catch (err) {
      console.error(`deal ${seed}: ${err}`);
    }
  }
}
console.log(JSON.stringify({ bins, byIce, byAdvanced, hq, brier }));
