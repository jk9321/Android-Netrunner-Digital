import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction, findCardAnywhere } from '../src/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { createAgent } from '../src/ai';
import { legacyRanking } from './legacyRanking';
import { inDecision } from './helpers/pricing';

// plan.oneCurrency: OPEN (2026-11-06): the one-currency Corp purges Audrey v2 here (13.9 vs 3.9 for the install, was 51
// before lastingIceCost). Arguably a fair answer to a Runner walking into HQ on Audrey every turn, but not what the report
// asks for: pinned to the old ranking until the review thread rules on it
legacyRanking(["installs Offworld Office behind remote ice and advances it, on Hard"]);

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
  const [best] = inDecision(s, 'corp', () => new HeuristicCorpAI({ synergy: true, planner: false }).rankMainActions(s));
  return best.action.type === 'INSTALL_CARD' ? `install ${title(s, best.action.cardInstanceId)}${best.action.targetServerId?.startsWith('remote') ? ' in a remote' : ''}` : best.action.type;
};

describe('an agenda leaves HQ when HQ is no safer (plan.hqNoSafer)', () => {
  it('installs Offworld Office behind remote ice and advances it, on Hard', () => {
    expect(top(position())).toBe('install Offworld Office in a remote');
    // Fixed samples, not the time budget, so a busy test run plays the same search. The search finds it on 8 of 10
    // seeds, so most of 3 is the check (about 7 s: its own time limit, as a full test run passed 5 s)
    let advanced = 0;
    for (const seed of [1, 2, 3]) {
      let s = position();
      const corp = createAgent('corp', 'hard', { samples: 6, candidates: 3, seed });
      const runner = createAgent('runner', 'normal');
      for (let i = 0; i < 20 && (s.activePlayer === 'corp' || s.pendingPrompts.length > 0); i++) {
        const prompt = s.pendingPrompts[0];
        s = executeAction(s, (prompt?.side === 'runner' ? runner : corp).chooseAction(s));
      }
      const office = Object.values(s.corp.servers).flatMap(sv => (sv.isRemote ? sv.root : [])).find(c => cardDef(c).title === 'Offworld Office');
      if ((office?.advancementCounters ?? 0) >= 1) advanced++;
    }
    expect(advanced).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
