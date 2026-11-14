/**
 * PACE and STEAL.run measured on the human games (Jeff, 2026-11-07, after the one-currency round): the saved bug
 * reports (tests/fixtures/human-games/*.json, Jeff's Corp against the Runner AI) are replayed move by move, and each
 * Runner turn is counted the way scripts/pace.ts and scripts/steal-odds.ts count self-play, so the constants in
 * src/ai/effectValues.ts can be read against games a person played.
 *   npx vite-node scripts/human-pace.ts [dir]
 * STEAL.run implied: stealOdds = STEAL.run x passOdds, so stolen / sum(passOdds) over remote agenda turns.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { PACE, STEAL, stealOdds } from '../src/ai/effectValues';
import { applyPlanOff } from '../src/ai/synergy';
applyPlanOff(process.env.PLAN_OFF ?? '');

const dir = process.argv.slice(2).find(a => a !== '--' && !a.startsWith('--')) ?? 'tests/fixtures/human-games';
const kind = (server: string) => (server === 'hq' || server === 'rd' || server === 'archives' ? server : 'remote');
const zero = () => ({ runs: 0, successful: 0 });
const servers: Record<string, { runs: number; successful: number }> = { hq: zero(), rd: zero(), archives: zero(), remote: zero() };
let games = 0;
let runnerTurns = 0;
let agendaEvents = 0;
let rezzes = 0;
let facedownTurns = 0;
let facedownBreach = 0;
let agendaRemoteTurns = 0;
let agendaRemoteRun = 0;
/** Remote agenda turns: the model's steal odds at the Runner's turn start, the pass odds under them, and the steals. */
const steal = { n: 0, predicted: 0, pass: 0, ran: 0, stolen: 0, brier: 0 };
const byIce: Record<string, { n: number; predicted: number; stolen: number }> = {};
const hq = { turns: 0, ran: 0, stolen: 0 };
const rezzedIce = (s: GameState) => Object.values(s.corp.servers).reduce((n, v) => n + v.ice.filter(i => i.isRezzed).length, 0);

for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (!report.moves?.length || report.config.ai !== 'runner') continue;
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  let start: GameState | null = null;
  let watch: { id: string; server: string; predicted: number; ice: string }[] = [];
  let hqAgendas: string[] = [];
  try {
    for (const move of report.moves as GameAction[]) {
      const before = s;
      s = executeAction(s, move);
      rezzes += Math.max(0, rezzedIce(s) - rezzedIce(before));
      if (before.activePlayer !== 'runner' && s.activePlayer === 'runner') {
        start = s;
        watch = Object.values(s.corp.servers)
          .filter(v => v.isRemote)
          .flatMap(v =>
            v.root
              .filter(c => cardDef(c).type_code === 'agenda')
              .map(c => ({ id: c.instanceId, server: v.id, predicted: stealOdds(s, v.id), ice: `${v.ice.filter(i => i.isRezzed).length}/${v.ice.length}` })),
          );
        hqAgendas = s.corp.hq.filter(h => cardDef(h).type_code === 'agenda').map(h => h.instanceId);
      }
      if (before.activePlayer === 'runner' && s.activePlayer !== 'runner' && start) {
        const runs = before.runsThisTurn;
        runnerTurns++;
        for (const run of runs) {
          servers[kind(run.server)].runs++;
          if (run.successful) servers[kind(run.server)].successful++;
        }
        const ranOn = new Set(runs.map(r => r.server));
        const stolen = new Set(s.runner.scoreArea.map(x => x.instanceId));
        const advanced = Object.values(start.corp.servers).filter(v => v.isRemote && v.root.some(c => cardDef(c).type_code === 'agenda' && c.advancementCounters > 0));
        if (advanced.length) {
          agendaRemoteTurns++;
          if (advanced.some(v => ranOn.has(v.id))) agendaRemoteRun++;
        }
        if (start.corp.archives.faceDown.length) {
          facedownTurns++;
          if (runs.some(r => r.server === 'archives' && r.successful)) facedownBreach++;
        }
        for (const w of watch) {
          const y = stolen.has(w.id) ? 1 : 0;
          steal.n++;
          steal.predicted += w.predicted;
          // open remotes are a sure steal (plan.openSteal) and carry no STEAL.run factor
          steal.pass += w.predicted >= 1 ? 0 : w.predicted / STEAL.run;
          if (ranOn.has(w.server)) steal.ran++;
          steal.stolen += y;
          steal.brier += (w.predicted - y) ** 2;
          const b = (byIce[w.ice] ??= { n: 0, predicted: 0, stolen: 0 });
          b.n++;
          b.predicted += w.predicted;
          b.stolen += y;
        }
        if (hqAgendas.length) {
          hq.turns++;
          if (ranOn.has('hq')) hq.ran++;
          if (hqAgendas.some(id => stolen.has(id))) hq.stolen++;
        }
        start = null;
      }
    }
  } catch (err) {
    console.error(`${file}: ${err}`);
    continue;
  }
  games++;
  agendaEvents += s.corp.scoreArea.length + s.runner.scoreArea.length;
}

const total = Object.values(servers).reduce((n, v) => n + v.runs, 0);
const ok = Object.values(servers).reduce((n, v) => n + v.successful, 0);
const f = (x: number, d = 2) => x.toFixed(d);
console.log(`${games} games, ${runnerTurns} Runner turns, ${total} runs`);
console.log('PACE           measured  model');
console.log(`runs a turn    ${f(total / runnerTurns)}      ${f(PACE.runs)}`);
console.log(`success        ${f(ok / total)}      ${f(PACE.success)}`);
for (const k of ['hq', 'rd', 'archives', 'remote'] as const) {
  const model = { hq: PACE.hqShare, rd: PACE.rdShare, archives: PACE.archivesShare, remote: PACE.remoteShare }[k];
  console.log(`${(k + ' share').padEnd(15)}${f(servers[k].runs / total)}      ${f(model)}   (success ${f(servers[k].successful / Math.max(1, servers[k].runs))})`);
}
console.log(`agenda events  ${f(agendaEvents / runnerTurns)}      ${f(PACE.agendaEvents)}  (a Runner turn)`);
console.log(`ice rezzes     ${f(rezzes / runnerTurns)}      ${f(PACE.rezzes)}`);
console.log(`facedown breach ${f(facedownBreach / Math.max(1, facedownTurns))}     ${f(PACE.facedownBreach)}  (${facedownTurns} turns)`);
console.log(`advanced remote run ${f(agendaRemoteRun / Math.max(1, agendaRemoteTurns))}  (${agendaRemoteTurns} turns; AGENDA_RUN 0.4)`);
console.log(`STEAL: ${steal.n} remote agenda turns, ran ${steal.ran}, stolen ${steal.stolen}, predicted ${f(steal.predicted, 1)}, Brier ${f(steal.brier / Math.max(1, steal.n), 3)}`);
console.log(`STEAL.run implied ${f(steal.pass ? (steal.stolen - watchOpen()) / steal.pass : 0)} (model ${f(STEAL.run)})`);
for (const [k, b] of Object.entries(byIce).sort()) console.log(`  rezzed/ice ${k}: ${b.n} turns, predicted ${f(b.predicted, 1)}, stolen ${b.stolen}`);
console.log(`HQ with agendas: ${hq.turns} turns, ran HQ ${hq.ran}, stole from HQ ${hq.stolen}`);

/** Steals from open remotes, which carry no STEAL.run factor (counted in byIce '0/0'). */
function watchOpen(): number {
  return byIce['0/0']?.stolen ?? 0;
}
