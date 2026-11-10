import { describe, expect, it } from 'vitest';
import { GameState, StopLevel, actingSide, createCardInstance, executeAction, getLegalActions } from '../src/core';
import { answer, newGame, startRunnerTurn } from './helpers';

// The uniform access step (multiplayer phase 2, chunk 2a). Rules 4.2.2 (R&D is hidden from both players) and 7.1.2
// (the Corp may not look at a card accessed from R&D): whether the Runner pauses on an R&D access must not depend on
// the card. Jeff's decision (2026-11-08): the Runner's stops decide, as for paid ability windows. At 'full' every R&D
// access waits for a Continue; at 'ai', 'auto' and 'none' nothing changes.

const HEDGE_FUND = '30075'; // operation
const OFFWORLD = '30067'; // agenda, no steal cost
const MELIES_LINE = '36026'; // Méliès City Luxury Line: costs a click to steal
const NICO = '30037'; // asset with a trash cost

/** A run on `server` with the Runner's stops at `stops`, passed and continued until the Runner has a prompt or the run is over. */
function runOn(server: string, stops: StopLevel, setup: (s: GameState) => void = () => {}, clicks = 4, extraAccesses = 0): GameState {
  let s = newGame(5);
  s.stops = { corp: 'ai', runner: stops };
  setup(s);
  startRunnerTurn(s);
  s.runner.clicks = clicks;
  s.runner.credits = 10;
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: server });
  s.activeRun!.extraAccesses = extraAccesses;
  return toPrompt(s);
}

function toPrompt(s: GameState): GameState {
  for (let i = 0; i < 40 && s.activeRun && s.pendingPrompts.length === 0; i++) {
    const side = actingSide(s)!;
    const action = getLegalActions(s, side).find(a => (a.type === 'PASS' && !a.restOfRun) || a.type === 'CONTINUE_RUN');
    if (!action) throw new Error(`stuck: ${JSON.stringify(s.priority)}`);
    s = executeAction(s, action);
  }
  return s;
}

const onTop = (...codes: string[]) => (s: GameState) => s.corp.rd.unshift(...codes.map(c => createCardInstance(s, c)));
const goOn = (s: GameState) => toPrompt(answer(s, { kind: 'access_trash', trash: false }));

describe('Uniform access step (4.2.2, 7.1.2)', () => {
  it('stops at full: an operation accessed from R&D waits for a Continue that has no trash cost and no alternatives', () => {
    const s = runOn('rd', 'full', onTop(HEDGE_FUND));
    const top = s.corp.rd[0];
    expect(s.pendingPrompts).toEqual([
      expect.objectContaining({ kind: 'access_trash', side: 'runner', cardInstanceId: top.instanceId, trashCost: null, alternatives: [], message: 'Runner: accessing Hedge Fund.' }),
    ]);
    // The only answer: Continue, which finishes the access as before
    const answers = getLegalActions(s, 'runner').filter(a => a.type === 'RESOLVE_PROMPT');
    expect(answers.filter(a => { try { executeAction(s, a); return true; } catch { return false; } })).toEqual([
      expect.objectContaining({ choice: { kind: 'access_trash', trash: false } }),
    ]);
    const t = goOn(s);
    expect(t.activeRun).toBeNull();
    expect(t.corp.rd[0]).toEqual(top);
  });

  it('stops at full: a trashable card gets its usual trash prompt (one stop, like every other R&D card)', () => {
    const s = runOn('rd', 'full', onTop(NICO));
    expect(s.pendingPrompts[0]).toMatchObject({ kind: 'access_trash', trashCost: expect.any(Number) });
  });

  it('stops at full: an agenda with no steal cost waits for Continue first, then is stolen', () => {
    const s = runOn('rd', 'full', onTop(OFFWORLD));
    expect(s.pendingPrompts[0]).toMatchObject({ kind: 'access_trash', trashCost: null, message: 'Runner: accessing Offworld Office.' });
    expect(s.runner.scoreArea).toHaveLength(0);
    const t = goOn(s);
    expect(t.runner.scoreArea.map(c => c.cardCode)).toEqual([OFFWORLD]);
  });

  it('stops at full: an agenda whose steal cost the Runner can pay asks about the cost, with no Continue before it', () => {
    const s = runOn('rd', 'full', onTop(MELIES_LINE));
    expect(s.pendingPrompts[0]).toMatchObject({ kind: 'effect_choice', message: expect.stringContaining('to steal') });
  });

  it('stops at full: an agenda whose steal cost the Runner cannot pay waits for Continue, then is not stolen', () => {
    const s = runOn('rd', 'full', onTop(MELIES_LINE), 1);
    expect(s.pendingPrompts[0]).toMatchObject({ kind: 'access_trash', trashCost: null });
    const t = goOn(s);
    expect(t.runner.scoreArea).toHaveLength(0);
    expect(t.log.some(e => /^Runner cannot pay/.test(e.message))).toBe(true);
  });

  it('stops at full, several R&D accesses: each card gets its own step', () => {
    let s = runOn('rd', 'full', onTop(HEDGE_FUND, OFFWORLD, HEDGE_FUND), 4, 2);
    const seen: string[] = [];
    while (s.pendingPrompts[0]?.kind === 'access_trash') {
      seen.push(s.pendingPrompts[0].message);
      s = goOn(s);
    }
    expect(seen).toEqual(['Runner: accessing Hedge Fund.', 'Runner: accessing Offworld Office.', 'Runner: accessing Hedge Fund.']);
    expect(s.activeRun).toBeNull();
    expect(s.runner.scoreArea.map(c => c.cardCode)).toEqual([OFFWORLD]);
  });

  it('stops at full: an HQ access is unchanged (the Corp sees what is accessed from HQ, 7.1.2)', () => {
    const s = runOn('hq', 'full', st => st.corp.hq.splice(0, st.corp.hq.length, createCardInstance(st, HEDGE_FUND)));
    expect(s.pendingPrompts).toEqual([]);
    expect(s.activeRun).toBeNull();
  });

  for (const stops of ['ai', 'auto', 'none'] as const) {
    it(`stops at ${stops}: an operation accessed from R&D finishes with no prompt, as before`, () => {
      const s = runOn('rd', stops, onTop(HEDGE_FUND));
      expect(s.pendingPrompts).toEqual([]);
      expect(s.activeRun).toBeNull();
    });
  }
});
