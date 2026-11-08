import { describe, expect, it } from 'vitest';
import { renderAs } from './seatHelpers';
import { cardDef, createCardInstance, executeAction, findCardAnywhere, getLegalActions, isLegalAction } from '../src/core';
import { memoryLimit } from '../src/core/engine/cardEffects';
import { RunnerActions } from '../src/ui/components/ActionBars';
import { hostedCardActions } from '../src/ui/legal';
import { installProgramForTest, newGame, runnerInstall } from './helpers';

// Bling: "You can play or install hosted cards as if they were in your grip."
// A program needs free MU, but the Runner may trash installed programs first (rules 8.5.6c),
// so a hosted program must get that choice too (GitHub report, Gourmand on Bling with full MU).

const BLING = '35006';
const GOURMAND = '35007';
const LEECH = '30008'; // Leech, a 1 MU virus program

function fullMemoryWithHostedGourmand() {
  const [s, bling] = runnerInstall(newGame(), BLING);
  while (s.runner.memoryUnitsUsed < memoryLimit(s)) installProgramForTest(s, LEECH);
  const gourmand = createCardInstance(s, GOURMAND);
  findCardAnywhere(s, bling)!.hostedCards = [gourmand];
  s.runner.clicks = 3;
  s.runner.credits = 10;
  return { s, gourmand };
}

describe('Bling-hosted program with full memory', () => {
  it('can be installed by trashing an installed program first', () => {
    const { s, gourmand } = fullMemoryWithHostedGourmand();
    expect(cardDef(gourmand).memory_cost).toBeGreaterThan(0);
    const install = { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: gourmand.instanceId } as const;
    expect(isLegalAction(s, install)).toBe(false);
    const leech = s.runner.rig.programs[0];
    const next = executeAction(s, { ...install, trashFirst: [leech.instanceId] });
    expect(next.runner.rig.programs.map(c => c.instanceId)).toContain(gourmand.instanceId);
    expect(next.runner.heap.map(c => c.instanceId)).toContain(leech.instanceId);
  });

  it('shows a "trashing programs first" button for the hosted card', () => {
    const { s, gourmand } = fullMemoryWithHostedGourmand();
    expect(hostedCardActions(s, getLegalActions(s, 'runner')).some(a => 'cardInstanceId' in a && a.cardInstanceId === gourmand.instanceId)).toBe(false);
    const html = renderAs(s, 'runner', seat => <RunnerActions state={seat.state} selectedCard={undefined} onAction={() => {}} />);
    // The seat names cards by the Runner's own ids (core/view.ts)
    expect(html).toMatch(/data-testid="hosted-room-r\d+"/);
    expect(html).toContain('Install hosted Gourmand, trashing programs first');
  });
});
