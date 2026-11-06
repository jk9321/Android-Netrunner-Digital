import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, createCardInstance, getCardDefinition } from '../src/core';
import { HeuristicCorpAI, HeuristicRunnerAI } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { newGame, startRunnerTurn } from './helpers';

/**
 * Jeff (2026-11-05): "most cards do nothing sitting there and are meant to be played". A card in hand is worth what
 * it will do once played, discounted for the wait, so holding a card must always be worth less than playing it now
 * (after its click). Where that breaks, the AI holds the card: a held Hedge Fund was counted twice (as a card in HQ
 * and as future credits), so playing it scored below a click for a credit (plan.heldMoney).
 *
 * Guard: every card that gains at least 2 credits more than its cost, with nothing else to set up first, must rank
 * above a click for a credit, with just enough credits to play it and with 4 more. Turn 1, a starter hand, 3 or 4
 * clicks: Petty Cash's "not finished an action" holds. Creative Commission loses the clicks left, so it is checked
 * on the last click.
 */
const MONEY: Record<string, string> = {
  '30002': 'Wildcat Strike',
  '30020': 'Creative Commission',
  '30030': 'Sure Gamble',
  '34001': 'Strike Fund',
  '30048': 'Hansei Review',
  '30056': 'Predictive Planogram',
  '30064': 'Government Subsidy',
  '30075': 'Hedge Fund',
  '35055': 'Peer Review',
  '35081': 'Petty Cash',
  '36032': 'Caveat Emptor',
  '36063': 'Vulture Fund',
  '34037': 'Greasing the Palm',
  '34045': 'Mindscaping',
};

function position(code: string, extra: number): { state: GameState; id: string } {
  const def = getCardDefinition(code);
  const state = newGame(3);
  // Value caches key on the game id and card instance ids: each position is its own game
  state.id = `${state.id}-${code}-${extra}`;
  state.turnStep = null;
  state.priority = undefined;
  const card = createCardInstance(state, code);
  if (def.side_code === 'corp') {
    state.corp.hq.push(card);
    state.corp.credits = (def.cost ?? 0) + extra;
  } else {
    startRunnerTurn(state);
    // Room in the grip, so Wildcat Strike's draw 4 isn't discarded
    state.runner.grip = [...state.runner.grip.slice(0, 2), card];
    state.runner.credits = (def.cost ?? 0) + extra;
    if (code === '30020') state.runner.clicks = 1;
  }
  return { state, id: card.instanceId };
}

function scores(code: string, extra: number): { play: number; credit: number } {
  const { state, id } = position(code, extra);
  const corp = getCardDefinition(code).side_code === 'corp';
  const ranked = corp ? new HeuristicCorpAI({ synergy: true, planner: false }).rankMainActions(state) : new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(state);
  const play = ranked.find(r => r.action.type === 'PLAY_OPERATION_OR_EVENT' && r.action.cardInstanceId === id)?.score ?? -Infinity;
  const credit = ranked.find(r => r.action.type === 'GAIN_CREDIT')?.score ?? -Infinity;
  return { play, credit };
}

/**
 * Known gaps (2026-11-05), Runner side; test.fails flags each one once it is fixed, to come off this list:
 * - Wildcat Strike at 2 credits: the Corp picks "draw 4", which leaves the Runner on 0 credits (-1.4 vs 0.1).
 * (Creative Commission on the last click was one until plan.corpTurnDamage, 2026-11-06: the damage clock counted the
 * Corp's damage ice, which can't hit on the Corp's turn.)
 */
const KNOWN_GAPS = new Set(['Wildcat Strike']);

describe('playing a money card scores above holding it and clicking for a credit', () => {
  for (const [code, title] of Object.entries(MONEY)) {
    (KNOWN_GAPS.has(title) ? it.fails : it)(title, () => {
      expect(cardDef({ cardCode: code } as never).title).toBe(title);
      for (const extra of [0, 4]) {
        const { play, credit } = scores(code, extra);
        expect(play, `${title} with ${extra} spare credits: play ${play.toFixed(2)} vs credit click ${credit.toFixed(2)}`).toBeGreaterThan(credit);
      }
    });
  }
});

/**
 * The self-play position where the bug showed (deal 1101, the Corp's turn 1: 5 credits, HQ Tithe, Government Subsidy,
 * Hedge Fund, Sprint, Predictive Planogram, Seamless Launch). Before plan.heldMoney, Hedge Fund -0.1, a click for a
 * credit 0.7. The starter positions above don't show it: here the Corp also holds Government Subsidy, and moneyReach
 * prices Hedge Fund as half its gain on a steeper part of the credit slide.
 */
describe('a held Hedge Fund in self-play (plan.heldMoney)', () => {
  const ranks = () => {
    const state: GameState = JSON.parse(readFileSync(new URL('./fixtures/held-hedge-fund.json', import.meta.url), 'utf8'));
    const ranked = new HeuristicCorpAI({ synergy: true, planner: false }).rankMainActions(state);
    const hf = state.corp.hq.find(c => cardDef(c).title === 'Hedge Fund')!;
    const play = ranked.find(r => r.action.type === 'PLAY_OPERATION_OR_EVENT' && r.action.cardInstanceId === hf.instanceId)!.score;
    const credit = ranked.find(r => r.action.type === 'GAIN_CREDIT')!.score;
    return { play, credit };
  };

  it('ranks playing it above a click for a credit', () => {
    const { play, credit } = ranks();
    expect(play).toBeGreaterThan(credit);
  });

  it('without the plan it ranks below', () => {
    tuning.plan.heldMoney = false;
    try {
      const { play, credit } = ranks();
      expect(play).toBeLessThan(credit);
    } finally {
      tuning.plan.heldMoney = true;
    }
  });
});
