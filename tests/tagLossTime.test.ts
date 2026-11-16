/**
 * ai-tag-loss-time arm 0 (brief-tag-loss-time.md rev 2, phase 2; AI Coordinator's ruling 2026-11-16 19:44Z in
 * audit-fixes/tag-loss-time/results.md): the tag clock's per-turn loss (evaluate.ts tagLoss) prices no rig when no
 * resource could be the answer, and the number is the same as before. The Corp's basic action "[click], 2[credit]:
 * Trash 1 resource. Take this action only if the Runner is tagged" (Comprehensive Rules 5.2.6g) is what the clock
 * prices; nothing here changes what it models.
 *
 * Three cases, each with no rig value asked: the Runner has no resource; none is left past `skip` (plan.tagTrashNow's
 * resource trashed this turn); the Corp has under 2 credits. "Before" is the beta 8e28403 text of tagLoss, kept below
 * as the reference. Rig values are counted through a module mock of boardPlansWorth, which runnerRigValue calls once
 * with side 'runner' and nothing else does.
 */
import { describe, expect, it, vi } from 'vitest';
import { CardInstance, GameState, SideCode, cardDef, createCardInstance } from '../src/core';
import { newGame } from './helpers';

const probe = { rig: 0 };
vi.mock('../src/ai/cardPlans', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/ai/cardPlans')>();
  return { ...orig, boardPlansWorth: (s: GameState, side: SideCode) => (side === 'runner' && probe.rig++, orig.boardPlansWorth(s, side)) };
});
const { hqTrashCardsLoss, runnerRigValue, tagLossPerTurn, tagsWorth, unseenCorpPool } = await import('../src/ai/evaluate');
const { plan, withPricing } = await import('../src/ai/pricing');
const { CLICK } = await import('../src/ai/valueModel');
const { cardSynergy } = await import('../src/ai/synergyTags');
const { trashedCardCost } = await import('../src/ai/runs');

/** tagLoss as on beta 8e28403 (before arm 0): the full rig and every copy priced whatever the answer. */
function tagLossBefore(state: GameState, viewer: SideCode, skip: number): number {
  return withPricing({ pricingTagLoss: true }, () => {
    const corp = state.corp;
    const rig = runnerRigValue(state);
    const resources = state.runner.rig.resources.map(r => rig - runnerRigValue({ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, resources: state.runner.rig.resources.filter(c => c !== r) } } }));
    const extra = (r: CardInstance) => (plan().hqTrashCost ? hqTrashCardsLoss(state, r) : 0);
    const nets = resources.map((v, i) => v - extra(state.runner.rig.resources[i])).sort((a, b) => b - a);
    const trash = Math.max(0, nets[skip] ?? 0) - (corp.credits >= 2 ? CLICK + 2 : Infinity);
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

/** A tagged Runner with a rig worth pricing (Carnivore Console, Pennyshaver Console, Cleaver) and the given resources. */
function board(resources: string[], corpCredits: number): GameState {
  const s = newGame();
  s.runner.tags = 1;
  s.runner.credits = 6;
  s.corp.credits = corpCredits;
  s.runner.rig.hardware = [createCardInstance(s, '30003'), createCardInstance(s, '30014')];
  s.runner.rig.programs = [createCardInstance(s, '30006')];
  s.runner.rig.resources = resources.map(code => createCardInstance(s, code)); // 30009 Cookbook, 30018 Red Team, 30027 Telework Contract
  return s;
}

/** The new per-turn loss, the rig values it asked, and the old number on a copy of the same board. */
function measure(s: GameState, viewer: SideCode, skip: number) {
  const before = tagLossBefore(structuredClone(s), viewer, skip);
  probe.rig = 0;
  const now = tagLossPerTurn(s, viewer, skip);
  return { now, before, rig: probe.rig };
}

describe('arm 0: the tag clock prices no rig when no resource could be the answer (same loss per turn)', () => {
  for (const viewer of ['corp', 'runner'] as const) {
    it(`no resource: no rig value asked (${viewer}'s view)`, () => {
      const r = measure(board([], 10), viewer, 0);
      expect(r.rig).toBe(0);
      expect(r.now).toBe(r.before);
    });

    it(`one resource and skip 1 (the Corp trashes it this turn): no rig value asked (${viewer}'s view)`, () => {
      const r = measure(board(['30009'], 10), viewer, 1);
      expect(r.rig).toBe(0);
      expect(r.now).toBe(r.before);
    });

    it(`the Corp under the 2 credits the trash costs: no rig value asked (${viewer}'s view)`, () => {
      for (const credits of [0, 1]) {
        const r = measure(board(['30009', '30018', '30027'], credits), viewer, 0);
        expect(r.rig).toBe(0);
        expect(r.now).toBe(r.before);
      }
    });

    it(`otherwise the rig is priced as before: the full board and one copy per resource (${viewer}'s view)`, () => {
      for (const [resources, skip] of [[['30009'], 0], [['30009', '30018'], 1], [['30009', '30018', '30027'], 0]] as const) {
        const r = measure(board([...resources], 2), viewer, skip);
        expect(r.rig).toBe(1 + resources.length);
        expect(r.now).toBe(r.before);
        expect(Number.isFinite(r.now)).toBe(true);
      }
    });
  }

  it('through tagsWorth on the Corp\'s turn (plan.tagTrashNow skips the resource it trashes now): one resource, no rig value', () => {
    const s = board(['30009'], 10);
    s.corp.clicks = 3;
    probe.rig = 0;
    const worth = tagsWorth(s, 'corp');
    expect(probe.rig).toBe(0);
    expect(Number.isFinite(worth)).toBe(true);
  });
});
