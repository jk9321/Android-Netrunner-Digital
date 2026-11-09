import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { GameRunner, createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { REPLY } from '../src/ai/runnerReply';
import { buildsWindow, plannerStats, readyRemotes } from '../src/ai/turnPlanner';
import fixture from './fixtures/search-hold-no-window.json';
import robust from './fixtures/search-hold-window-robust.json';

/**
 * plan.searchLines (spec-search S2): the planner's hold line (no agenda installed from HQ this turn) stands only when it
 * beats the rule line by more than the reply's noise AND it builds a window: a remote with ice the Corp has rezzed or can
 * pay to rez, no agenda or asset in its root (one per remote root, rule 8.5.6a; ice protects its server, 8.5.4), not
 * ready when the decision began. Holding without building one is the hoarding plannerHold produced (stuck in HQ +7.7).
 */
const SEED = 1491;

function turnOne(): GameState {
  const corp = ALL_DECKS.filter(d => d.side === 'corp');
  const runner = ALL_DECKS.filter(d => d.side === 'runner');
  const pairing = (SEED - 1001) / 10;
  const gr = new GameRunner(createInitialGameState(deckGameSetup(SEED, corp[Math.floor(pairing / runner.length)], runner[pairing % runner.length])), { corp: createAgent('corp'), runner: createAgent('runner') });
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

const saved = { hold: tuning.plan.plannerHold, lines: tuning.plan.searchLines, samples: tuning.plan.searchSamples };
afterEach(() => {
  tuning.plan.plannerHold = saved.hold;
  tuning.plan.searchLines = saved.lines;
  tuning.plan.searchSamples = saved.samples;
});

const choose = (s: GameState, hold: boolean, lines: boolean) => {
  tuning.plan.plannerHold = hold;
  tuning.plan.searchLines = lines;
  return createAgent('corp').chooseAction(structuredClone(s));
};
const pick = (s: GameState, hold: boolean, lines: boolean) => describeAction(s, choose(s, hold, lines));
const exact = (s: GameState, hold: boolean, lines: boolean) => JSON.stringify(choose(s, hold, lines));

describe('plan.searchLines', () => {
  it('is off by default (and S3 searchSamples)', () => {
    expect(saved.lines).toBe(false);
    expect(saved.samples).toBe(false);
  });

  it('S3 searchSamples at deal 1491 T1: a close call, both lines get the extra samples, the pick is the better mean', () => {
    const calls: Parameters<NonNullable<typeof plannerStats.onClose>>[] = [];
    plannerStats.onClose = (top, chosen) => calls.push([top, chosen]);
    try {
      tuning.plan.searchSamples = true;
      const s = turnOne();
      const chosen = choose(s, false, true);
      expect(calls.length).toBe(1);
      const [top, picked] = calls[0];
      expect(top.length).toBe(2);
      expect(Math.abs(top[0].first - top[1].first)).toBeLessThan(3);
      for (const t of top) expect(t.samples).toBe(2 + REPLY.extra);
      expect(top.some(t => t.held)).toBe(true);
      const better = top.reduce((a, b) => (b.value > a.value ? b : a));
      expect(picked).toBe(better.action);
      expect(chosen).toEqual(better.action);
    } finally {
      plannerStats.onClose = undefined;
    }
  }, 60000);

  // Not pinned: deal 1491 T1 with S3 on. The held new-remote line (28.90) and ice on a central (27.82) are within
  // SEARCH.margin, and on 4 or 8 reply samples the central wins (s2-report.md, S3 section): T1's remote is a close call.
  it('S3 searchSamples on top: a hold without a window still does not flip the pick (1491 T2)', () => {
    const s = fixture.state as unknown as GameState;
    tuning.plan.searchSamples = false;
    const plain = exact(s, false, false);
    tuning.plan.searchSamples = true;
    expect(exact(s, false, true)).toBe(plain);
  }, 120000);

  // A MECHANISM test for S2 alone (searchSamples off): the held, window-building line can stand. Not "the right move":
  // the held new-remote line (28.90) and ice on a central (27.82) are within SEARCH.margin, and on 4 or 8 reply samples
  // the central ice wins at this position (s2-report.md, S3 section; AI Coordinator ruling 2026-11-09).
  it('deal 1491 turn 1, S2 alone: the held line that ices a new remote can stand (the held line builds the window)', () => {
    const s = turnOne();
    expect(s.corp.hq.some(c => cardDef(c).type_code === 'agenda')).toBe(true);
    expect(readyRemotes(s).size).toBe(0);
    expect(pick(s, false, false)).toBe('INSTALL_CARD ice @hq');
    expect(pick(s, false, true)).toBe('INSTALL_CARD ice @new remote');
  }, 60000);

  it('deal 1491 turn 2: a hold that only sits on the agenda (ice on R&D, no window built) does not flip the pick', () => {
    const s = fixture.state as unknown as GameState;
    expect(s.corp.hq.some(c => cardDef(c).type_code === 'agenda')).toBe(true);
    const plain = exact(s, false, false);
    // plannerHold's best-of-two takes the held line here (a different ice onto R&D, the agenda kept in HQ)
    expect(exact(s, true, false)).not.toBe(plain);
    expect(exact(s, false, true)).toBe(plain);
  }, 60000);

  // The robust pin (AI Coordinator 2026-11-09: a hold that still wins on 8 reply samples). scripts/search-holds.ts
  // DUMP=accepted over 48 games gave 39 accepted holds; scripts/search-robust.ts re-read them on 8 samples: 34 still beat
  // their rule line by more than SEARCH.margin (median gain 11.9 -> 12.6). Deal 1031, Corp turn 9: off, a Regolith
  // click; on, Brân 1.0 on a new remote for the agenda in HQ (gain 11.0 on 2 samples, 13.2 on 8).
  it('deal 1031 turn 9: ices a new remote for the agenda, and still does on 8 reply samples', () => {
    const s = robust.state as unknown as GameState;
    expect(pick(s, false, false)).toBe('USE_ABILITY asset');
    expect(pick(s, false, true)).toBe('INSTALL_CARD ice @new remote');
    const samples = REPLY.samples;
    try {
      REPLY.samples = 8;
      expect(pick(s, false, true)).toBe('INSTALL_CARD ice @new remote');
    } finally {
      REPLY.samples = samples;
    }
  }, 120000);

  it('a window: iced remote, rezzable, empty root, new since the decision began', () => {
    const s = turnOne();
    const ice = s.corp.hq.find(c => cardDef(c).type_code === 'ice')!;
    const agenda = s.corp.hq.find(c => cardDef(c).type_code === 'agenda')!;
    const end = structuredClone(s);
    end.corp.hq = end.corp.hq.filter(c => c.instanceId !== ice.instanceId);
    end.corp.servers['remote-9'] = { id: 'remote-9', name: 'Remote Server 9', isRemote: true, ice: [{ ...ice, isRezzed: false }], root: [] };
    end.corp.credits = 99;
    expect(buildsWindow(s, end)).toBe(true);
    // Can't pay to rez it: no window
    expect(buildsWindow(s, { ...end, corp: { ...end.corp, credits: 0 } })).toBe(false);
    // The agenda went in after all: nothing held for it
    expect(buildsWindow(s, { ...end, corp: { ...end.corp, hq: end.corp.hq.filter(c => c.instanceId !== agenda.instanceId && cardDef(c).type_code !== 'agenda') } })).toBe(false);
    // Already ready when the decision began: not built this turn
    expect(buildsWindow(end, end)).toBe(false);
  });
});
