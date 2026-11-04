import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction, findCardAnywhere } from '../src/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { createAgent } from '../src/ai';
import { asSide, tuning } from '../src/ai/synergy';

/**
 * Bug report #15 (Jeff, beta 777fe61, You May Fire When Ready vs Kessleroid Isn't Real): the Hard Corp held Offworld
 * Office in HQ all game. plan.exposure kept agendas out of any remote with less than 2 real layers, while the Runner
 * walked through HQ's Whitespace and Flyswatter with Audrey v2 and Botulus every turn and stole from HQ anyway.
 *
 * Position: the start of the Corp's turn 10, rebuilt from the report (the turn's actions undone): 9 credits, 3 clicks,
 * HQ two Offworld Office, Brân 1.0, Jaguarundi, Hedge Fund, Measured Response, Greasing the Palm; Jaguarundi and
 * Ablative Barrier (unrezzed) alone on Remotes 1 and 2; the Runner (8 credits) got into HQ last turn.
 */
function position(): GameState {
  return JSON.parse(readFileSync(new URL('./fixtures/bug-report-15-turn10.json', import.meta.url), 'utf8'));
}

const title = (s: GameState, id: string) => cardDef(findCardAnywhere(s, id)!).title;
const top = (s: GameState) => {
  const [best] = asSide('corp', () => new HeuristicCorpAI({ synergy: true, planner: false }).rankMainActions(s));
  return best.action.type === 'INSTALL_CARD' ? `install ${title(s, best.action.cardInstanceId)}${best.action.targetServerId?.startsWith('remote') ? ' in a remote' : ''}` : best.action.type;
};

describe('an agenda leaves HQ when HQ is no safer (plan.hqNoSafer)', () => {
  it('installs Offworld Office behind remote ice and advances it, on Hard', () => {
    let s = position();
    expect(top(s)).toBe('install Offworld Office in a remote');
    // Fixed samples, not the time budget, so a busy test run plays the same search
    const corp = createAgent('corp', 'hard', { samples: 6, candidates: 3, seed: 15 });
    const runner = createAgent('runner', 'normal');
    for (let i = 0; i < 20 && (s.activePlayer === 'corp' || s.pendingPrompts.length > 0); i++) {
      const prompt = s.pendingPrompts[0];
      s = executeAction(s, (prompt?.side === 'runner' ? runner : corp).chooseAction(s));
    }
    const office = Object.values(s.corp.servers).flatMap(sv => (sv.isRemote ? sv.root : [])).find(c => cardDef(c).title === 'Offworld Office');
    expect(office?.advancementCounters ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('without the plan the agenda stays in HQ', () => {
    tuning.plan.hqNoSafer = false;
    try {
      expect(top(position())).not.toBe('install Offworld Office in a remote');
    } finally {
      tuning.plan.hqNoSafer = true;
    }
  });
});
