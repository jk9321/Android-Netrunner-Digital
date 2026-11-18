/**
 * Stage D, Madani's hosted programs (count step): the two report-51 match-point pins the arm changes
 * (tests/matchPointRez.test.ts #222 and #219). On each board: the run, the ice, the rig, what Madani hosts, then the
 * engine oracle for every affordable set of the unrezzed ice up to the run position, plain (hold-oracle.ts) and extended
 * (madani-hosted-oracle.ts: installs over a full memory, rule 8.5.6c), measuring only, on the real board; then beta's and
 * the arm's hold ('thisRun', the Corp's view) and each tree's rez pick.
 *
 *   npx vite-node scripts/stage-d/madani-hosted-pin51.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { oracleGetsIn } from './hold-oracle';
import { extensionStats, oracleGetsIn as oracleGetsInX } from './madani-hosted-oracle';
import { makeTrees, readArms } from './runner-money-trees';
import { askRez, loadTree } from './rez-follow-lib';

process.env.ARMS_FILE ||= 'scripts/stage-d/madani-hosted-arms.json';

const report = JSON.parse(readFileSync('tests/fixtures/human-games/report-51.json', 'utf8'));
const t = (c: { cardCode: string }) => cardDef(c as never).title;

function at(n: number): GameState {
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const m of (report.moves as GameAction[]).slice(0, n)) s = executeAction(s, m);
  return s;
}

async function main() {
  const dirs = makeTrees(readArms(), resolve('.mh-trace'));
  const trees = { beta: await loadTree('beta', dirs.beta), hosted: await loadTree('hosted', dirs.hosted) };
  for (const n of [219, 222]) {
    const s = at(n);
    const run = s.activeRun!;
    const ice = s.corp.servers[run.server].ice;
    const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
    const mad = rig.find(c => c.cardCode === '35028');
    console.log(`#${n} T${s.turnNumber} corp $${s.corp.credits} runner $${s.runner.credits} score ${s.corp.score}-${s.runner.score} memory ${s.runner.memoryUnitsUsed}/${s.runner.memoryUnitsTotal} run ${run.server} pos ${run.icePosition} ${run.phase}`);
    console.log(`  ice ${ice.map((c, i) => `${i}:${t(c)} ${c.instanceId}${c.isRezzed ? '*' : ''}`).join(', ')}`);
    console.log(`  rig ${rig.map(c => `${t(c)}${c.hostedOnId ? '@' + c.hostedOnId : ''}`).join(', ')}`);
    console.log(`  madani ${mad ? `hosts [${(mad.hostedCards ?? []).map(c => `${t(c)} ${c.instanceId}`)}], install used this turn: ${(s.turnFlags?.[`ability:${mad.instanceId}:1`] ?? 0) > 0}` : 'none'}`);
    const open = ice.filter((c, i) => !c.isRezzed && i <= (run.icePosition ?? ice.length));
    for (let mask = 0; mask < 1 << open.length; mask++) {
      const pick = open.filter((_, i) => mask & (1 << i));
      const set = pick.map(c => c.instanceId);
      const cost = pick.reduce((a, c) => a + (cardDef(c).cost ?? 0), 0);
      if (cost > s.corp.credits) {
        console.log(`  rez [${set}] cost ${cost}: unaffordable`);
        continue;
      }
      const a = oracleGetsIn(s, run.server, 'thisRun', set, undefined, 400_000);
      const x = oracleGetsInX(s, run.server, 'thisRun', set, undefined, 400_000);
      console.log(`  rez [${set}] cost ${cost}: plain oracle ${a.answer} (work ${a.work}) | extended oracle ${x.answer} (work ${x.work}; ${JSON.stringify(extensionStats)})`);
    }
    const app = ice[run.icePosition!];
    for (const [name, tr] of Object.entries(trees)) {
      for (const mustRez of [[], [app.instanceId]]) {
        tr.clear();
        const h = tr.asSide('corp', () => {
          const v = tr.corpDecisionView(structuredClone(s)) as GameState;
          tr.decisionContext(v, 'corp');
          return tr.serverHold(v, run.server, { when: 'thisRun', mustRez, further: true });
        }) as { holds: boolean; rez: string[] | null; need: number; budget: number };
        console.log(`  ${name} thisRun mustRez [${mustRez}]: ${h.holds ? 'HOLDS' : 'gets in'} rez [${h.rez ?? ''}] need ${h.need} budget ${h.budget}`);
      }
      console.log(`  ${name} pick: ${askRez(tr, s).a}`);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
