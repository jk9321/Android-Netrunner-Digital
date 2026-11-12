import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, getLegalActions } from '../src/core';
import { HeuristicCorpAI } from '../src/ai';
import { focusRedirect, scoringRemote } from '../src/ai/countedScore';
import { applyPlanOff } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

/**
 * Step 4 G3' (Jeff 01:56Z "ice spread thin"): ice the Corp installs on a remote goes to the scoring remote (the most ice)
 * until it holds by the count, outermost (8.5.11a install cost). Pin: deal 1411 turn 6 (shipped code otherwise): Send a
 * Message sits in remote-1 behind Funhouse and a rezzed Palisade, which the Runner can pay through; the Corp's pick put
 * Whitespace (inst-41) on a new remote. Redirected, it goes on remote-1.
 */
const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/placement-1411-t6-focus.json', import.meta.url), 'utf8'));

describe("step 4 G3': remote ice to the scoring remote (plan.placementFocus)", () => {
  it('sends Whitespace to the iced remote holding Send a Message, not a new remote', () => {
    const s = position();
    const newRemote = getLegalActions(s, 'corp').find(a => a.type === 'INSTALL_CARD' && (a as { cardInstanceId?: string }).cardInstanceId === 'inst-41' && (a as { asNewRemote?: boolean }).asNewRemote) as GameAction;
    expect(newRemote).toBeDefined();
    const out = asSide('corp', () => (decisionContext(s, 'corp'), [scoringRemote(s)?.id, focusRedirect(s, newRemote)] as const));
    expect(out[0]).toBe('remote-1');
    expect(out[1]).toMatchObject({ type: 'INSTALL_CARD', cardInstanceId: 'inst-41', targetServerId: 'remote-1' });
  });

  it('leaves central ice alone', () => {
    const s = position();
    const hq = getLegalActions(s, 'corp').find(a => a.type === 'INSTALL_CARD' && (a as { cardInstanceId?: string }).cardInstanceId === 'inst-41' && (a as { targetServerId?: string }).targetServerId === 'hq') as GameAction;
    expect(hq).toBeDefined();
    expect(asSide('corp', () => (decisionContext(s, 'corp'), focusRedirect(s, hq)))).toBeNull();
  });

  it('the Corp plays the redirect', () => {
    applyPlanOff('placementAdvance,placementInstall,placementBuild');
    try {
      const chosen = new HeuristicCorpAI({ synergy: true }).chooseAction(position()) as { cardInstanceId?: string; targetServerId?: string };
      expect(chosen).toMatchObject({ cardInstanceId: 'inst-41', targetServerId: 'remote-1' });
    } finally {
      applyPlanOff('+placementAdvance,+placementInstall,+placementBuild');
    }
  }, 240_000);
});
