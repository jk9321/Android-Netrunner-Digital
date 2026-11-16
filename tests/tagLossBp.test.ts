/**
 * ai-tag-loss-bp (brief-tag-loss-bp.md rev 2; Jeff's go 2026-11-16 22:19Z): inside the tag clock (evaluate.ts tagLoss) a
 * resource the Corp could trash is priced by its own term in the rig (addRigCard, runnerRigValue's own loop body) plus its
 * share of the combo plans (boardPlansWorth without it), not by pricing the whole rig again without it. The Corp's basic
 * action "[click], 2[credit]: Trash 1 resource. Take this action only if the Runner is tagged" (Comprehensive Rules 5.2.6g)
 * is what the clock prices; nothing here changes what it models.
 *
 * - runnerRigValue is the same number, bit for bit, as on beta fddc803 on boards from Jeff's recorded games (the loop
 *   calls the moved body with its running total). The fixture was written on beta fddc803 with WRITE_RIG_VALUES=1.
 * - With no board plan in play no plan copy is made; with one in play the plans are priced once and once per resource.
 * - Knickknack O'Brian beside Principia: the combo is in the price (its plan), as in today's whole-rig difference.
 * - The report-21 T6 board of results.md section 7: what is left out is Read-Write Share's term moving when Knickknack
 *   leaves; today's and the new number asserted.
 * "Today's" number is the beta fddc803 text of tagLoss, kept below as the reference. Plan copies are counted through a
 * module mock of boardPlansWorth (side 'runner').
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CardInstance, GameAction, GameState, SideCode, cardDef, createCardInstance, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { newGame } from './helpers';

const probe = { plans: 0 };
vi.mock('../src/ai/cardPlans', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/ai/cardPlans')>();
  return { ...orig, boardPlansWorth: (s: GameState, side: SideCode) => (side === 'runner' && probe.plans++, orig.boardPlansWorth(s, side)) };
});
const { hqTrashCardsLoss, runnerRigValue, tagLossPerTurn, unseenCorpPool } = await import('../src/ai/evaluate');
const { BAKER, KNICKKNACK, PRINCIPIA, principiaFuel } = await import('../src/ai/cardPlans');
const { clearHandCaches } = await import('../src/ai/handValues');
const { plan, withPricing } = await import('../src/ai/pricing');
const { CLICK } = await import('../src/ai/valueModel');
const { cardSynergy } = await import('../src/ai/synergyTags');
const { trashedCardCost } = await import('../src/ai/runs');

/** tagLoss as on beta fddc803 (arm 0 in, before BP): each resource priced by the whole rig less the rig without it. */
function tagLossToday(state: GameState, viewer: SideCode, skip: number): number {
  return withPricing({ pricingTagLoss: true }, () => {
    const corp = state.corp;
    const owned = state.runner.rig.resources;
    let trash = 0;
    if (owned.length > skip && corp.credits >= 2) {
      const rig = runnerRigValue(state);
      const resources = owned.map(r => rig - runnerRigValue({ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, resources: owned.filter(c => c !== r) } } }));
      const extra = (r: CardInstance) => (plan().hqTrashCost ? hqTrashCardsLoss(state, r) : 0);
      const nets = resources.map((v, i) => v - extra(owned[i])).sort((a, b) => b - a);
      trash = Math.max(0, nets[skip] ?? 0) - (CLICK + 2);
    }
    const punishes = (c: CardInstance) => cardSynergy(cardDef(c)).when?.includes('ifTagged') ?? false;
    let held: number;
    if (viewer === 'corp') held = corp.hq.some(punishes) ? 1 : 0;
    else {
      const unseen = unseenCorpPool(state);
      const share = unseen.length ? unseen.filter(punishes).length / unseen.length : 0;
      held = 1 - (1 - share) ** corp.hq.length;
    }
    return Math.max(trash, 0) + held * trashedCardCost(state) + (punishes(corp.identity) ? 1 : 0);
  });
}

/** A tagged Runner with the Corp able to trash (10 credits), the given programs, hardware and resources. */
function board(programs: string[], hardware: string[], resources: string[]): GameState {
  const s = newGame();
  s.runner.tags = 1;
  s.runner.credits = 6;
  s.corp.credits = 10;
  s.runner.rig.programs = programs.map(code => createCardInstance(s, code));
  s.runner.rig.hardware = hardware.map(code => createCardInstance(s, code));
  s.runner.rig.resources = resources.map(code => createCardInstance(s, code));
  return s;
}

/** The per-turn loss now, the plan copies it made, and today's number on a copy of the same board. */
function measure(s: GameState, viewer: SideCode, skip = 0) {
  clearHandCaches();
  const today = tagLossToday(structuredClone(s), viewer, skip);
  clearHandCaches();
  probe.plans = 0;
  const now = tagLossPerTurn(s, viewer, skip);
  return { now, today, plans: probe.plans };
}

/** runnerRigValue on boards of Jeff's recorded games: every 6th move with a rig, caches cleared before each. */
function recordedRigValues(): Record<string, number[]> {
  const dir = new URL('./fixtures/human-games/', import.meta.url);
  const out: Record<string, number[]> = {};
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const report = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    if (!report.moves?.length) continue;
    let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    const values: number[] = [];
    (report.moves as GameAction[]).every((move, i) => {
      const rig = s.runner.rig;
      if (i % 6 === 0 && rig.programs.length + rig.hardware.length + rig.resources.length > 0) {
        clearHandCaches();
        values.push(runnerRigValue(s));
      }
      try {
        s = executeAction(s, move);
        return true;
      } catch {
        return false; // a fixture recorded on an older engine: read up to here
      }
    });
    out[file] = values;
  }
  return out;
}

describe('ai-tag-loss-bp: a resource priced by its own term plus its share of the combo plans', () => {
  it('runnerRigValue is the same number, bit for bit, on boards of Jeff\'s recorded games', () => {
    const fixture = new URL('./fixtures/tag-loss-bp/rig-values.json', import.meta.url);
    const values = recordedRigValues();
    if (process.env.WRITE_RIG_VALUES) writeFileSync(fixture, JSON.stringify(values));
    const before: Record<string, number[]> = JSON.parse(readFileSync(fixture, 'utf8'));
    let n = 0;
    for (const [file, xs] of Object.entries(before)) {
      expect(values[file]?.length, file).toBe(xs.length);
      xs.forEach((x, i) => expect(Object.is(values[file][i], x), `${file} board ${i}: ${values[file][i]} vs ${x}`).toBe(true));
      n += xs.length;
    }
    expect(n).toBeGreaterThan(500);
  }, 120_000);

  for (const viewer of ['corp', 'runner'] as const) {
    it(`no board plan in play: no plan copy, and today's number on a board with no cross term (${viewer}'s view)`, () => {
      // Cleaver and Pennyshaver beside Smartware Distributor and Red Team: neither resource moves another card's term
      const r = measure(board(['30006'], ['30014'], ['30004', '30018']), viewer);
      expect(r.plans).toBe(0);
      expect(Math.abs(r.now - r.today)).toBeLessThan(1e-9);
    });

    it(`Baker in play beside a resource: the plans priced once and once per resource, the resource's share 0 (${viewer}'s view)`, () => {
      // No resource in the card pool is a stealth card, so a resource's share of Baker's plan (stealth credits) is 0;
      // Methuselah (stealth hardware) is not a resource the Corp can trash
      const r = measure(board([BAKER], ['36020'], ['30009']), viewer);
      expect(r.plans).toBe(1 + 1);
      expect(Number.isFinite(r.now)).toBe(true);
    });

    it(`Knickknack O'Brian beside Principia: the combo is in the price, as in today's whole-rig difference (${viewer}'s view)`, () => {
      const s = board([PRINCIPIA], [], [KNICKKNACK]);
      const fuel = principiaFuel(s, s.runner.rig.programs[0]);
      expect(fuel).toBeGreaterThan(0.5);
      const r = measure(s, viewer);
      expect(r.plans).toBe(1 + 1);
      expect(Math.abs(r.now - r.today)).toBeLessThan(1e-9);
    });

  }

  it('the report-21 T6 board (results.md section 7): left out is Read-Write Share\'s term moving when Knickknack leaves', () => {
    // A board from a playout of Jeff's report-21 game, T6 (the values pass's largest per-turn difference, dumped by
    // scripts/tag-loss-bp/measure.ts with TL_DUMP), as the clock saw it: Knickknack O'Brian is the one resource, Read-Write
    // Share (a program whose worth reads the Runner's card rate) beside it. Today's number is the whole-rig difference;
    // the clock now reads Knickknack's own term, which is the whole-rig difference on the board without Read-Write Share
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/tag-loss-bp/report21-t6.json', import.meta.url), 'utf8'));
    const rig = s.runner.rig;
    expect(rig.resources.map(c => c.cardCode)).toEqual([KNICKKNACK]);
    expect(rig.programs.map(c => c.cardCode)).toContain('36022');
    const r = measure(structuredClone(s), 'runner');
    expect(r.today).toBeCloseTo(1.111340, 5);
    expect(r.now).toBeCloseTo(9.212026, 5);
    const programs = (keepRws: boolean) => (keepRws ? rig.programs : rig.programs.filter(c => c.cardCode !== '36022'));
    const lost = (keepRws: boolean) => {
      clearHandCaches();
      const board = (resources: CardInstance[]) => ({ ...s, runner: { ...s.runner, rig: { ...rig, programs: programs(keepRws), resources } } });
      return withPricing({ pricingTagLoss: true }, () => runnerRigValue(board(rig.resources)) - runnerRigValue(board([])));
    };
    const withRws = lost(true);
    const withoutRws = lost(false);
    // Read-Write Share's term is what moves: past one tag clear, and the per-turn gap is at most it (today's trash is 0 here)
    expect(withoutRws - withRws).toBeGreaterThan(CLICK + 2);
    expect(r.now - r.today).toBeLessThanOrEqual(withoutRws - withRws + 1e-9);
    expect(r.now - r.today).toBeGreaterThan(CLICK + 2);
  });
});
