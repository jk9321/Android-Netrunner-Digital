/** Scratch probe: a human game's moves around a range, with Madani's hosted cards and the board (report-40 T5). */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';

const f = process.env.F ?? 'tests/fixtures/human-games/report-40.json';
const report = JSON.parse(readFileSync(f, 'utf8'));
let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
if (report.startStops) s = { ...s, stops: report.startStops };
console.log('ai', report.config.ai);
const [a, b] = (process.env.R ?? '55-95').split('-').map(Number);
const moves = report.moves as GameAction[];
const t = (c: { cardCode: string }) => cardDef(c as never).title;
for (let k = 0; k < Math.min(b, moves.length); k++) {
  if (k >= a) {
    const m = moves[k];
    const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
    const mad = rig.find(c => c.cardCode === '35028');
    const run = s.activeRun;
    console.log(k, `T${s.turnNumber} ${s.activePlayer} c$${s.corp.credits}/${s.corp.clicks} r$${s.runner.credits}/${s.runner.clicks}`, run ? `run ${run.server} pos ${run.icePosition} ${run.phase}` : '', mad ? `madani[${(mad.hostedCards ?? []).map(t)}]` : '', JSON.stringify(m).slice(0, 170));
  }
  s = executeAction(s, moves[k]);
}
const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
console.log('rig', rig.map(c => `${t(c)}(${c.instanceId})${c.hostedOnId ? '@' + c.hostedOnId : ''}`).join(', '), 'MU', s.runner.memory ?? '');
for (const [id, sv] of Object.entries(s.corp.servers)) console.log(id, sv.ice.map(c => `${t(c)}(${c.instanceId})${c.isRezzed ? '*' : ''}`).join(' '), '| root', sv.root.map(c => `${t(c)}(${c.instanceId})`).join(' '));
