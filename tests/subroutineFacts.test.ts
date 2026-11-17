/**
 * Stage D item 1 (brief rev 2, 4.3): the facts beside the Runner's run prices in src/ai/runs.ts.
 *  - `subroutineBlocks` is the price's own BLOCK condition: equal to subroutineCost(...) === BLOCK on every pool
 *    label, ice and breaker, over a sweep of boards (the Runner's credits, tags and grip; the Corp's credits, HQ, score).
 *  - `subroutineFacts` reads every pool label with no unknown sentence; a few literal facts are checked against the
 *    card text (the condition is the card's, not the price's look-ahead: Whitespace is "6 or less").
 *  - `breakPlans`' cheapest plan is bestBreakPlan's, and each plan names what it spends besides credits.
 */
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, getCardScript } from '../src/core';
import { BLOCK, bestBreakPlan, breakPlans, planCost, plannedSubroutines, subroutineBlocks, subroutineCost, subroutineFacts } from '../src/ai/runs';
import { asSide, plan, withPricing } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { BOARDS, board, breakerCodes, iceCodes } from '../scripts/stage-d/golden-prices';
import { CARDS } from '../src/ai/cards';

const labels = [...new Set(ALL_CARDS.flatMap(card => (getCardScript(card.code)?.ice?.subroutines ?? []).map(sub => sub.label)))];
const inContext = <T>(s: Parameters<typeof decisionContext>[0], f: () => T): T =>
  withPricing({ plan: { ...plan() } }, () => asSide('corp', () => { decisionContext(s, 'corp'); return f(); }));

describe('subroutineBlocks: the price condition, without the price', () => {
  it('equals subroutineCost === BLOCK for every pool label on every board of the sweep', () => {
    const misses: string[] = [];
    const sweep: (typeof BOARDS)[number][] = [];
    for (const credits of [0, 2, 9, 10]) for (const tags of [0, 1, 2]) for (const grip of [0, 1, 2, 5]) for (const [corp, hq, score] of [[0, 0, 0], [12, 8, 4]]) sweep.push([credits, tags, grip, corp, score, 3, hq]);
    for (const b of sweep) {
      for (const breaker of [null, '30006']) {
        // Mycoweb's borrowed subroutines read the rezzed ice: a sentry and a code gate on the board
        const { s } = board(b, '30047', breaker);
        s.corp.servers.remote1.ice.push({ ...s.corp.servers.remote1.ice[0], instanceId: 'gate', cardCode: '30074' });
        inContext(s, () => {
          for (const label of labels) {
            const priced = subroutineCost(s, label) === BLOCK;
            if (subroutineBlocks(s, label) !== priced) misses.push(`${JSON.stringify(b)} ${breaker} ${label}: price ${priced}`);
          }
        });
      }
    }
    expect(misses).toEqual([]);
  });

  it('agrees on every ice and breaker of the golden boards', () => {
    const misses: string[] = [];
    for (const code of iceCodes()) {
      for (const breaker of [null, ...breakerCodes()]) {
        for (const b of BOARDS) {
          const { s, ice } = board(b, code, breaker);
          inContext(s, () => {
            for (const sub of plannedSubroutines(s, ice)) if (subroutineBlocks(s, sub.label) !== (subroutineCost(s, sub.label) === BLOCK)) misses.push(`${code} ${breaker} ${sub.label}`);
          });
        }
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('subroutineBlocks against the facts (review R2: two encodings of "ends the run", one tie)', () => {
  it('blocks only where the literal facts can end the run or the damage is lethal, on every board of the sweep', () => {
    const misses: string[] = [];
    for (const credits of [0, 2, 9, 10]) for (const tags of [0, 1, 2]) for (const grip of [0, 1, 2, 5]) for (const [corp, hq, score] of [[0, 0, 0], [12, 8, 4]]) {
      const { s } = board([credits, tags, grip, corp, score, 3, hq], '30047', null);
      s.corp.servers.remote1.ice.push({ ...s.corp.servers.remote1.ice[0], instanceId: 'gate', cardCode: '30074' });
      inContext(s, () => {
        for (const label of labels) {
          if (!subroutineBlocks(s, label)) continue;
          const f = subroutineFacts(label);
          const lethal = (n: number | 'runnerTags') => (n === 'runnerTags' ? tags : n) > grip;
          const ends = !!f.orEndRun || (f.unless?.netDamage ?? -1) > grip || f.does.some(e => e.kind === 'endRun' || e.kind === 'borrow' || e.kind === 'corpMayTrashHqToEndRun' || e.kind === 'cannotStealOrTrash' || (e.kind === 'damage' && lethal(e.n)));
          if (!ends) misses.push(`${JSON.stringify([credits, tags, grip, corp, hq, score])} ${label}`);
        }
      });
    }
    expect(misses).toEqual([]);
  });
});

describe('subroutineFacts: the literal text', () => {
  it('reads every subroutine in the pool with no unknown sentence', () => {
    const unknown = labels.filter(l => subroutineFacts(l).does.some(e => e.kind === 'unknown')).map(l => `${l}: ${JSON.stringify(subroutineFacts(l))}`);
    expect(unknown).toEqual([]);
  });

  it('reads every subroutine a card entry grants (holdFacts gains: Thunderbolt Armaments; review R1)', () => {
    const gains = Object.values(CARDS).flatMap(c => (c.holdFacts?.rezDuringRun?.anyIce ? [c.holdFacts.rezDuringRun.anyIce.gains] : []));
    expect(gains.length).toBeGreaterThan(0);
    expect(gains.filter(l => subroutineFacts(l).does.some(e => e.kind === 'unknown'))).toEqual([]);
    expect(subroutineFacts('End the run unless the Runner trashes 1 of their installed cards.')).toEqual({ does: [{ kind: 'endRun' }], unless: { trashInstalled: true } });
  });

  it('states conditions and costs as the card text does', () => {
    expect(subroutineFacts('If the Runner has 6 credits or less, end the run.')).toEqual({ does: [{ kind: 'endRun', if: { kind: 'runnerCreditsAtMost', n: 6 } }] });
    expect(subroutineFacts('The Runner loses 3 credits.')).toEqual({ does: [{ kind: 'runnerLosesCredits', n: 3 }] });
    expect(subroutineFacts('End the run unless the Runner pays 3 [credit].')).toEqual({ does: [{ kind: 'endRun' }], unless: { credits: 3 } });
    expect(subroutineFacts('Give the Runner 1 tag unless they pay 4 credits.')).toEqual({ does: [{ kind: 'tags', n: 1 }], unless: { credits: 4 } });
    expect(subroutineFacts('End the run if the Runner is tagged.')).toEqual({ does: [{ kind: 'endRun', if: { kind: 'runnerTagsAtLeast', n: 1 } }] });
    expect(subroutineFacts('Gain 1 [credit]. End the run.')).toEqual({ does: [{ kind: 'corpGainsCredits', n: 1 }, { kind: 'endRun' }] });
    expect(subroutineFacts('If this ice is a barrier, gain 1 [credit] and end the run.')).toEqual({ when: { kind: 'iceIs', subtype: 'barrier' }, does: [{ kind: 'corpGainsCredits', n: 1 }, { kind: 'endRun' }] });
    expect(subroutineFacts('Trash 1 installed program or end the run.')).toEqual({ does: [{ kind: 'trashInstalled', what: 'program' }], orEndRun: true });
    expect(subroutineFacts('End the run if you have more credits than the Runner.')).toEqual({ does: [{ kind: 'endRun', if: { kind: 'corpCreditsMoreThanRunner' } }] });
    expect(subroutineFacts('Do 2 net damage if the Runner has at least 2 tags.')).toEqual({ when: { kind: 'runnerTagsAtLeast', n: 2 }, does: [{ kind: 'damage', type: 'net', n: 2 }] });
    expect(subroutineFacts('End the run unless the Runner suffers 3 net damage.')).toEqual({ does: [{ kind: 'endRun' }], unless: { netDamage: 3 } });
    expect(subroutineFacts('Do X net damage and give the Runner X tags (X = the Runner\'s tags).')).toEqual({ does: [{ kind: 'damage', type: 'net', n: 'runnerTags' }, { kind: 'tags', n: 'runnerTags' }] });
    expect(subroutineFacts('If this ice is a code gate, the Runner loses [click] and 1 [credit].')).toEqual({ when: { kind: 'iceIs', subtype: 'code gate' }, does: [{ kind: 'runnerLosesClicks', n: 1 }, { kind: 'runnerLosesCredits', n: 1 }] });
    expect(subroutineFacts('Do 1 net damage. Give the Runner 1 tag.')).toEqual({ does: [{ kind: 'damage', type: 'net', n: 1 }, { kind: 'tags', n: 1 }] });
  });
});

describe('breakPlans: every breaker, and the cheapest is bestBreakPlan', () => {
  it('its first cheapest plan is bestBreakPlan on every golden board', () => {
    for (const code of iceCodes()) {
      for (const breaker of [null, ...breakerCodes()]) {
        for (const b of BOARDS) {
          const { s, ice } = board(b, code, breaker);
          inContext(s, () => {
            for (let k = 1; k <= plannedSubroutines(s, ice).length; k++) {
              const plans = breakPlans(s, ice, k);
              let first = null as (typeof plans)[number]['plan'] | null;
              for (const p of plans) if (!first || planCost(p.plan) < planCost(first)) first = p.plan;
              expect(first).toEqual(bestBreakPlan(s, ice, k));
            }
          });
        }
      }
    }
  });

  it('names what a plan spends besides credits (Pharos: Audrey v2 counters and grip cards; Mayfly trashed)', () => {
    const { s, ice } = board([5, 0, 5, 12, 0, 4, 3], '30063', '34004');
    const mayfly = board([5, 0, 5, 12, 0, 4, 3], '30063', '30032');
    inContext(s, () => {
      const [audrey] = breakPlans(s, ice, 2);
      expect(audrey.spends).toEqual({ counters: { cardId: s.runner.rig.programs[0].instanceId, kind: 'virus', n: 1 }, gripCards: 2 });
    });
    inContext(mayfly.s, () => expect(breakPlans(mayfly.s, mayfly.ice, 1)[0].spends).toEqual({ trashesBreaker: true }));
  });
});
