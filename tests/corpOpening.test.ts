import { describe, expect, it } from 'vitest';
import { GameAction, createCardInstance, getCardDefinition } from '../src/core';
import { answerPrompt } from '../src/ai/prompts';
import { HeuristicCorpAI } from '../src/ai';
import { installForTest, installIceForTest, newGame, newGameAtSetup } from './helpers';

const PALISADE = '30072'; // barrier, rez 3
const BALLISTA = '30062'; // sentry, rez 5
const FILLER = '30027'; // any non-ice card

/** The Corp's opening hand, replaced by these cards. */
function openingHand(codes: string[]) {
  const state = newGameAtSetup(4);
  state.corp.hq = codes.map(code => createCardInstance(state, code));
  return state;
}

const mulligans = (codes: string[]) => {
  const action = answerPrompt(openingHand(codes), 'corp', undefined, true) as Extract<GameAction, { type: 'RESOLVE_PROMPT' }>;
  return (action.choice as { mulligan: boolean }).mulligan;
};

describe('Corp AI opening', () => {
  it('redraws a hand whose only ice is too expensive to rez early', () => {
    expect(getCardDefinition(BALLISTA).cost).toBeGreaterThan(4);
    expect(mulligans([BALLISTA, FILLER, FILLER, FILLER, FILLER])).toBe(true);
    expect(mulligans([PALISADE, FILLER, FILLER, FILLER, FILLER])).toBe(false);
  });

  it('ices HQ first while it holds agendas, before any remote', () => {
    const state = newGame();
    const ice = createCardInstance(state, PALISADE);
    const agenda = state.corp.rd.find(c => getCardDefinition(c.cardCode).type_code === 'agenda')!;
    state.corp.hq = [ice, agenda];
    state.corp.credits = 6;
    const ranked = new HeuristicCorpAI({ synergy: true }).rankMainActions(state);
    const best = ranked.find(r => r.action.type === 'INSTALL_CARD' && r.action.cardInstanceId === ice.instanceId)!;
    expect(best.action).toMatchObject({ targetServerId: 'hq' });
  });

  it("puts ice the Runner can't get through on R&D rather than an empty remote", () => {
    const state = newGame();
    installIceForTest(state, PALISADE, 'rd');
    installIceForTest(state, PALISADE, 'hq');
    installForTest(state, 'asset', 'remote1');
    const ice = createCardInstance(state, PALISADE); // no breaker installed: it stops this Runner
    state.corp.hq = [ice];
    state.corp.credits = 10;
    const ranked = new HeuristicCorpAI({ synergy: true }).rankMainActions(state);
    const installs = ranked.filter(r => r.action.type === 'INSTALL_CARD' && r.action.cardInstanceId === ice.instanceId);
    const score = (id: string) => installs.find(r => (r.action as { targetServerId?: string }).targetServerId === id)?.score ?? -Infinity;
    expect(score('rd')).toBeGreaterThan(score('remote1'));
  });
});
