import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';



/**
 * Jeff (2026-11-04): why can't the Corp manage its econ? The batch "Corp went broke" alarm: 60% of the times the Corp
 * fell under 3 credits it had paid to rez ice in the Runner's runs, often with Hedge Fund (5) stuck in HQ.
 * plan.castWhileAble plays a money operation while the Corp can still afford it, when rezzing its ice would strand it.
 *
 * Position: self-play deal 1212 (Discretion Advised vs Shootin' 'n' Lootin'), the Corp's turn 7: 7 credits, Send a
 * Message in a remote behind Pharos and Ansel 1.0, Ansel and Tithe in HQ, Hedge Fund the next card in R&D. Before the fix
 * the Corp played Predictive Planogram instead and ended on 8 credits holding Hedge Fund; the Runner's runs made it rez
 * 6 credits of ice, leaving 2 and Hedge Fund dead.
 *
 * Step 2 (spec-step2-delete-redundant.md): with plan.agendaMoney deleted (off +0.2 ± 0.8 at games=3, went-broke alarm
 * -0.5 ± 1.7) the Corp here follows counted scoring's two-turn line instead: three advances on Send a Message (5/3,
 * finished next turn, rules 1.17.3a, 5.2.6f) and the turn ends on 5 credits, Hedge Fund (cost 5) still castable. The
 * pin is now that the money operation is not stranded: whatever the turn plays, Hedge Fund is played or still affordable.
 */
function play(): GameState {
  let s: GameState = JSON.parse(readFileSync(new URL('./fixtures/broke-hedge-fund.json', import.meta.url), 'utf8'));
  const corp = createAgent('corp', 'normal');
  for (let i = 0; i < 12 && s.activePlayer === 'corp'; i++) s = executeAction(s, corp.chooseAction(s));
  return s;
}
const inHq = (s: GameState) => s.corp.hq.map(c => cardDef(c).title);

describe('a money operation is not stranded by the turn (plan.castWhileAble)', () => {
  it('plays Hedge Fund this turn, or ends the turn able to', () => {
    const s = play();
    if (inHq(s).includes('Hedge Fund')) expect(s.corp.credits).toBeGreaterThanOrEqual(5);
    else expect(s.corp.credits).toBeGreaterThanOrEqual(9);
  }, 30_000);
});
