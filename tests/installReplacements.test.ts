import { describe, expect, it } from 'vitest';
import { cardDef, executeAction, GameAction } from '../src/core';
import { giveCard, installIceForTest, installProgramForTest, newGame, putInHand, startRunnerTurn } from './helpers';
import { installedCardsGained, installedCardsLost, isInstallAction, replacementMessage } from '../src/ui/installReplacements';

const PALISADE = '30072';
const CLEAVER = '30006';
const PENNYSHAVER = '30014';
const CARNIVORE = '30003';

/** What the install confirm would ask, or null if the action trashes nothing installed. */
function confirmFor(state: ReturnType<typeof newGame>, action: GameAction): string | null {
  expect(isInstallAction(state, action)).toBe(true);
  const next = executeAction(state, action);
  const lost = installedCardsLost(state, next, action.player);
  return lost.length > 0 ? replacementMessage(installedCardsGained(state, next, action.player), lost) : null;
}

describe('Install replacement confirm', () => {
  it('names the agenda or asset an install replaces in a remote (rules 8.5.6a)', () => {
    let state = newGame();
    const old = putInHand(state, 'corp', 'asset');
    const oldTitle = cardDef(state.corp.hq.find(c => c.instanceId === old)!).title;
    state = executeAction(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: old, asNewRemote: true });
    const remote = Object.values(state.corp.servers).find(s => s.root.some(c => c.instanceId === old))!;
    const agenda = putInHand(state, 'corp', 'agenda');
    const message = confirmFor(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: agenda, targetServerId: remote.id });
    expect(message).toContain(`Installing ${cardDef(state.corp.hq.find(c => c.instanceId === agenda)!).title} will trash this installed card:`);
    expect(message).toContain(`• ${oldTitle} (unrezzed)`);
  });

  it('names each ice chosen to trash first (rules 8.5.6b), and asks nothing for a plain install', () => {
    const state = newGame();
    state.corp.credits = 10;
    installIceForTest(state, PALISADE, 'hq', true);
    const old = installIceForTest(state, PALISADE, 'hq', false);
    const ice = putInHand(state, 'corp', 'ice');
    expect(confirmFor(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: ice, targetServerId: 'hq' })).toBeNull();
    const message = confirmFor(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: ice, targetServerId: 'hq', trashFirst: [old] });
    expect(message).toContain('this installed card');
    expect(message?.match(/•/g)).toHaveLength(1);
    expect(message).toContain('Palisade (unrezzed)');
  });

  it('names the programs trashed to free memory (rules 8.5.6c)', () => {
    const state = newGame();
    startRunnerTurn(state);
    state.runner.credits = 99;
    const old = installProgramForTest(state, CLEAVER);
    const program = putInHand(state, 'runner', 'program');
    const message = confirmFor(state, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: program, trashFirst: [old] });
    expect(message).toContain('• Cleaver');
    expect(message).not.toContain('unrezzed');
  });

  it('names the console a new console replaces', () => {
    let state = newGame();
    startRunnerTurn(state);
    state.runner.credits = 99;
    const penny = giveCard(state, 'runner', PENNYSHAVER);
    state = executeAction(state, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: penny });
    const carnivore = giveCard(state, 'runner', CARNIVORE);
    const message = confirmFor(state, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: carnivore });
    expect(message).toContain('Installing Carnivore will trash this installed card:\n• Pennyshaver');
  });

  it('only checks installs', () => {
    expect(isInstallAction(newGame(), { type: 'GAIN_CREDIT', player: 'corp' })).toBe(false);
  });
});
