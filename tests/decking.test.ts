import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameState, cardDef } from '../src/core';
import { agendaOdds } from '../src/ai/effectValues';
import { protectionCost } from '../src/ai/corpAI';
import { iceCost } from '../src/ai/runs';
import { tuning } from '../src/ai/synergy';

/**
 * Thread "Find why self-play games end decked" (2026-11-06), from Gemini's analysis. Position: self-play deal 2172
 * (Peculiarity vs The Catalyst), the Runner's turn 23, late game with 7 rezzed cards on the board.
 */
// unseenOdds stays off (tuning pass 1); tankNoEtr is on by default
beforeEach(() => { tuning.plan.unseenOdds = true; });
afterEach(() => { tuning.plan.unseenOdds = false; tuning.plan.tankNoEtr = true; });

const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/empty-grip-runner.json', import.meta.url), 'utf8'));

describe('agenda odds leave out cards seen not to be agendas (plan.unseenOdds)', () => {
  it('installed ice and rezzed root cards leave the pool', () => {
    const s = position();
    const on = agendaOdds(s).odds;
    tuning.plan.unseenOdds = false;
    try {
      const off = agendaOdds({ ...s, id: `${s.id}-off` } as GameState).odds;
      expect(on).toBeGreaterThan(off * 1.3);
    } finally {
      tuning.plan.unseenOdds = true;
    }
  });
});

describe('only ice with no run enders is priced by its tank cost (plan.tankNoEtr)', () => {
  it('rezzed run-ending ice keeps the full cost to get past it', () => {
    const s = position();
    const etr = Object.values(s.corp.servers).flatMap(v => v.ice).filter(i => i.isRezzed && /end the run/i.test(cardDef(i).stripped_text ?? ''));
    expect(etr.length).toBeGreaterThan(0);
    for (const ice of etr) expect(protectionCost(s, ice)).toBe(iceCost(s, ice));
    tuning.plan.tankNoEtr = false;
    try {
      // before: some of them counted only their break cost
      expect(etr.some(ice => protectionCost(s, ice) < iceCost(s, ice))).toBe(true);
    } finally {
      tuning.plan.tankNoEtr = true;
    }
  });
});
