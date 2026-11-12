import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { HeuristicCorpAI } from '../src/ai';
import { buildPick } from '../src/ai/countedScore';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

/**
 * Step 4 G3 (spec-step4-placement.md): with an agenda in HQ, no counted line and no remote that holds, the fewest ice
 * installs from HQ that give a remote a line; the first is the counted pick (8.5.11a install cost, 6.9.2b rez).
 * Pin: deal 1411 turn 5 (G0 event, shipped code): Send a Message in HQ, 14 credits, 2 clicks, remote-1 has one unrezzed
 * Funhouse that does not hold against the Runner's budget. The Corp installed Send a Message there and it was stolen.
 * HQ holds Whitespace (inst-41): one ice into a remote gives scoreInTwo a line next turn.
 */
const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/placement-1411-t5.json', import.meta.url), 'utf8'));

describe('step 4 G3: the ice install that makes a remote hold (plan.placementBuild)', () => {
  it('ices a remote for Send a Message before it goes in', () => {
    const s = position();
    const pick = asSide('corp', () => (decisionContext(s, 'corp'), buildPick(s)));
    expect(pick?.type).toBe('INSTALL_CARD');
    const id = (pick as { cardInstanceId: string }).cardInstanceId;
    expect(s.corp.hq.find(c => c.instanceId === id)?.cardCode).toBeDefined();
    expect(id).toBe('inst-41'); // Whitespace
    expect((pick as { targetServerId?: string }).targetServerId).not.toBe('hq'); // a remote before HQ
    const chosen = new HeuristicCorpAI({ synergy: true }).chooseAction(s);
    expect(chosen).toEqual(pick);
  }, 120_000);
});
