import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, createCardInstance, findCardAnywhere } from '../src/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { tuning } from '../src/ai/synergy';
import { PAYOUT_RISK, bareAssetRisk } from '../src/ai/cardProfiles';
import { inDecision } from './helpers/pricing';

/**
 * Bug report #16 (Jeff, beta 38b2a86, Wage Working 9 to 5 vs Trick Shot Zahya): the Hard Corp kept installing money
 * assets with no ice in front of them, Zahya trashed nearly every one the next turn, and the Corp stayed broke.
 * plan.readAssetTrash: the bare-asset trash risk follows this Runner's record this game (state.bareAssets, counted by
 * the engine), so a Runner who trashes them all stops getting them, and an empty iced side remote takes them instead.
 *
 * Position: the report's end state moved to a Corp turn: 3 clicks, 6 credits, HQ Otto Campaign, Top-Down Solutions,
 * Nanomanagement, Aggressive Trendsetting; the Runner at 2 points.
 */
function position(record?: { exposed: number; trashed: number }): GameState {
  const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/bug-report-16-end.json', import.meta.url), 'utf8'));
  Object.assign(s, { activePlayer: 'corp', phase: 'corp_turn', activeRun: null, pendingPrompts: [], winner: null, winReason: null, turnStep: undefined, runsThisTurn: [] });
  s.corp.clicks = 3;
  s.corp.credits = 6;
  s.runner.score = 2;
  s.bareAssets = record;
  return s;
}

const title = (s: GameState, id: string) => cardDef(findCardAnywhere(s, id)!).title;
function ranked(s: GameState): string[] {
  return inDecision(s, 'corp', () => new HeuristicCorpAI({ synergy: true, planner: false }).rankMainActions(s)).map(r => {
    const a = r.action;
    if (a.type !== 'INSTALL_CARD') return a.type;
    return `install ${title(s, a.cardInstanceId)} ${a.asNewRemote ? 'new' : a.targetServerId}`;
  });
}
const before = (list: string[], a: string, b: string) => list.indexOf(a) >= 0 && list.indexOf(a) < list.indexOf(b);

describe('the Corp reads how this Runner treats unprotected assets (plan.readAssetTrash)', () => {
  it('the risk moves from the self-play average toward the game record', () => {
    expect(bareAssetRisk(position())).toBe(PAYOUT_RISK.moneyBare);
    expect(bareAssetRisk(position({ exposed: 7, trashed: 6 }))).toBeGreaterThan(0.6);
    expect(bareAssetRisk(position({ exposed: 8, trashed: 0 }))).toBeLessThan(0.1);
  });

  it('Otto Campaign in a new remote beats a click for a credit, until the Runner has trashed 6 of 7 bare assets', () => {
    if (tuning.plan.oneCurrency) {
      // plan.oneCurrency: a bare money asset is priced on its payout at the bare risk (here the self-play 'moneyBare'
      // already puts a bare Otto below a credit; the iced remote-9 is the place for it); the record moves that risk
      const score = (s: GameState, where: string) =>
        inDecision(s, 'corp', () => new HeuristicCorpAI({ synergy: true, planner: false }).rankMainActions(s)).find(r => r.action.type === 'INSTALL_CARD' && title(s, r.action.cardInstanceId) === 'Otto Campaign' && (where === 'new' ? r.action.asNewRemote : r.action.targetServerId === where))!.score;
      expect(score(position(), 'new')).toBeGreaterThan(score(position({ exposed: 7, trashed: 6 }), 'new') + 1);
      expect(before(ranked(position()), 'install Otto Campaign remote-9', 'GAIN_CREDIT')).toBe(true);
      return;
    }
    expect(before(ranked(position()), 'install Otto Campaign new', 'GAIN_CREDIT')).toBe(true);
    expect(before(ranked(position({ exposed: 7, trashed: 6 })), 'install Otto Campaign new', 'GAIN_CREDIT')).toBe(false);
  });

  it('then an empty iced side remote takes it', () => {
    const s = position({ exposed: 7, trashed: 6 });
    // A better-iced empty remote is the scoring remote; Remote 9 (Ablative Barrier) is the side one
    const main = s.corp.servers['remote-9'];
    s.corp.servers['remote-12'] = { ...main, id: 'remote-12', ice: [createCardInstance(s, '34034'), createCardInstance(s, '34034')], root: [] };
    if (tuning.plan.oneCurrency) {
      // plan.oneCurrency: the record prices the bare risk only, so behind ice Otto keeps its worth and the side remote
      // ranks well above a new one (whether above a credit is a few tenths either way here)
      const list = ranked(s);
      expect(before(list, 'install Otto Campaign remote-9', 'install Otto Campaign new')).toBe(true);
      return;
    }
    expect(before(ranked(s), 'install Otto Campaign remote-9', 'GAIN_CREDIT')).toBe(true);
  });
});
