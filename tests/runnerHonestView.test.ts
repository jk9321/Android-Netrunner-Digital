import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardInstance, GameAction, GameState, activePrompt } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai';
import { asSide, plan, withPricing } from '../src/ai/pricing';
import { evaluate } from '../src/ai/evaluate';
import { boardNeed, clearBuildTargets } from '../src/ai/valueModel';
import { clearHandCaches } from '../src/ai/handValues';
import { clearThreatCaches } from '../src/ai/threatModel';
import { clearDamageThreats } from '../src/ai/effectValues';
import { clearDeckShares } from '../src/ai/iceValues';
import { dealRunnerUnknowns, guessRunnerView } from '../src/ai/runnerReply';
import { getCardDefinition } from '../src/core';
import { isAdvanceable } from '../src/core/engine/helpers';
// A namespace import, so that on a tree without the view's memory argument (beta b7c4917) only the tests that read it differ
import * as planner from '../src/ai/turnPlanner';
import { cont, run } from './helpers';

/**
 * ai-honest-runner-view (brief rev 2, "Pins"; red team 2026-11-16 findings 1-3, 7): the deciding Runner reads only what
 * it can know of the Corp's cards. Rule 10.2.2a: HQ, R&D and its order, facedown Archives and facedown installed cards
 * are hidden from the Runner (Jeff: the Normal AI may know both decklists, never hand contents, draw order or facedown
 * cards). So the Runner's order of moves (each move's score), its evaluate of its own view and its planner's pick are the
 * same when only WHICH unseen card sits where differs: the variants swap two card codes on fixed instances (the board,
 * the ids and what the Runner has seen stay put). Each variant of the probes (valuation audit P1b, P1c):
 *  (a) a facedown ice swapped for an R&D ice of another cost; (b) a facedown root asset swapped for an R&D agenda;
 *  (c) unseen cards swapped between HQ and R&D; (d) an unseen tag punisher moved between R&D and facedown Archives.
 * The caches are emptied before every variant; plan.hiddenDraws and plan.plannerSeed are on.
 */
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const honest = <T>(f: () => T, hiddenDraws = true): T => withPricing({ plan: { ...plan(), hiddenDraws, plannerSeed: true } }, () => asSide('runner', f));
const reset = () => {
  clearThreatCaches();
  clearHandCaches();
  clearDamageThreats();
  clearDeckShares();
  clearBuildTargets();
};
const key = (a: GameAction) => JSON.stringify(Object.fromEntries(Object.entries(a).sort()));

/** Every Corp card outside the identity, wherever it is. */
const corpCards = (s: GameState): CardInstance[] => [
  ...s.corp.hq,
  ...s.corp.rd,
  ...s.corp.archives.faceDown,
  ...s.corp.archives.faceUp,
  ...Object.values(s.corp.servers).flatMap(v => [...v.ice, ...v.root]),
];
const byId = (s: GameState, id: string) => corpCards(s).find(c => c.instanceId === id)!;
/** A copy of `s` with the codes of two Corp cards swapped. */
function swapped(s: GameState, a: string, b: string): GameState {
  const t = structuredClone(s);
  const x = byId(t, a);
  const y = byId(t, b);
  [x.cardCode, y.cardCode] = [y.cardCode, x.cardCode];
  return t;
}

/** Deal 1001 T6, the Runner's turn with 4 clicks: HQ's Palisade facedown (inst-24), Tithe facedown on R&D, Regolith facedown in remote 1 (inst-14). */
const t6 = (): GameState => read('runner-draws-1001-t6.json');
/** The same, tagged, with a tag punisher (Predictive Planogram) in R&D (inst-11) and an R&D card moved to facedown Archives (inst-15). */
function punisher(): GameState {
  const s = t6();
  s.runner.tags = 1;
  const planogram = read('tag-first-side-hustle.json').corp.rd.find(c => c.instanceId === 'inst-25')!.cardCode;
  byId(s, 'inst-11').cardCode = planogram;
  const moved = s.corp.rd.findIndex(c => c.instanceId === 'inst-15');
  s.corp.archives.faceDown.push(...s.corp.rd.splice(moved, 1));
  return s;
}

const CASES: [string, () => GameState, [string, string][]][] = [
  ['(a) facedown ice: Palisade on HQ swapped for an R&D Brân 1.0', t6, [['inst-24', 'inst-17']]],
  ['(b) facedown root: Regolith in remote 1 swapped for an R&D Offworld Office', t6, [['inst-14', 'inst-5']]],
  // inst-18, inst-29 and inst-12 are HQ cards the Runner has seen (knownToRunner); Government Subsidy (inst-32) it hasn't
  ['(c) HQ and R&D: the unseen HQ card swapped with an R&D agenda', t6, [['inst-32', 'inst-6']]],
  ['(d) tag punisher: Predictive Planogram moved from R&D to facedown Archives', punisher, [['inst-11', 'inst-15']]],
];

/** The deciding Runner's order (each move and its score), its evaluate of its own view and its pick. */
function decide(s: GameState) {
  reset();
  const ranked = honest(() => new HeuristicRunnerAI({ planner: true }).rankMainActions(s));
  reset();
  const view = honest(() => evaluate(planner.runnerDecisionView(s), 'runner'));
  reset();
  const pick = honest(() => new HeuristicRunnerAI({ planner: true }).chooseAction(s));
  return {
    order: ranked.map(r => `${key(r.action)} ${r.score}`),
    nonRun: ranked.filter(r => r.action.type !== 'INITIATE_RUN').map(r => `${key(r.action)} ${r.score}`),
    view,
    pick: key(pick),
  };
}

describe('the deciding Runner reads only what it can know of the Corp (rule 10.2.2a)', () => {
  for (const [name, fixture, swaps] of CASES) {
    it(`${name}: the order, the view's evaluate and the planner's pick don't change`, () => {
      const base = fixture();
      const variant = swaps.reduce((s, [a, b]) => swapped(s, a, b), base);
      const a = decide(base);
      const b = decide(variant);
      // red team 1: a non-run move's score doesn't carry the real split as an offset
      expect(b.nonRun).toEqual(a.nonRun);
      expect(b.order).toEqual(a.order);
      expect(b.view).toBe(a.view);
      expect(b.pick).toBe(a.pick);
    }, 120_000);
  }

  // P1b through boardNeed itself (fix 1): the Runner's estimate of the Corp's need on the same public board
  it("the Runner's estimate of the Corp's need doesn't read a facedown ice's cost or a facedown root card's type", () => {
    const base = t6();
    const need = (s: GameState) => {
      reset();
      return asSide('runner', () => boardNeed(s, 'corp'));
    };
    expect(need(swapped(base, 'inst-24', 'inst-17'))).toBe(need(base));
    expect(need(swapped(base, 'inst-14', 'inst-5'))).toBe(need(base));
  });
});

describe("the Runner's view keeps what the Runner has seen", () => {
  it('a card it has seen in HQ stays in HQ as it is (and only cards still in HQ are kept)', () => {
    const s = t6();
    const bran = byId(s, 'inst-18').cardCode;
    // inst-27 left HQ (installed on R&D): a stale entry is not kept as an HQ card
    s.corp.knownToRunner = [{ id: 'inst-18', code: bran }, { id: 'inst-27', code: byId(s, 'inst-27').cardCode }];
    let dealt = 0;
    for (let k = 0; k < 8; k++) {
      const view = honest(() => guessRunnerView(s, k));
      expect(view.corp.hq.find(c => c.instanceId === 'inst-18')!.cardCode).toBe(bran);
      if (view.corp.hq.some((c, i) => c.cardCode !== s.corp.hq[i].cardCode)) dealt++;
      expect(view.corp.hq.length).toBe(s.corp.hq.length);
      expect(view.corp.rd.length).toBe(s.corp.rd.length);
    }
    expect(dealt).toBeGreaterThan(0); // the other HQ cards are dealt
  });

  it('a card it knows the place of in R&D stays there', () => {
    const s = t6();
    const top = s.corp.rd[0];
    s.corp.rdKnownToRunner = [{ id: top.instanceId, code: top.cardCode, lo: 0, hi: 0 }];
    let dealt = 0;
    for (let k = 0; k < 8; k++) {
      const view = honest(() => guessRunnerView(s, k));
      expect(view.corp.rd[0].instanceId).toBe(top.instanceId);
      expect(view.corp.rd[0].cardCode).toBe(top.cardCode);
      if (view.corp.rd.some((c, i) => c.cardCode !== s.corp.rd[i].cardCode)) dealt++;
    }
    expect(dealt).toBeGreaterThan(0);
  });

  it("the view doesn't change the real state", () => {
    const s = t6();
    const before = JSON.stringify(s);
    honest(() => planner.runnerDecisionView(s));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('a prompt naming a Corp card the view may have recoded is answered on the real state (red team 2)', () => {
  it('an HQ access-trash prompt gets the same answer with the view on and off', () => {
    const s = t6();
    s.corp.servers.hq.ice = [];
    // HQ holds one card, Urtica Cipher (an asset the Runner can pay to trash)
    s.corp.hq = s.corp.hq.filter(c => c.instanceId === 'inst-12');
    s.corp.knownToRunner = []; // not a card it has seen: the view recodes it
    s.runner.credits = 10;
    let at = run(s, 'hq');
    for (let i = 0; i < 4 && !activePrompt(at) && at.activeRun; i++) at = cont(at);
    const prompt = activePrompt(at);
    expect(prompt?.kind).toBe('access_trash');
    expect(prompt && 'cardInstanceId' in prompt ? prompt.cardInstanceId : null).toBe('inst-12');
    const answer = (hiddenDraws: boolean) => {
      reset();
      return key(honest(() => new HeuristicRunnerAI({ planner: true }).chooseAction(at), hiddenDraws));
    };
    expect(answer(true)).toBe(answer(false));
  });
});

describe("the deal gives every hidden Corp card a code that fits its slot (review R1)", () => {
  it('a remote with a facedown asset, then a facedown advanced agenda, HQ, R&D and Archives empty: 200 seeds', () => {
    const base = t6();
    // remote 1: Regolith (inst-14, an asset that can't be advanced) facedown, then an R&D agenda (inst-5) facedown with a counter
    const agenda = base.corp.rd.find(c => c.instanceId === 'inst-5')!;
    base.corp.servers['remote-1'].root.push({ ...agenda, advancementCounters: 1 });
    base.corp.hq = [];
    base.corp.rd = [];
    base.corp.archives.faceDown = [];
    const unseen = (s: GameState) => [...Object.values(s.corp.servers).flatMap(v => [...v.ice.filter(c => !c.isRezzed), ...v.root])];
    const before = unseen(base).map(c => c.cardCode).sort();
    for (let seed = 1; seed <= 200; seed++) {
      const s = structuredClone(base);
      let x = seed;
      // a fixed-seed generator (no Math.random in tests that pin a deal)
      const random = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      dealRunnerUnknowns(s, random, undefined, true);
      const after = unseen(s);
      for (const c of after) expect(c.cardCode, `seed ${seed}`).toBeDefined();
      expect(after.map(c => c.cardCode).sort()).toEqual(before);
      for (const sv of Object.values(s.corp.servers)) {
        for (const c of sv.ice.filter(i => !i.isRezzed)) expect(getCardDefinition(c.cardCode).type_code).toBe('ice');
        for (const c of sv.root) {
          expect(['agenda', 'asset', 'upgrade']).toContain(getCardDefinition(c.cardCode).type_code);
          if (c.advancementCounters > 0) expect(isAdvanceable(c), `seed ${seed}`).toBe(true);
        }
      }
    }
  });
});
