import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, getLegalActions } from '../src/core';
import { HeuristicCorpAI } from '../src/ai';
import { iceRedirect } from '../src/ai/corp/placement';
import { scoringRemote } from '../src/ai/corp/lines';
import { asSide } from '../src/ai/pricing';
import { inDecision } from '../src/ai/handValues';

/**
 * plan.iceRedirect (step 4 G3'): ice the Corp installs on a remote or a new remote goes to the scoring remote (the most
 * ice) until it holds by the count, outermost; its install cost there is 1 credit per ice already protecting it
 * (8.5.11a). Pin: deal 1001 turn 10, The Syndicate, 15 credits, 2 clicks: remote-1 has a rezzed Palisade and an
 * unrezzed card the Runner can pay through; remote-4 holds a bare Regolith Mining License. The Corp's own pick puts
 * Whitespace (inst-29) on remote-4; redirected, it goes on remote-1.
 */
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const position = () => read('ice-redirect-1001-t10.json');
const installs = (s: GameState, id: string) => getLegalActions(s, 'corp').filter(a => a.type === 'INSTALL_CARD' && (a as { cardInstanceId?: string }).cardInstanceId === id) as (GameAction & { targetServerId?: string; asNewRemote?: boolean })[];
const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => inDecision(s, 'corp', () => f()));

describe('plan.iceRedirect: remote ice to the scoring remote', () => {
  it('sends Whitespace to remote-1, the scoring remote, from remote-4 or a new remote', () => {
    const s = position();
    expect(inCorp(s, () => scoringRemote(s)?.id)).toBe('remote-1');
    for (const pick of installs(s, 'inst-29').filter(a => a.targetServerId === 'remote-4' || a.asNewRemote))
      expect(inCorp(s, () => iceRedirect(s, pick))).toMatchObject({ type: 'INSTALL_CARD', cardInstanceId: 'inst-29', targetServerId: 'remote-1' });
  });

  it('leaves central ice alone', () => {
    const s = position();
    const hq = installs(s, 'inst-29').find(a => a.targetServerId === 'hq')!;
    expect(hq).toBeDefined();
    expect(inCorp(s, () => iceRedirect(s, hq))).toBeNull();
  });

  // Before the redirect both Corps put it on remote-4 (checked with the temporary switch off before the fold, 7e82679)
  // 'the Normal and the Hard Corp play it' (deal 1001 T10): rewritten as ruled (c0-rulings 12:50Z): the order's first
  // candidate is the line-2 Whitespace on remote-1 (tests/corpCandidates.test.ts), and with the look-ahead the Corp plays the
  // Regolith click (known-failing, tests/stageDPins.test.ts 'Stage C, deal 1001 T10')

  it("keeps a two-turn line's own ice where the line puts it (deal 1411 turn 6: Whitespace on a new remote for Orbital Superiority)", () => {
    const chosen = new HeuristicCorpAI({ synergy: true }).chooseAction(read('ice-redirect-1411-t6.json'));
    expect(chosen).toMatchObject({ cardInstanceId: 'inst-41', asNewRemote: true });
  }, 240_000);
});
