import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { GameRunner, createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

/**
 * plan.agendaLine (Phase 2 O2 v2, opening-audit/report.md): agendaWorth charged an advance's click at AGENDA_CLICK 2,
 * so at 8 a point a 1-point agenda cost more to score than it was worth even with no steal risk, and a held agenda
 * (floored at 0) beat any install. At the one click price (CLICK) the agenda line reads higher: batch deal 1771
 * (corp-losses seeds), the Corp's turn 1, the AI ices a new remote for the agenda in HQ instead of a third piece of
 * central ice. Rules: advancing is a click and 1 credit (5.2.6f); one agenda or asset per remote root (8.5.6a).
 */
const SEED = 1771;

function position(): GameState {
  const corp = ALL_DECKS.filter(d => d.side === 'corp');
  const runner = ALL_DECKS.filter(d => d.side === 'runner');
  const pairing = (SEED - 1001) / 10;
  const c = corp[Math.floor(pairing / runner.length)];
  const r = runner[pairing % runner.length];
  const gr = new GameRunner(createInitialGameState(deckGameSetup(SEED, c, r)), { corp: createAgent('corp'), runner: createAgent('runner') });
  for (let i = 0; i < 50; i++) {
    const s = gr.state;
    if (s.activePlayer === 'corp' && s.turnNumber === 1 && s.corp.clicks === 3 && !s.activeRun && s.pendingPrompts.length === 0 && !(s.priority && s.priority.holder !== 'corp') && s.turnStep?.kind !== 'corp_turn_start') return structuredClone(s);
    gr.step();
  }
  throw new Error('Corp turn 1 not reached');
}

const describeAction = (s: GameState, a: GameAction) => {
  const card = 'cardInstanceId' in a && a.cardInstanceId ? findCardAnywhere(s, a.cardInstanceId) : undefined;
  const where = 'asNewRemote' in a && a.asNewRemote ? ' @new remote' : 'targetServerId' in a && a.targetServerId ? ' @' + a.targetServerId : '';
  return `${a.type}${card ? ' ' + cardDef(card).type_code : ''}${where}`;
};

const defaultOn = tuning.plan.agendaLine;
afterEach(() => { tuning.plan.agendaLine = defaultOn; });

describe('plan.agendaLine', () => {
  it('deal 1771 turn 1: ice goes on a new remote only with the agenda line priced at the one click price', () => {
    const s = position();
    expect(s.corp.hq.some(c => cardDef(c).type_code === 'agenda')).toBe(true);
    expect(Object.values(s.corp.servers).some(sv => sv.isRemote)).toBe(false);
    const pick = (on: boolean) => {
      tuning.plan.agendaLine = on;
      return describeAction(s, createAgent('corp').chooseAction(s));
    };
    expect(pick(false)).toBe('INSTALL_CARD ice @hq');
    expect(pick(true)).toBe('INSTALL_CARD ice @new remote');
  });
});
