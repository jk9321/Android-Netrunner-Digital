import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, getLegalActions } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { iceRedirect } from '../src/ai/countedScore';
import { runnerBudget, serverHold } from '../src/ai/corp/hold';
import { lineFloor, rezMoney, stakedServers } from '../src/ai/corp/rezMoney';
import { corpPools, rdAgendaOdds, reachablePoints, runLoss, stake } from '../src/ai/corp/pools';
import { place } from '../src/ai/corp/placement';
import * as ref from '../scripts/stage-a/reference';

/**
 * Step 4 Stage A (spec-step4-corp-core.md 1.4 to 1.8): the four owners in src/ai/corp/ against the counts they replace
 * (frozen copies from beta 92f5c96 in scripts/stage-a/reference.ts) and against the rules they read.
 *  - Rez on approach: the Corp may rez the approached ice in the approach-ice window (rules 6.4.3, 6.9.2b); unrezzed ice
 *    is passed (6.9.2c); a bypassed ice's subroutines never resolve (6.5.8a).
 *  - Install cost: 1 credit for each ice already protecting the server (8.5.11a).
 *  - Remote roots: one agenda or asset (3.3.1), any number of upgrades (3.6.2).
 *  - Hidden information (10.2.2a): none of them reads R&D's order or the Runner's grip.
 */
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const deal = (seed: number) => {
  const p = Math.floor((seed - 1001) / 10);
  return new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
};
/** The first `n` states of a deal where `want` holds (a played game, Normal v Normal). */
function statesWhere(seed: number, want: (s: GameState) => boolean, n: number, steps = 900): GameState[] {
  const game = deal(seed);
  const out: GameState[] = [];
  for (let i = 0; i < steps && out.length < n && game.step(); i++) if (want(game.state)) out.push(game.state);
  return out;
}
const approachingIce = (s: GameState) => !!s.activeRun && s.activeRun.icePosition !== null && s.priority?.step === 'approach_ice' && s.priority.holder === 'corp' && !!s.corp.servers[s.activeRun.server]?.ice[s.activeRun.icePosition];
/** The same board with R&D's order reversed and the grip's cards replaced: what the Corp cannot see (10.2.2a). */
const blind = (s: GameState): GameState => {
  const t = structuredClone(s);
  t.corp.rd.reverse();
  t.runner.grip = t.runner.grip.map(c => ({ ...c, cardCode: '30030' }));
  return t;
};

describe('serverHold: what holds a server (corp/hold.ts)', () => {
  const s = read('ice-redirect-1001-t10.json');

  it("'runnerTurn' is holdCost's count on every server and credit amount (6.4.3, 6.9.2b-c)", () => {
    for (const v of Object.values(s.corp.servers))
      for (const credits of [0, 3, s.corp.credits, Infinity]) {
        const h = inCorp(s, () => serverHold(s, v.id, { when: 'runnerTurn', corpCredits: credits }));
        expect(h.holds ? h.rezCost : null).toEqual(inCorp(s, () => ref.holdCost(s, v.ice, credits)));
      }
  });

  it('margin is need less budget; a server that holds gives no entries, a bare one gives an entry a click', () => {
    for (const v of Object.values(s.corp.servers)) {
      const h = inCorp(s, () => serverHold(s, v.id, { when: 'runnerTurn', corpCredits: s.corp.credits }));
      expect(h.margin).toBe(h.need - h.budget);
      expect(h.budget).toBe(inCorp(s, () => runnerBudget(s)));
      if (h.holds) {
        expect(h.margin).toBeGreaterThan(0);
        expect(h.entries).toBe(0);
        expect(h.rez?.every(id => v.ice.some(c => c.instanceId === id && !c.isRezzed))).toBe(true);
      } else expect(h.rez).toBeNull();
      // No ice: nothing to rez, nothing to pay; the Runner gets in on every click it runs
      if (v.ice.length === 0) expect(h).toMatchObject({ holds: false, need: 0, entries: s.runner.maxClicks });
    }
  });

  it("'thisRun' is stopCost's count at every approached ice of a played deal (6.4.3, 6.9.2b, 6.5.8a)", () => {
    const states = statesWhere(1001, approachingIce, 6, 2000);
    expect(states.length).toBeGreaterThan(0);
    for (const t of states) {
      const run = t.activeRun!;
      const ice = t.corp.servers[run.server].ice[run.icePosition!];
      for (const [withIce, further] of [[true, true], [false, true], [true, false]] as const) {
        const h = inCorp(t, () => serverHold(t, run.server, { when: 'thisRun', mustRez: withIce ? [ice.instanceId] : [], further }));
        expect(h.holds ? h.rezCost : Infinity).toBe(inCorp(t, () => ref.stopCost(t, withIce ? ice : null, further)));
        expect(h.budget).toBe(t.runner.credits);
      }
    }
  }, 120_000);

  it('reads no R&D order and no grip (10.2.2a)', () => {
    const t = blind(s);
    for (const v of Object.values(s.corp.servers)) expect(inCorp(t, () => serverHold(t, v.id, { when: 'runnerTurn' }))).toEqual(inCorp(s, () => serverHold(s, v.id, { when: 'runnerTurn' })));
  });
});

describe('rezMoney: money kept for rezzing (corp/rezMoney.ts)', () => {
  const s = read('ice-redirect-1001-t10.json');

  it("byServer's sum is afterLineFloor for every agenda a line could take out of the pools", () => {
    const ids = ['', ...s.corp.hq.filter(c => cardDef(c).type_code === 'agenda').map(c => c.instanceId), ...Object.values(s.corp.servers).flatMap(v => v.root.map(c => c.instanceId))];
    for (const id of ids) {
      const sum = Object.values(inCorp(s, () => rezMoney(s, { without: [id] })).byServer).reduce((a, b) => a + b, 0);
      expect(sum).toBe(inCorp(s, () => ref.afterLineFloor(s, id)));
      expect(inCorp(s, () => lineFloor(s, id))).toBe(sum);
    }
  });

  it('R&D is always staked, HQ while it holds an agenda, a remote while its root holds one', () => {
    const staked = stakedServers(s);
    expect(staked[0]).toBe('rd');
    expect(staked.includes('hq')).toBe(s.corp.hq.some(c => cardDef(c).type_code === 'agenda'));
    for (const v of Object.values(s.corp.servers).filter(x => x.isRemote)) expect(staked.includes(v.id)).toBe(v.root.some(c => cardDef(c).type_code === 'agenda'));
  });

  it('keep is the sum against a rich Runner and no more than the sum against a poor one', () => {
    const money = inCorp(s, () => rezMoney(s));
    const sum = Object.values(money.byServer).reduce((a, b) => a + b, 0);
    expect(money.keep).toBeLessThanOrEqual(sum);
    const rich = structuredClone(s);
    rich.runner.credits = 99;
    const r = inCorp(rich, () => rezMoney(rich));
    expect(r.keep).toBe(Object.values(r.byServer).reduce((a, b) => a + b, 0));
    // One click: one run, so keep is the costliest single staked server
    const slow = structuredClone(rich);
    slow.runner.maxClicks = 1;
    const one = inCorp(slow, () => rezMoney(slow));
    expect(one.keep).toBe(Math.max(0, ...Object.values(one.byServer)));
  });

  it('reads no R&D order and no grip (10.2.2a)', () => {
    expect(inCorp(blind(s), () => rezMoney(blind(s)))).toEqual(inCorp(s, () => rezMoney(s)));
  });
});

describe('corpPools and stake: the Corp pool (corp/pools.ts)', () => {
  it('stake is runLoss and reachablePoints on every run of a played deal', () => {
    const states = statesWhere(1001, t => !!t.activeRun, 10, 2000);
    expect(states.length).toBeGreaterThan(0);
    for (const t of states) {
      const st = inCorp(t, () => stake(t, t.activeRun!.server));
      expect(st.loss).toBeCloseTo(inCorp(t, () => ref.runLoss(t)), 9);
      expect(st.points).toBe(inCorp(t, () => ref.reachablePoints(t)));
      expect(inCorp(t, () => runLoss(t))).toBe(inCorp(t, () => ref.runLoss(t)));
      expect(inCorp(t, () => reachablePoints(t))).toBe(inCorp(t, () => ref.reachablePoints(t)));
    }
  }, 120_000);

  it("HQ by the Corp's own hand, R&D by its list less what it has seen, and neither by what it can't see (10.2.2a)", () => {
    const s = read('ice-redirect-1001-t10.json');
    const pools = inCorp(s, () => corpPools(s));
    const hand = s.corp.hq.filter(c => cardDef(c).type_code === 'agenda');
    expect(pools.hq).toBe(hand.length);
    expect(pools.hqPoints).toBe(hand.reduce((n, c) => n + (cardDef(c).agenda_points ?? 0), 0));
    expect({ odds: pools.rdOdds, points: pools.rdPoints }).toEqual(inCorp(s, () => rdAgendaOdds(s)));
    expect(inCorp(blind(s), () => corpPools(blind(s)))).toEqual(pools);
    for (const id of ['hq', 'rd', 'archives']) expect(inCorp(blind(s), () => stake(blind(s), id))).toEqual(inCorp(s, () => stake(s, id)));
  });

  it("a steal that wins (1.7.2a) is still priced as its points in Stage A (the game-end reader is Stage D5's)", () => {
    const s = read('ice-redirect-1001-t10.json');
    const t = structuredClone(s);
    t.runner.score = 6;
    expect(inCorp(t, () => stake(t, 'hq').points)).toBe(inCorp(t, () => stake(t, 'hq', { accesses: 1 }).points));
    expect(Number.isFinite(inCorp(t, () => stake(t, 'hq').loss))).toBe(true);
  });
});

describe('place: where a card goes, today rules in today order (corp/placement.ts)', () => {
  const installs = (s: GameState, id: string) => getLegalActions(s, 'corp').filter(a => a.type === 'INSTALL_CARD' && (a as { cardInstanceId?: string }).cardInstanceId === id) as (GameAction & { targetServerId?: string; asNewRemote?: boolean })[];

  it('ice redirect: Whitespace for remote-4 or a new remote goes to the scoring remote, outermost (8.5.11a)', () => {
    const s = read('ice-redirect-1001-t10.json');
    const card = s.corp.hq.find(c => c.instanceId === 'inst-29')!;
    for (const from of installs(s, 'inst-29').filter(a => a.targetServerId === 'remote-4' || a.asNewRemote)) {
      const p = inCorp(s, () => place(s, card, { from, held: null }));
      expect(p[0]).toMatchObject({ server: 'remote-1', reason: 'iceRedirect' });
      expect(inCorp(s, () => iceRedirect(s, from))).toMatchObject({ targetServerId: p[0].server });
    }
  });

  it('central ice stays where the pick put it', () => {
    const s = read('ice-redirect-1001-t10.json');
    const card = s.corp.hq.find(c => c.instanceId === 'inst-29')!;
    const hq = installs(s, 'inst-29').find(a => a.targetServerId === 'hq')!;
    expect(inCorp(s, () => place(s, card, { from: hq, held: null }))[0]).toMatchObject({ server: 'hq', reason: 'pick' });
  });

  it("asset partner: Clearinghouse for a new remote goes to the iced remote with an open root (play test G2 #177; 3.3.1)", () => {
    const s = read('asset-partner-pt2-g2-177.json');
    const card = s.corp.hq.find(c => cardDef(c).title === 'Clearinghouse')!;
    const from = installs(s, card.instanceId).find(a => a.asNewRemote)!;
    expect(inCorp(s, () => place(s, card, { from, held: null }))[0]).toMatchObject({ server: 'remote-1' });
  });

  it('is empty for an action that is not an install of the card from HQ', () => {
    const s = read('ice-redirect-1001-t10.json');
    const card = s.corp.hq.find(c => c.instanceId === 'inst-29')!;
    expect(place(s, card, { from: { type: 'GAIN_CREDIT', player: 'corp' } as GameAction, held: null })).toEqual([]);
  });

  it('reads no R&D order and no grip (10.2.2a)', () => {
    const s = read('ice-redirect-1001-t10.json');
    const card = s.corp.hq.find(c => c.instanceId === 'inst-29')!;
    const from = installs(s, 'inst-29').find(a => a.asNewRemote)!;
    const t = blind(s);
    expect(inCorp(t, () => place(t, card, { from, held: null }))).toEqual(inCorp(s, () => place(s, card, { from, held: null })));
  });
});
