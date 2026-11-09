import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { GameRunner, createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

/**
 * plan.plannerHold (Phase 2 O, window supply, opening-audit/report.md). The planner plays each candidate's turn on with
 * the rule ranking, which installs an agenda whenever one can go in, so a remote-ice candidate was always scored with
 * the agenda stuffed behind one unrezzed ice. Batch deal 1491 (corp-losses seeds: 1000 + 10 x pairing + 1), the Corp's
 * turn 1: "ice a new remote" played on as ice the remote, agenda into it, ice HQ (19.22); held, as ice the remote, ice
 * HQ, the asset into a remote of its own (28.90), it beats the old pick, ice on HQ (27.82). The empty iced remote is the
 * next turn's agenda window. Rules: one agenda or asset per remote root (8.5.6a); ice protects the server it is
 * installed on (8.5.4, runs 7.4.1a-d).
 */
const SEED = 1491;

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

const defaultOn = tuning.plan.plannerHold;
afterEach(() => { tuning.plan.plannerHold = defaultOn; });

describe('plan.plannerHold', () => {
  it('deal 1491 turn 1: ice goes on a new remote only when the continuation may hold the agenda', () => {
    const s = position();
    expect(s.corp.hq.some(c => cardDef(c).type_code === 'agenda')).toBe(true);
    expect(Object.values(s.corp.servers).some(sv => sv.isRemote)).toBe(false);
    const pick = (on: boolean) => {
      tuning.plan.plannerHold = on;
      return describeAction(s, createAgent('corp').chooseAction(s));
    };
    expect(pick(false)).toBe('INSTALL_CARD ice @hq');
    expect(pick(true)).toBe('INSTALL_CARD ice @new remote');
  });
});
