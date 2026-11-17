/**
 * Stage D item 1 branch 2 (brief rev 2, section 6): an exhaustive reference for the hold walk (src/ai/corp/hold.ts).
 *
 * The walk answers the least credit pool a way through needs, by a memoised pass in requirement form (a payment adds, a
 * condition sets a floor, a loss of n adds n above 0). This file solves the SAME model by brute force: for every split
 * of the turn's clicks it tries every line forward with the pool as a number (every draw and tag removal, every set of
 * subroutines broken, every Botulus counter, bioroid click and plan, every alternative an "unless" offers, the Corp's
 * every choice), with no memo and no pruning, and says whether one gets in. On a few thousand random servers built from
 * the card pool's ice and breakers, it must agree with turnReach (the walk's run sequence) for one run and for two.
 *
 * The facts (each ice's subroutines, subtypes and break plans) are the walk's own (walkIce, Walk's planList): the engine
 * oracle tests those (tests/holdWalk.test.ts); this tests the search and its arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { CardInstance, GameState, cardDef } from '../src/core';
import { threatLevel } from '../src/core/engine/cardEffects';
import { iceSubroutines, iceSubtypes } from '../src/core/engine/ice';
import { createCardInstance } from '../src/core/engine/gameState';
import { installCorpForTest, installIceForTest, installProgramForTest, newGame } from './helpers';
import { Walk, WalkIce, WalkPlan, WalkState, WalkTarget, corpStart, firstState, orders, reachOrder, reachQuestion, reachSets, runTarget, holdCacheStats, questionKey, runnerEarnings, searchTarget, serverHold, turnReach, walkBoard, walkIce, walkStart } from '../src/ai/corp/hold';
import { rezMoney } from '../src/ai/corp/rezMoney';
import { SubEffect, SubFacts, bioroidBreakClicks, subroutineFacts } from '../src/ai/runs';
import { CARDS } from '../src/ai/cards';
import { asSide, withPricing } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { breakerCodes, iceCodes } from '../scripts/stage-d/golden-prices';

type S = WalkState & { pool: number };
type Next = (w: S) => boolean;
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** The model of the walk, forward, with the pool as a number: does any line of the Runner's get through every target? */
class Brute {
  private readonly walk: Walk;
  constructor(
    private readonly state: GameState,
    private readonly start: ReturnType<typeof walkStart>,
    private readonly targets: WalkTarget[],
  ) {
    this.walk = new Walk(walkBoard(state, start, targets), targets.map(searchTarget));
  }

  beforeRun(ws: S, j: number): boolean {
    const runs = this.targets.length - j;
    if (ws.clicks < runs) return false;
    if (this.approach({ ...ws, clicks: ws.clicks - 1, spike: false, fund: this.state.corp.badPublicity }, j, this.targets[j].ice.length - 1)) return true;
    if (ws.clicks > runs) {
      // 5.2.7c, 5.2.7g: a draw, or a click and 2 credits for a tag, with a click kept for each run left
      if (ws.stack > 0 && this.beforeRun({ ...ws, clicks: ws.clicks - 1, grip: ws.grip + 1, stack: ws.stack - 1 }, j)) return true;
      if (ws.tags > 0 && ws.pool >= 2 && this.beforeRun({ ...ws, clicks: ws.clicks - 1, tags: ws.tags - 1, pool: ws.pool - 2 }, j)) return true;
    }
    return false;
  }

  private approach(ws: S, j: number, pos: number): boolean {
    if (pos < 0) return j + 1 >= this.targets.length || this.beforeRun({ ...ws, fund: 0, gone: sorted([...ws.gone, ...ws.mayfly]), mayfly: [] }, j + 1);
    const ice = this.targets[j].ice[pos];
    const next: Next = w => this.approach(w, j, pos - 1);
    if (!ice.rezzed && !ws.up.includes(ice.card.instanceId)) {
      if (ice.inS && ws.corp >= ice.rezCost) return this.rezzed({ ...ws, corp: ws.corp - ice.rezCost, up: [...ws.up, ice.card.instanceId].sort() }, ice, next);
      return next(ws);
    }
    return ice.bypassed ? next(ws) : this.encounter(ws, ice, next);
  }

  private rezzed(ws: S, ice: WalkIce, next: Next): boolean {
    // Lycian: the Corp chooses the subtypes as it rezzes; the Runner gets through only if it gets through every choice
    if (ice.choices && !ws.chose.some(c => c.startsWith(`${ice.id}:`))) return ice.choices.every((_, k) => this.rezzed({ ...ws, chose: [...ws.chose, `${ice.id}:${k}`].sort() }, ice, next));
    let w = ws;
    if (ice.rezFacts?.purgeVirus) {
      const purged = this.start.rig.flatMap((c, i) => (CARDS[c.cardCode]?.holdFacts?.trashedOnPurge ? [i] : []));
      w = { ...w, virus: w.virus.map(() => 0), gone: sorted([...new Set([...w.gone, ...purged])]) };
    }
    if (ice.rezFacts?.tags) w = { ...w, tags: w.tags + ice.rezFacts.tags };
    const met = ice.rezGains ? { ...ice, subs: [...ice.subs, ice.rezGains] } : ice;
    const go = (x: S) => (ice.bypassed ? next(x) : this.encounter(x, met, next));
    // The Corp's choice: the Runner gets through only if it gets through whatever the Corp trashes
    if (ice.rezFacts?.corpMayTrashInstalled === 'trojan') {
      return go(w) && this.start.rig.every((c, i) => w.gone.includes(i) || !/\btrojan\b/i.test(cardDef(c).keywords ?? '') || go({ ...w, gone: sorted([...w.gone, i]) }));
    }
    return go(w);
  }

  private encounter(ws: S, ice: WalkIce, next: Next): boolean {
    const types = this.walk['typesOf'](ice, ws);
    for (const b of ice.bypassers) if (!ws.gone.includes(b.idx) && !types.includes(b.unless) && this.pay(ws, b.per * ice.subs.length, next)) return true;
    return this.tolls(ws, ice, w => this.breaks(w, ice, types, next));
  }

  private tolls(ws: S, ice: WalkIce, then: Next): boolean {
    const e = ice.encounterFacts;
    if (!e || ice.broken || (e.threatAtLeast !== undefined && threatLevel(this.state) < e.threatAtLeast)) return then(ws);
    const w0 = e.loses ? { ...ws, pool: Math.max(0, ws.pool - e.loses) } : ws;
    if (!e.toll) return then(w0);
    const t = e.toll;
    const u = e.unless ?? {};
    if (!t.endRun && then({ ...w0, pool: Math.max(0, w0.pool - (t.loses ?? 0)), tags: w0.tags + (t.tags ?? 0) })) return true;
    if (u.tags && then({ ...w0, tags: w0.tags + u.tags })) return true;
    if (u.netDamage !== undefined && u.netDamage <= w0.grip && then({ ...w0, grip: w0.grip - u.netDamage })) return true;
    return u.clicks !== undefined && u.clicks <= w0.clicks && then({ ...w0, clicks: w0.clicks - u.clicks });
  }

  /** Every set of subroutines to break, every way: Botulus counters, bioroid clicks or the ice's own price, a plan. */
  private breaks(ws: S, ice: WalkIce, types: string[], next: Next): boolean {
    const open = ice.subs.map((_, i) => i).filter(i => !ice.broken?.[i]);
    for (let set = 0; set < 1 << open.length; set++) {
      const unbroken = open.filter((_, k) => !(set & (1 << k)));
      const b = open.length - unbroken.length;
      const resolve: Next = w => this.resolve(w, ice, types, unbroken, 0, next);
      const hosted = ice.anyBreaker ? ice.botulus.filter(i => !ws.gone.includes(i)) : [];
      for (const virus of counterSplits(ws.virus, hosted, b)) {
        const x = hosted.reduce((n, i) => n + ws.virus[i] - virus[i], 0);
        const w1 = { ...ws, virus };
        for (let y = 0; y <= b - x; y++) {
          if (y > 0 && !ice.bioroid && ice.selfCredits === undefined) break;
          const clicks = ice.bioroid && y > 0 ? bioroidBreakClicks(ice.card, y) : 0;
          if (clicks > w1.clicks) break;
          const w2 = { ...w1, clicks: w1.clicks - clicks };
          const self = (w: S, then: Next) => (ice.selfCredits !== undefined && y > 0 ? this.pay(w, y * ice.selfCredits, then) : then(w));
          const z = b - x - y;
          if (z === 0) {
            if (self(w2, resolve)) return true;
            continue;
          }
          for (const p of this.walk['planList'](ice, z, w2) as WalkPlan[]) if (this.usable(w2, p) && self(w2, w => this.payPlan(w, p, resolve))) return true;
        }
      }
    }
    return false;
  }

  private usable(ws: S, p: WalkPlan): boolean {
    if (ws.gone.includes(p.breaker) || (p.spike && ws.spike) || p.stealth > ws.stealth || p.grip > ws.grip) return false;
    return !p.counter || (p.counter.kind === 'virus' ? ws.virus : ws.power)[p.counter.idx] >= p.counter.n;
  }

  private payPlan(ws: S, p: WalkPlan, then: Next): boolean {
    const w: S = { ...ws, stealth: ws.stealth - p.stealth, spike: ws.spike || p.spike, grip: ws.grip - p.grip };
    if (p.counter) {
      const list = [...(p.counter.kind === 'virus' ? w.virus : w.power)];
      list[p.counter.idx] -= p.counter.n;
      if (p.counter.kind === 'virus') w.virus = list;
      else w.power = list;
    }
    if (p.mayfly && !w.mayfly.includes(p.breaker)) w.mayfly = sorted([...w.mayfly, p.breaker]);
    return this.pay(w, p.credits - p.stealth, then);
  }

  /** The fund first, then the credits on cards that pay during runs, then the pool. */
  private pay(ws: S, n: number, then: Next): boolean {
    const fund = Math.min(n, ws.fund);
    const hosted = Math.min(n - fund, ws.hosted);
    const rest = n - fund - hosted;
    return rest <= ws.pool && then({ ...ws, fund: ws.fund - fund, hosted: ws.hosted - hosted, pool: ws.pool - rest });
  }

  private resolve(ws: S, ice: WalkIce, types: string[], list: number[], k: number, next: Next): boolean {
    if (k >= list.length) return next(ws);
    return this.subroutine(ws, ice.card, types, ice.subs[list[k]], w => this.resolve(w, ice, types, list, k + 1, next));
  }

  private subroutine(ws: S, card: CardInstance, types: string[], f: SubFacts, then: Next): boolean {
    if (f.when && !(f.when.kind === 'iceIs' ? types.includes(f.when.subtype) : f.when.kind === 'runnerTagsAtLeast' && ws.tags >= f.when.n)) return then(ws);
    if (f.orEndRun) return false;
    if (this.effects(ws, card, f.does, 0, then)) return true;
    if (f.unless?.credits !== undefined && this.pay(ws, f.unless.credits, then)) return true;
    if (f.unless?.netDamage !== undefined && f.unless.netDamage <= ws.grip && then({ ...ws, grip: ws.grip - f.unless.netDamage })) return true;
    return !!f.unless?.trashInstalled && this.start.rig.some((_, i) => !ws.gone.includes(i) && then({ ...ws, gone: sorted([...ws.gone, i]) }));
  }

  private effects(ws: S, card: CardInstance, does: SubEffect[], i: number, then: Next): boolean {
    if (i >= does.length) return then(ws);
    const e = does[i];
    const next: Next = w => this.effects(w, card, does, i + 1, then);
    switch (e.kind) {
      case 'endRun': {
        const c = e.if;
        if (!c) return false;
        if (c.kind === 'runnerCreditsAtMost') return ws.pool > c.n && next(ws);
        if (c.kind === 'corpCreditsMoreThanRunner') return ws.corp <= ws.pool && next(ws);
        if (c.kind === 'runnerTagsAtLeast') return ws.tags < c.n && next(ws);
        if (c.kind === 'threatAtLeast') return threatLevel(this.state) < c.n && next(ws);
        if (c.kind === 'hqMoreThanGrip') return this.state.corp.hq.length <= ws.grip && next(ws);
        return next(ws);
      }
      case 'runnerLosesClicks':
        return next({ ...ws, clicks: Math.max(0, ws.clicks - e.n) });
      case 'runnerLosesCredits':
        return next({ ...ws, pool: Math.max(0, ws.pool - e.n) });
      case 'corpGainsCredits':
        return next({ ...ws, corp: ws.corp + (e.n === 'perRunnerTag' ? ws.tags : e.n) });
      case 'damage': {
        const n = e.n === 'runnerTags' ? ws.tags : e.n;
        return n <= ws.grip && next({ ...ws, grip: ws.grip - n });
      }
      case 'tags':
        return next({ ...ws, tags: ws.tags + (e.n === 'runnerTags' ? ws.tags : e.n) });
      case 'cannotStealOrTrash':
        return false;
      case 'corpMayTrashHqToEndRun':
        return this.state.corp.hq.length === 0 && next(ws);
      case 'borrow': {
        // The Corp picks the subroutine: the Runner gets through only if it gets through each one
        const walked = new Map(this.targets.flatMap(t => t.ice.map(x => [x.card.instanceId, x] as const)));
        let any = false;
        for (const sv of Object.values(this.state.corp.servers)) {
          for (const c of sv.ice) {
            if (c.instanceId === card.instanceId) continue;
            const w = walked.get(c.instanceId);
            if (!(w ? w.rezzed || ws.up.includes(c.instanceId) : c.isRezzed)) continue;
            const up = w ? w.card : c;
            const types = w ? w.types : iceSubtypes(c, this.state);
            if (!types.includes(e.subtype)) continue;
            for (const sub of iceSubroutines(this.state, up)) {
              if (/resolve 1 subroutine on/i.test(sub.label)) continue;
              any = true;
              if (!this.subroutine(ws, up, types, subroutineFacts(sub.label), next)) return false;
            }
          }
        }
        return any || next(ws);
      }
      default:
        return next(ws);
    }
  }
}

/** Every way to take up to `max` counters from the hosts `hosted` (by rig index): the counters left on each. */
function counterSplits(virus: number[], hosted: number[], max: number): number[][] {
  const out: number[][] = [];
  const go = (k: number, left: number, v: number[]) => {
    if (k >= hosted.length) return void out.push(v);
    const i = hosted[k];
    for (let n = 0; n <= Math.min(left, virus[i]); n++) {
      const w = [...v];
      w[i] -= n;
      go(k + 1, left - n, w);
    }
  };
  go(0, max, [...virus]);
  return out;
}

/** The brute force's answer for turnReach(state, servers, rezSets): some split of the clicks gets through them all. */
function bruteReach(state: GameState, servers: string[], rezSets: string[][]): boolean | null {
  const start = walkStart(state, true);
  const bases = new Map<string, WalkIce[]>();
  const runs = servers.map((id, i) => runTarget(state, bases.get(id) ?? bases.set(id, walkIce(state, start, state.corp.servers[id]?.ice ?? [])).get(id)!, id, new Set(rezSets[i])));
  // A bypass's price is a worth, not credits (registry debt): boards with one are left out
  if (runs.some(r => r.price > 0)) return null;
  const corp = corpStart(state, [...bases.values()].flat(), state.corp.credits);
  const earn = runnerEarnings(state);
  const c = Math.max(0, state.runner.maxClicks);
  const brute = new Brute(state, start, runs.map(r => r.target));
  for (let e = 0; e + servers.length <= c; e++) if (brute.beforeRun({ ...firstState(state, start, c - e, corp), pool: state.runner.credits + earn[e] }, 0)) return true;
  return false;
}

/** A small deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ICE = iceCodes();
const BREAKERS = breakerCodes();
const BOTULUS = '30004';
const IDENTITY_THUNDERBOLT = '34096';

/** A random server: 1 to 3 ice from the pool (some unrezzed), 0 to 2 breakers, maybe a Botulus, the Runner's means at random. */
function randomBoard(r: () => number, first?: string): { s: GameState; rez: string[] } {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const s = newGame(3);
  s.turnNumber = 7;
  s.corp.hq = s.corp.hq.slice(0, Math.floor(r() * 4));
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = Math.floor(r() * 9);
  s.runner.tags = r() < 0.3 ? Math.floor(r() * 3) : 0;
  s.runner.grip = s.runner.grip.slice(0, Math.floor(r() * 6));
  s.runner.maxClicks = 1 + Math.floor(r() * 4);
  s.corp.credits = Math.floor(r() * 12);
  s.corp.badPublicity = r() < 0.15 ? 1 : 0;
  if (r() < 0.1) s.corp.identity = createCardInstance(s, IDENTITY_THUNDERBOLT);
  const ids: string[] = [];
  if (first) ids.push(installIceForTest(s, first, 'remote1', r() < 0.5));
  for (let k = (first ? 0 : 1) + Math.floor(r() * 3); k > 0; k--) ids.push(installIceForTest(s, pick(ICE), 'remote1', r() < 0.6));
  for (let k = Math.floor(r() * 3); k > 0; k--) installProgramForTest(s, pick(BREAKERS));
  if (r() < 0.15) {
    const b = createCardInstance(s, BOTULUS);
    b.isRezzed = true;
    b.hostedOnId = pick(ids);
    b.tokens = { virus: Math.floor(r() * 3) };
    s.runner.rig.programs.push(b);
  }
  // A rezzed ice elsewhere for a borrowing subroutine (Mycoweb) to lend from
  if (first || r() < 0.25) installIceForTest(s, pick(ICE), 'hq', true);
  const unrezzed = s.corp.servers.remote1.ice.filter(c => !c.isRezzed).map(c => c.instanceId);
  return { s, rez: unrezzed.filter(() => r() < 0.6) };
}

const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));

describe('the hold walk against a brute force of the same model (brief section 6)', () => {
  const check = (seed: number, boards: number, first?: string) => {
    const r = rng(seed);
    const misses: string[] = [];
    let compared = 0;
    let reached = 0;
    for (let n = 0; n < boards; n++) {
      const { s, rez } = randomBoard(r, first);
      const runs = n % 4 === 3 ? 2 : 1;
      const servers = Array(runs).fill('remote1');
      const sets = Array(runs).fill(rez);
      const want = inCorp(s, () => bruteReach(s, servers, sets));
      if (want === null) continue;
      compared++;
      if (want) reached++;
      const got = inCorp(s, () => turnReach(s, servers, sets).reaches);
      if (got !== want) {
        const ice = s.corp.servers.remote1.ice.map(c => `${cardDef(c).title}${c.isRezzed ? '*' : rez.includes(c.instanceId) ? '+' : ''}`);
        const rig = s.runner.rig.programs.map(c => cardDef(c).title);
        misses.push(`#${n} runs ${runs}: walk ${got}, brute ${want}; ice ${ice}; rig ${rig}; $${s.runner.credits} clicks ${s.runner.maxClicks} tags ${s.runner.tags} grip ${s.runner.grip.length} corp $${s.corp.credits}`);
      }
    }
    return { compared, reached, misses };
  };

  it('agrees with turnReach on 2,000 random servers, one run and two', () => {
    const { compared, reached, misses } = check(20261117, 2000);
    expect(compared).toBeGreaterThan(1500);
    // Both answers well represented (the boards are not all open or all shut)
    expect(Math.min(reached, compared - reached)).toBeGreaterThan(compared / 5);
    expect(misses).toEqual([]);
  }, 600_000);

  // Mycoweb innermost (its three borrows: the lenders worked out once, a borrow's draws and tags, its steps keyed), a
  // rezzed ice on HQ to lend from
  it('agrees with turnReach on 300 servers led by Mycoweb', () => {
    const { compared, reached, misses } = check(20261118, 300, '35053');
    expect(compared).toBeGreaterThan(200);
    expect(Math.min(reached, compared - reached)).toBeGreaterThan(compared / 10);
    expect(misses).toEqual([]);
  }, 600_000);
});

/**
 * The per-decision cache of the walk's 'runnerTurn' answers (Stage D item 1, ruling 4.3 on the time stop: a pure search
 * over one gathered question, the question its own key). Many boards in one decision, from different games (their
 * instance ids collide), some asked twice, some one field apart: each answer must be the answer searched afresh.
 */
describe("the hold walk's per-decision cache", () => {
  const answer = (s: GameState, corpCredits?: number) => {
    const h = serverHold(s, 'remote1', { when: 'runnerTurn', corpCredits });
    return { holds: h.holds, rez: h.rez, rezCost: h.rezCost, need: h.need, budget: h.budget, margin: h.margin, entries: h.entries };
  };
  const fresh = (s: GameState, corpCredits?: number) => withPricing({ anchor: null }, () => answer(s, corpCredits));

  it('gives the answer searched afresh, on 200 boards and their near neighbours in one decision', () => {
    const r = rng(20261119);
    const boards: GameState[] = [];
    for (let n = 0; n < 200; n++) {
      const { s } = randomBoard(r, n % 10 === 9 ? '35053' : undefined);
      boards.push(s);
      // One field apart: what the search may read (the Corp's credits, the HQ, the Runner's credits, tags, grip, clicks)
      const near = (f: (t: GameState) => void) => {
        const t = structuredClone(s);
        f(t);
        boards.push(t);
      };
      near(t => (t.corp.credits += 1));
      near(t => (t.corp.hq = t.corp.hq.slice(1)));
      for (const d of [1, 2, 3, 5, -s.runner.credits]) near(t => (t.runner.credits += d));
      near(t => (t.runner.tags += 1));
      near(t => (t.runner.grip = t.runner.grip.slice(1)));
      near(t => (t.runner.maxClicks = Math.max(1, t.runner.maxClicks - 1)));
      boards.push(structuredClone(s));
    }
    const asked = holdCacheStats.asked;
    const searched = holdCacheStats.searched;
    const misses: string[] = [];
    inCorp(boards[0], () => {
      boards.forEach((s, i) => {
        for (const credits of [undefined, Infinity]) {
          const got = answer(s, credits);
          const want = fresh(s, credits);
          if (JSON.stringify(got) !== JSON.stringify(want)) misses.push(`board ${i} ${credits}: cached ${JSON.stringify(got)}, fresh ${JSON.stringify(want)}`);
        }
      });
    });
    expect(misses).toEqual([]);
    // Hits happen (the copy of each board at least), and the fresh answers (no decision) searched every time
    const hits = holdCacheStats.asked - asked - (holdCacheStats.searched - searched);
    expect(hits).toBeGreaterThan(400);
  }, 600_000);

  it('keeps answers per decision only, and keeps none outside a decision', () => {
    const { s } = randomBoard(rng(20261120));
    const searches = (f: () => void) => {
      const before = holdCacheStats.searched;
      f();
      return holdCacheStats.searched - before;
    };
    expect(searches(() => inCorp(s, () => [answer(s), answer(s), answer(structuredClone(s))]))).toBe(1);
    // A new decision on the same board searches again (the answers died with the last decision's anchor)
    expect(searches(() => inCorp(s, () => answer(s)))).toBe(1);
    expect(searches(() => asSide('corp', () => withPricing({ anchor: null }, () => [answer(s), answer(s)])))).toBe(2);
  });

  it('keys only plain data', () => {
    expect(questionKey({ a: [1, Infinity, -Infinity], b: { c: 'x' } })).toBe('{"a":[1,"#Infinity","#-Infinity"],"b":{"c":"x"}}');
    expect(() => questionKey({ a: new Set([1]) })).toThrow();
    expect(() => questionKey({ a: () => 1 })).toThrow();
  });
});

/**
 * keepFor's run sequence (the 14:39Z ruling on its time): the question gathered once (reachQuestion), each order's
 * answer from it (reachOrder), and the sets' and orders' answers cached per decision and shared by the questions of one
 * decision (reachSets). Many boards with 4 to 9 servers in one decision, some one field apart and some asked twice, from
 * different games (their instance ids collide): every subset in every order, cached, against turnReach afresh (no
 * decision, nothing cached, each order gathered on its own); and rez money's keep against the same by brute force.
 */
describe("keepFor's run sequence, gathered once and cached per decision", () => {
  const SERVERS = ['rd', 'hq', 'archives', 'remote1', 'remote2', 'remote3', 'remote4', 'remote5', 'remote6'];
  // Ice that reads the Corp's credits (Valentão), HQ's size (Boto, Piranhas) or borrows (Mycoweb), beside the pool
  const READERS = ['34060', '34109', '34117', '35053'];
  const AGENDAS = ['30036', '30044', '30052', '30060'];
  /** At most this many orders a board (the clicks are cut to fit): every one is walked afresh. */
  const ORDERS = 400;
  const count = (n: number, k: number) => Array.from({ length: k }, (_, i) => i + 1).reduce((t, j) => t + Array.from({ length: j }, (_, x) => n - x).reduce((a, b) => a * b, 1), 0);

  // Laser Pointer: a bypass with a price (runBypasses), so a server's part carries one
  const LASER_POINTER = '34016';
  const MYCOWEB = '35053';
  const LYCIAN = '34100';

  function wideBoard(r: () => number, lend = false): { s: GameState; servers: string[] } {
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const s = newGame(3);
    s.turnNumber = 7;
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    s.runner.credits = Math.floor(r() * 13);
    s.runner.tags = r() < 0.2 ? 1 : 0;
    s.runner.grip = s.runner.grip.slice(0, 1 + Math.floor(r() * 5));
    s.corp.credits = Math.floor(r() * 15);
    s.corp.hq = s.corp.hq.slice(0, Math.floor(r() * 5));
    if (r() < 0.7) s.corp.hq.push(createCardInstance(s, pick(AGENDAS)));
    const n = 4 + Math.floor(r() * 6);
    const servers = SERVERS.slice(0, 3).concat(SERVERS.slice(3, 3 + n - 3)).slice(0, n);
    for (const id of servers) {
      for (let k = Math.floor(r() * 3); k > 0; k--) installIceForTest(s, r() < 0.15 ? pick(READERS) : pick(ICE), id, r() < 0.6);
      if (id.startsWith('remote')) installCorpForTest(s, pick(AGENDAS), id);
    }
    for (let k = Math.floor(r() * 3); k > 0; k--) installProgramForTest(s, pick(BREAKERS));
    if (r() < 0.2) installProgramForTest(s, LASER_POINTER);
    // A borrow whose lenders depend on the servers run: Mycoweb innermost on the first remote, and a rezzed Lycian (it
    // derezzes itself when the Corp's turn ends, so walked it is met unrezzed) on another server
    if (lend) {
      s.corp.servers.remote1.ice.unshift({ ...createCardInstance(s, MYCOWEB), isRezzed: true });
      installIceForTest(s, LYCIAN, pick(servers.filter(id => id !== 'remote1')), true);
      installIceForTest(s, pick(ICE), pick(servers), true);
    }
    // The clicks: 1 to 5, as many as keep every order walkable
    let clicks = 1 + Math.floor(r() * 5);
    while (clicks > 1 && count(servers.length, Math.min(clicks, servers.length)) > ORDERS) clicks--;
    s.runner.maxClicks = clicks;
    return { s, servers };
  }

  /** turnReach afresh: no decision, so nothing is cached, and each order gathered on its own. */
  const fresh = (s: GameState, order: string[]) => withPricing({ anchor: null }, () => turnReach(s, order, order.map(() => [])).reaches);
  const subsets = (ids: string[], most: number): string[][] =>
    Array.from({ length: (1 << ids.length) - 1 }, (_, m) => ids.filter((_, i) => (m + 1) & (1 << i))).filter(x => x.length <= most);

  it('gives every subset and every order the answer walked afresh, on 120 boards and their near neighbours in one decision', () => {
    const r = rng(20261121);
    const boards: { s: GameState; servers: string[] }[] = [];
    for (let n = 0; n < 120; n++) {
      const b = wideBoard(r, n % 4 === 3);
      boards.push(b);
      const near = (f: (t: GameState) => void) => {
        const t = structuredClone(b.s);
        f(t);
        boards.push({ s: t, servers: b.servers });
      };
      // One field apart: what a walk may read (the Corp's credits and HQ, the Runner's credits, tags and grip), an ice
      // rezzed or not, and the same board again
      near(t => (t.corp.credits += 2));
      near(t => (t.corp.hq = t.corp.hq.slice(1)));
      near(t => (t.runner.credits += 2));
      near(t => (t.runner.tags += 1));
      near(t => (t.runner.grip = t.runner.grip.slice(1)));
      // Another breaker in a breaker's place: the same rig facts, other break plans
      near(t => {
        const k = t.runner.rig.programs.findIndex(c => BREAKERS.includes(c.cardCode));
        if (k >= 0) t.runner.rig.programs[k] = { ...createCardInstance(t, BREAKERS[(BREAKERS.indexOf(t.runner.rig.programs[k].cardCode) + 1) % BREAKERS.length]), isRezzed: true };
      });
      near(t => {
        const ice = t.corp.servers[b.servers[n % b.servers.length]].ice[0];
        if (ice) ice.isRezzed = !ice.isRezzed;
      });
      boards.push({ s: structuredClone(b.s), servers: b.servers });
    }
    // A borrow's lenders as the servers run decide it: Mycoweb rezzed on remote1 (no decoder: its subroutines resolve),
    // Ballista rezzed on HQ with Tranquilizer at 2 counters on it (3 at the Runner's turn start: HQ's walk meets it
    // derezzed, 5.7.1d; not walked, the board has it rezzed and Mycoweb may resolve its "or end the run")
    for (const credits of [3, 6]) {
      const { s } = wideBoard(rng(credits), false);
      for (const id of ['rd', 'hq', 'archives', 'remote1', 'remote2']) s.corp.servers[id] && (s.corp.servers[id].ice = []);
      s.runner.rig.programs = [];
      s.runner.credits = credits;
      s.runner.maxClicks = 4;
      s.corp.servers.remote1.ice.push({ ...createCardInstance(s, MYCOWEB), isRezzed: true });
      const ballista = installIceForTest(s, '30062', 'hq', true);
      const tranq = createCardInstance(s, '30017');
      tranq.isRezzed = true;
      tranq.hostedOnId = ballista;
      tranq.tokens = { virus: 2 };
      s.runner.rig.programs.push(tranq);
      boards.unshift({ s, servers: ['rd', 'hq', 'archives', 'remote1'] });
    }
    const misses: string[] = [];
    let orderCount = 0;
    let reached = 0;
    inCorp(boards[0].s, () => {
      boards.forEach(({ s, servers }, i) => {
        // The question for all the servers, and one without the last (as lineFloor asks without a line's agenda)
        for (const ids of [servers, servers.slice(0, -1)]) {
          const q = reachQuestion(s, ids);
          const sets = reachSets(q);
          for (const set of subsets(ids, s.runner.maxClicks)) {
            const each = orders(set).map(o => fresh(s, o));
            orderCount += each.length;
            const want = each.some(Boolean);
            if (want) reached++;
            if (sets(set) !== want) misses.push(`board ${i} [${ids}] set [${set}]: cached ${!want}, afresh ${want}`);
            if (ids === servers) orders(set).forEach((o, k) => reachOrder(q, o) !== each[k] && misses.push(`board ${i} order [${o}]: gathered ${!each[k]}, afresh ${each[k]}`));
          }
        }
      });
    });
    expect(misses.slice(0, 10)).toEqual([]);
    expect(orderCount).toBeGreaterThan(20_000);
    expect(reached).toBeGreaterThan(1_000);
  }, 900_000);

  it("gives rez money's keep the largest set one turn reaches, every set inside it reached (brute force afresh)", () => {
    const r = rng(20261122);
    const misses: string[] = [];
    let positive = 0;
    for (let n = 0; n < 150; n++) {
      const { s } = wideBoard(r);
      const money = inCorp(s, () => rezMoney(s));
      const ids = Object.keys(money.byServer).filter(id => money.byServer[id] > 0);
      const reach = new Map<string, boolean>();
      const reaches = (set: string[]): boolean => {
        const k = set.join();
        if (!reach.has(k)) reach.set(k, set.every((_, i) => set.length === 1 || reaches(set.filter((_, j) => j !== i))) && orders(set).some(o => fresh(s, o)));
        return reach.get(k)!;
      };
      const want = Math.max(0, ...subsets(ids, s.runner.maxClicks).filter(reaches).map(set => set.reduce((t, id) => t + money.byServer[id], 0)));
      if (want > 0) positive++;
      if (money.keep !== want) misses.push(`board ${n}: keep ${money.keep}, brute ${want} (byServer ${JSON.stringify(money.byServer)})`);
    }
    expect(misses).toEqual([]);
    expect(positive).toBeGreaterThan(30);
  }, 900_000);
});
