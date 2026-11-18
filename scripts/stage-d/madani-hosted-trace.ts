/**
 * Stage D, Madani's hosted programs (count step; brief /mnt/project-files/netrunner-ai/stage-d/madani-hosted/brief.md):
 * the trace of report-40 T5 (Q2) and its one continuation by GameRunner under the arm (Q3).
 *
 * The human game is replayed by this checkout's engine; every question goes to a copy (beta, hosted: makeTrees). At each
 * Corp decision from FROM to TO: the decision of each copy's fresh Normal Corp, and on the Corp's view the hold count of
 * `SERVER` ('runnerTurn' on the Corp's turn and at the Runner's turn start, 'thisRun' at a rez window), with the engine
 * oracle's answer on the same board (scripts/stage-d/hold-oracle.ts, retries on: the turn's truth). Then (CONT=1) from
 * the state before move CONT_AT, the hosted copy's Normal Corp against the beta copy's Normal Runner by GameRunner, the
 * Corp's rez windows offered, to the game's end, with each turn's end marked.
 * Hidden information: the copies are asked on the Corp's view (corpDecisionView); the oracle reads the real board
 * ("measuring only": it never plays the grip, rule of the oracle file).
 *
 *   npx vite-node scripts/stage-d/madani-hosted-trace.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction, wantsStop } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { makeTrees, readArms } from './runner-money-trees';
import { Tree, askAction, askRez, isRezWindow, loadTree } from './rez-follow-lib';
import { oracleGetsIn } from './hold-oracle';

const F = process.env.F ?? 'tests/fixtures/human-games/report-40.json';
const SERVER = process.env.SERVER ?? 'remote-2';
const [FROM, TO] = (process.env.RANGE ?? '66-90').split('-').map(Number);
const CONT_AT = Number(process.env.CONT_AT ?? 67);
process.env.ARMS_FILE ||= 'scripts/stage-d/madani-hosted-arms.json';

type Hold = { holds: boolean; rez: string[] | null; rezCost: number; need: number; budget: number };
const fmt = (h: Hold) => `${h.holds ? 'HOLDS' : 'gets in'} rez[${h.rez ?? ''}] cost ${h.rezCost} need ${Number.isFinite(h.need) ? h.need : 'inf'} budget ${h.budget}`;

function holdOf(t: Tree, real: GameState, opts: Record<string, unknown>): Hold {
  t.clear();
  return t.asSide('corp', () => {
    const v = t.corpDecisionView(structuredClone(real)) as GameState;
    t.decisionContext(v, 'corp');
    return t.serverHold(v, SERVER, opts);
  });
}

/** The oracle on the real board: does some affordable set keep the Runner out ('holds'), or every one let it in. */
function oracleHolds(s: GameState, when: 'runnerTurn' | 'thisRun', mustRez: string[] = []): string {
  const ice = s.corp.servers[SERVER]?.ice ?? [];
  const pos = s.activeRun?.icePosition ?? ice.length;
  const open = ice.filter((c, i) => !c.isRezzed && (when === 'runnerTurn' || i < pos) && !mustRez.includes(c.instanceId));
  const got: string[] = [];
  for (let mask = 0; mask < 1 << open.length; mask++) {
    const set = [...mustRez, ...open.filter((_, i) => mask & (1 << i)).map(c => c.instanceId)];
    const a = oracleGetsIn(s, SERVER, when, set, undefined, 200_000, when === 'runnerTurn');
    got.push(`[${set}]:${a.answer}`);
    if (a.answer === 'holds') return `HOLDS (${got.join(' ')})`;
  }
  return `gets in (${got.join(' ')})`;
}

async function main() {
  const dirs = makeTrees(readArms(), resolve('.mh-trace'));
  const trees: Record<string, Tree> = {};
  for (const t of ['beta', 'hosted']) trees[t] = await loadTree(t, dirs[t]);
  const report = JSON.parse(readFileSync(F, 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const moves = report.moves as GameAction[];
  const t = (c: { cardCode: string }) => cardDef(c as never).title;
  let contStart: GameState | null = null;
  for (let k = 0; k < moves.length && k <= TO; k++) {
    if (k === CONT_AT) contStart = structuredClone(s);
    if (k >= FROM && !s.winner) {
      const run = s.activeRun;
      const line = [`move ${k} T${s.turnNumber} ${s.activePlayer} corp $${s.corp.credits} clicks ${s.corp.clicks} | runner $${s.runner.credits} clicks ${s.runner.clicks}${run ? ` | run ${run.server} pos ${run.icePosition} ${run.phase}` : ''}`, `  recorded: ${JSON.stringify(moves[k])}`];
      const corpActs = s.activePlayer === 'corp' && !s.priority && !s.pendingPrompts.length && s.corp.clicks > 0;
      const rezWin = isRezWindow(s, wantsStop);
      const turnStart = s.activePlayer === 'runner' && !run && s.runner.clicks === s.runner.maxClicks;
      if (corpActs || rezWin || turnStart) {
        const when = rezWin ? 'thisRun' : 'runnerTurn';
        for (const name of ['beta', 'hosted']) {
          const tr = trees[name];
          const pick = rezWin ? askRez(tr, s) : corpActs ? askAction(tr, s) : { a: '-', ms: 0 };
          const h = rezWin ? holdOf(tr, s, { when: 'thisRun', mustRez: [], further: true }) : holdOf(tr, s, { when: 'runnerTurn', corpCredits: s.corp.credits });
          const hw = rezWin ? holdOf(tr, s, { when: 'thisRun', mustRez: [s.corp.servers[SERVER].ice[run!.icePosition!]?.instanceId].filter(Boolean), further: true }) : null;
          line.push(`  ${name}: ${when} ${fmt(h)}${hw ? ` | with the approached ice ${fmt(hw)}` : ''} | pick ${pick.a} (${Math.round(pick.ms)} ms)`);
        }
        line.push(`  oracle (real board): ${oracleHolds(s, when)}`);
      }
      const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
      const mad = rig.find(c => c.cardCode === '35028');
      if (mad) line.push(`  madani hosts [${(mad.hostedCards ?? []).map(c => `${t(c)} ${c.instanceId}`)}]; rig ${rig.map(c => `${t(c)}${c.hostedOnId ? '@' + c.hostedOnId : ''}`)}; ${SERVER} ice ${(s.corp.servers[SERVER]?.ice ?? []).map(c => `${t(c)} ${c.instanceId}${c.isRezzed ? '*' : ''}`)}`);
      console.log(line.join('\n'));
    }
    s = executeAction(s, moves[k]);
  }
  if (process.env.CONT !== '0' && contStart) {
    for (const corp of ['beta', 'hosted']) {
      const c = trees[corp];
      c.clear();
      trees.beta.clear();
      const g = new c.GameRunner(structuredClone(contStart), { corp: c.createAgent('corp', 'normal'), runner: trees.beta.createAgent('runner', 'normal') });
      let last = g.state.activePlayer;
      const log: string[] = [];
      for (let n = 0; n < 6000 && !g.state.winner; n++) {
        const b = g.state as GameState;
        if (!g.step()) break;
        const a = g.last as GameAction | null;
        if (a && b.turnNumber <= CONT_AT_TURN(contStart) + 1) log.push(`    ${b.activePlayer} T${b.turnNumber}: ${JSON.stringify(a).slice(0, 150)}`);
        if (g.state.activePlayer !== last) {
          log.push(`  -- ${last} turn ${b.turnNumber} ended: score corp ${g.state.corp.score} runner ${g.state.runner.score}, corp $${g.state.corp.credits}`);
          last = g.state.activePlayer;
        }
      }
      console.log(`CONTINUATION from move ${CONT_AT}, ${corp} Corp v beta Runner: winner ${g.state.winner} at T${g.state.turnNumber}, score ${g.state.corp.score}-${g.state.runner.score}\n${log.slice(0, 160).join('\n')}`);
    }
  }
}
const CONT_AT_TURN = (s: GameState) => s.turnNumber;

main().catch(e => {
  console.error(e);
  process.exit(1);
});
