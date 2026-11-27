/**
 * R-80's check (brief r79-alarm-after-game.md): on the current tree, is every value the three boards' caches serve the
 * value worked out fresh on the asking board? Plays deals through lossLog.ts playLogged, as a batch shard does (the
 * deals before it in its shard first), with the on-hit audits on: handValues' deck average (drawAudit) and click map
 * (clickAudit), effectValues' damage threats (threatsAudit), and the root deck average (deckAvgStats.audit). Each audit
 * works a served value out again and counts a mismatch; the served value is still the one returned.
 *
 * Per deal: the counts over the whole game, and at the agent answer named in AT (the old board's answer) the audits'
 * counts within that answer.
 *
 *   npx vite-node scripts/runner-rework/r79/r80-audit.ts            (the three boards: g3 1303, g1 2231 and 2161)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createInitialGameState } from '../../../src/core';
import { deckGameSetup } from '../../../src/data/decks';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { createAgent } from '../../../src/ai';
import { valueLoops } from '../../../src/ai/valueModel';
import { clickAudit, deckAvgStats, drawAudit } from '../../../src/ai/handValues';
import { threatsAudit } from '../../../src/ai/effectValues';
import { playLogged } from '../../lossLog';

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const decksOf = (seed: number) => {
  const p = Math.floor((seed - 1001) / 10);
  return { c: corpDecks[Math.floor(p / runnerDecks.length)], r: runnerDecks[p % runnerDecks.length] };
};
/** The boards: the deal, the deals before it in its batch shard, and the board's turn (and old answer or step index) */
const BOARDS = [
  { name: 'g3 1303 T12', seeds: [1092, 1303], turn: 12 },
  { name: 'g1 2231 T2', seeds: [1591, 2231], turn: 2 },
  { name: 'g1 2161 T13', seeds: [1521, 2161], turn: 13 },
];
drawAudit.on = clickAudit.on = threatsAudit.on = deckAvgStats.audit = true;
const snap = () => ({
  draw: [drawAudit.checked, drawAudit.mismatches],
  click: [clickAudit.checked, clickAudit.mismatches],
  threats: [threatsAudit.checked, threatsAudit.mismatches],
  rootAvg: [deckAvgStats.checked, deckAvgStats.mismatches],
});
const minus = (a: ReturnType<typeof snap>, b: ReturnType<typeof snap>) =>
  Object.fromEntries(Object.keys(a).map(k => [k, { checked: (a as any)[k][0] - (b as any)[k][0], mismatches: (a as any)[k][1] - (b as any)[k][1] }]));

for (const board of BOARDS) {
  for (const seed of board.seeds) {
    const { c, r } = decksOf(seed);
    valueLoops.clear();
    const before = snap();
    let atTurn: ReturnType<typeof snap> | null = null;
    let turnStart: ReturnType<typeof snap> | null = null;
    const wrap = (agent: any) =>
      new Proxy(agent, {
        get(t, p) {
          const f = t[p];
          if (typeof f !== 'function' || !['chooseAction', 'chooseRez', 'chooseOffTurn'].includes(String(p))) return f;
          return (state: any, ...rest: any[]) => {
            if (state.turnNumber === board.turn && !turnStart) turnStart = snap();
            const a = f.call(t, state, ...rest);
            if (state.turnNumber === board.turn) atTurn = snap();
            return a;
          };
        },
      });
    const start = createInitialGameState(deckGameSetup(seed, c, r));
    const rec = playLogged(start, { corp: wrap(createAgent('corp', 'normal', {})), runner: wrap(createAgent('runner', 'normal', {})) }, { corp: c.name, runner: r.name });
    if (seed !== board.seeds[board.seeds.length - 1]) continue;
    console.log(
      JSON.stringify({
        board: board.name,
        seed,
        winner: `${rec.winner} T${rec.turns}`,
        game: minus(snap(), before),
        [`turn ${board.turn}`]: atTurn && turnStart ? minus(atTurn, turnStart) : 'not reached',
        drawErrors: drawAudit.errors.slice(0, 5),
        threatErrors: threatsAudit.errors.slice(0, 5),
      })
    );
  }
}
