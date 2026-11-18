// The time of the stealth spend in the hold walk (review of ai-hold-stealth, R2): at d72502f Walk.pay tried every number
// of stealth credits a payment may take, so the walk's states multiplied by the stealth credits left; it now pays in
// spendCredits' fixed order (the R2 ruling). Built boards in the style of
// gate-time's slow rows (below), each with Corsair (whose plans have a stealth part) and Touchstone holding 0, 3, 6, 7 or
// 8, the Runner at $3 with 4 clicks. Per board, median of 3: the hold count of the remote
// on the Runner's turn, fresh (no cache), and the Corp's whole decision (caches cleared). Run in each tree:
//   TREE=branch npx vite-node scripts/stage-d/stealth-time.ts
import { GameState } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { createAgent } from '../../src/ai';
import { serverHold } from '../../src/ai/corp/hold';
import { asSide, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { clearCaches } from '../stage-a/harness';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';

// A: six ice, four breakers. B: gate-time's row 21 worst case (trash-repeat.ts: four ice, five programs, 1.5 s on beta)
// with Corsair and Touchstone added
const BOARDS: Record<string, { ice: [string, boolean][]; rig: string[] }> = {
  A: { ice: [['30072', true], ['30039', true], ['30063', false], ['30038', true], ['30074', false], ['30072', true]], rig: ['36004', '30026', '30016', '30015'] },
  B: { ice: [['34044', false], ['35041', false], ['34100', false], ['34110', false]], rig: ['30026', '30016', '30016', '30015', '30006', '36004'] },
};
// The same without Corsair (no plan with a stealth part: no sample deck holds Corsair; vp-sourdough-starter holds Touchstone
// and Methuselah with Unity, Principia, Echelon, Azimat, Baker and Rising Tide)
BOARDS.A0 = { ...BOARDS.A, rig: BOARDS.A.rig.filter(c => c !== '36004') };
BOARDS.B0 = { ...BOARDS.B, rig: BOARDS.B.rig.filter(c => c !== '36004') };
// A0 with Whitespace (its loss of 3) swapped for a Palisade: nothing on the way would make a kept stealth credit better
BOARDS.A1 = { ...BOARDS.A0, ice: BOARDS.A0.ice.map(([c, r]) => (c === '30074' ? ['30072', r] : [c, r])) };
// Lycian (its loss of 1) and Whitespace are the loss in B0 and A0: where a split searched over the stealth credits spent
// cost up to 3.1x (d72502f); the walk now pays in the engine's fixed order (Walk.pay), with no split
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1];

function board(name: string, touch: number): GameState {
  const { ice: ICE, rig: RIG } = BOARDS[name];
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.turnNumber = 7;
  s.corp.credits = 25;
  for (const [code, rezzed] of ICE) installIceForTest(s, code, 'remote1', rezzed);
  for (const code of RIG) installProgramForTest(s, code);
  const t = createCardInstance(s, '36021');
  t.isRezzed = true;
  t.tokens = { credit: touch };
  s.runner.rig.hardware.push(t);
  s.runner.grip = s.runner.grip.slice(0, 5);
  s.runner.credits = 3;
  s.runner.maxClicks = 4;
  s.corp.servers.remote1.root.push(createCardInstance(s, '30036'));
  return s;
}

for (const name of Object.keys(BOARDS)) for (const touch of [0, 3, 6, 7, 8]) {
  const s = board(name, touch);
  const hold: number[] = [];
  const decide: number[] = [];
  let answer = '';
  for (let k = 0; k < 3; k++) {
    const c = structuredClone(s);
    let t = performance.now();
    const h = withPricing({ anchor: null }, () => asSide('corp', () => (decisionContext(c, 'corp'), serverHold(c, 'remote1', { when: 'runnerTurn' }))));
    hold.push(performance.now() - t);
    answer = `holds=${h.holds} need=${h.need} budget=${h.budget}`;
    clearCaches();
    t = performance.now();
    createAgent('corp', 'normal').chooseAction(structuredClone(s));
    decide.push(performance.now() - t);
  }
  console.log(JSON.stringify({ tree: process.env.TREE, board: name, touchstone: touch, holdMs: Math.round(median(hold) * 10) / 10, decisionMs: Math.round(median(decide)), answer }));
}
