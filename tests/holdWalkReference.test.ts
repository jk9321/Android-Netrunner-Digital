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
import { getCardDefinition } from '../src/core/cards';
import { counters, threatLevel } from '../src/core/engine/cardEffects';
import { turnKey } from '../src/core/engine/helpers';
import { iceSubroutines, iceSubtypes } from '../src/core/engine/ice';
import { createCardInstance } from '../src/core/engine/gameState';
import { installCorpForTest, installIceForTest, installProgramForTest, newGame } from './helpers';
import { TurnFrom, Walk, WalkIce, WalkPlan, WalkState, WalkTarget, corpStart, firstState, orders, reachOrder, reachQuestion, reachSets, runTarget, holdCacheStats, nextTurn, questionKey, restOfTurn, runnerEarnings, searchTarget, serverHold, turnReach, walkBoard, walkIce, walkStart } from '../src/ai/corp/hold';
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
  /** Knickknack's first run of the turn is over (from the rest of a turn where a run has begun; rules 9.6.5b, 10.11.5). */
  private readonly knickUsed: boolean;
  constructor(
    private readonly state: GameState,
    private readonly start: ReturnType<typeof walkStart>,
    private readonly targets: WalkTarget[],
  ) {
    this.walk = new Walk(walkBoard(state, start, targets), targets.map(searchTarget));
    this.knickUsed = start.runnerTurn && !start.fresh && state.runsThisTurn.length > 0;
  }

  /**
   * The run begins (6.9.1c), forward, from the card facts and the board: each Side Hustle places its credit (all taken
   * into the pool at its payout, then trashed and a card drawn), and on the turn's first run Knickknack's bound (the
   * largest printed install cost among the other installed cards, the card kept, a card drawn).
   */
  private begin(ws: S): S {
    let w: S = { ...ws, runs: ws.runs + 1 };
    const draw = (x: S, n: number): S => ({ ...x, grip: x.grip + Math.min(n, x.stack), stack: x.stack - Math.min(n, x.stack) });
    this.start.rig.forEach((c, i) => {
      const f = CARDS[c.cardCode]?.holdFacts;
      if (w.gone.includes(i)) return;
      if (f?.runBeginCredits) {
        const held = counters(c, 'credit') + f.runBeginCredits.place * w.runs;
        if (held >= f.runBeginCredits.takeAllAt) w = draw({ ...w, pool: w.pool + held, gone: sorted([...w.gone, i]) }, f.runBeginCredits.draw);
      }
      if (f?.firstRunTrashForCost && ws.runs === 0 && !this.knickUsed) {
        const most = Math.max(0, ...this.start.rig.map((r, k) => (k === i || w.gone.includes(k) ? 0 : (cardDef(r).cost ?? 0))));
        w = draw({ ...w, pool: w.pool + most }, f.firstRunTrashForCost.draw);
      }
    });
    return w;
  }

  beforeRun(ws: S, j: number): boolean {
    const runs = this.targets.length - j;
    if (ws.clicks < runs) return false;
    if (this.approach(this.begin({ ...ws, clicks: ws.clicks - 1, spike: false, fund: this.state.corp.badPublicity + ws.bp }), j, this.targets[j].ice.length - 1)) return true;
    if (ws.clicks > runs) {
      // 5.2.7c, 5.2.7g: a draw, or a click and 2 credits for a tag, with a click kept for each run left
      // The turn's first draw may give more (Verbal Plasticity)
      const n = Math.min(ws.stack, ws.drew ? 1 : this.walk['board'].firstDraw);
      if (ws.stack > 0 && this.beforeRun({ ...ws, clicks: ws.clicks - 1, grip: ws.grip + n, stack: ws.stack - n, drew: true }, j)) return true;
      if (ws.tags > 0 && ws.pool >= 2 && this.beforeRun({ ...ws, clicks: ws.clicks - 1, tags: ws.tags - 1, pool: ws.pool - 2 }, j)) return true;
    }
    return false;
  }

  /** A run that ends: the turn goes on from the state it left, the same target run again (the walk's `ended`). */
  private ended(ws: S, j: number): boolean {
    return this.beforeRun({ ...ws, fund: 0, gone: sorted([...ws.gone, ...ws.mayfly]), mayfly: [] }, j);
  }

  private approach(ws: S, j: number, pos: number): boolean {
    if (pos < 0) return j + 1 >= this.targets.length || this.beforeRun({ ...ws, fund: 0, gone: sorted([...ws.gone, ...ws.mayfly]), mayfly: [] }, j + 1);
    const ice = this.targets[j].ice[pos];
    const next: Next = w => this.approach(w, j, pos - 1);
    const end: Next = w => this.ended(w, j);
    // An ice that trashed itself on an earlier run is not there
    if (ws.trashed.includes(ice.card.instanceId)) return next(ws);
    if (!ice.rezzed && !ws.up.includes(ice.card.instanceId)) {
      if (ice.inS && ws.corp >= ice.rezCost) {
        const w: S = { ...ws, corp: ws.corp - ice.rezCost, up: [...ws.up, ice.card.instanceId].sort() };
        // A liability rez: the Corp takes 1 bad publicity (the fund from the next run on) or removes 1 tag, its choice
        if (!ice.liability) return this.rezzed(w, ice, next, end);
        return this.rezzed({ ...w, bp: w.bp + 1 }, ice, next, end) && (w.tags === 0 || this.rezzed({ ...w, tags: w.tags - 1 }, ice, next, end));
      }
      return next(ws);
    }
    return ice.bypassed ? next(ws) : this.encounter(ws, ice, next, end);
  }

  private rezzed(ws: S, ice: WalkIce, next: Next, end: Next): boolean {
    // Lycian: the Corp chooses the subtypes as it rezzes; the Runner gets through only if it gets through every choice
    if (ice.choices && !ws.chose.some(c => c.startsWith(`${ice.id}:`))) return ice.choices.every((_, k) => this.rezzed({ ...ws, chose: [...ws.chose, `${ice.id}:${k}`].sort() }, ice, next, end));
    let w = ws;
    if (ice.rezFacts?.purgeVirus) {
      const purged = this.start.rig.flatMap((c, i) => (CARDS[c.cardCode]?.holdFacts?.trashedOnPurge ? [i] : []));
      w = { ...w, virus: w.virus.map(() => 0), gone: sorted([...new Set([...w.gone, ...purged])]) };
    }
    if (ice.rezFacts?.tags) w = { ...w, tags: w.tags + ice.rezFacts.tags };
    const met = ice.rezGains ? { ...ice, subs: [...ice.subs, ice.rezGains] } : ice;
    const go = (x: S) => (ice.bypassed ? next(x) : this.encounter(x, met, next, end));
    // The Corp's choice: the Runner gets through only if it gets through whatever the Corp trashes
    if (ice.rezFacts?.corpMayTrashInstalled === 'trojan') {
      return go(w) && this.start.rig.every((c, i) => w.gone.includes(i) || !/\btrojan\b/i.test(cardDef(c).keywords ?? '') || go({ ...w, gone: sorted([...w.gone, i]) }));
    }
    return go(w);
  }

  private encounter(ws: S, ice: WalkIce, next: Next, end: Next): boolean {
    const types = this.walk['typesOf'](ice, ws);
    for (const b of ice.bypassers) if (!ws.gone.includes(b.idx) && !types.includes(b.unless) && this.pay(ws, b.per * ice.subs.length, next)) return true;
    return this.tolls(ws, ice, w => this.breaks(w, ice, types, next, end), end);
  }

  private tolls(ws: S, ice: WalkIce, then: Next, end: Next): boolean {
    const e = ice.encounterFacts;
    if (!e || ice.broken || (e.threatAtLeast !== undefined && threatLevel(this.state) < e.threatAtLeast)) return then(ws);
    const w0 = e.loses ? { ...ws, pool: Math.max(0, ws.pool - e.loses) } : ws;
    if (!e.toll) return then(w0);
    const t = e.toll;
    const u = e.unless ?? {};
    if (t.endRun ? end(w0) : then({ ...w0, pool: Math.max(0, w0.pool - (t.loses ?? 0)), tags: w0.tags + (t.tags ?? 0) })) return true;
    if (u.tags && then({ ...w0, tags: w0.tags + u.tags })) return true;
    if (u.netDamage !== undefined && u.netDamage <= w0.grip && then({ ...w0, grip: w0.grip - u.netDamage })) return true;
    return u.clicks !== undefined && u.clicks <= w0.clicks && then({ ...w0, clicks: w0.clicks - u.clicks });
  }

  /** Every set of subroutines to break, every way: Botulus counters, bioroid clicks or the ice's own price, a plan. */
  private breaks(ws: S, ice: WalkIce, types: string[], next: Next, end: Next): boolean {
    const open = ice.subs.map((_, i) => i).filter(i => !ice.broken?.[i]);
    for (let set = 0; set < 1 << open.length; set++) {
      const unbroken = open.filter((_, k) => !(set & (1 << k)));
      const b = open.length - unbroken.length;
      const resolve: Next = w => this.resolve(w, ice, types, unbroken, 0, next, end);
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

  /** The engine's order (spendCredits): the fund, then the credits on cards that pay during runs, the stealth cards' last of them, then the pool. */
  private pay(ws: S, n: number, then: Next): boolean {
    const fund = Math.min(n, ws.fund);
    const hosted = Math.min(n - fund, ws.hosted);
    const stealth = Math.min(n - fund - hosted, ws.stealth);
    const rest = n - fund - hosted - stealth;
    return rest <= ws.pool && then({ ...ws, fund: ws.fund - fund, hosted: ws.hosted - hosted, stealth: ws.stealth - stealth, pool: ws.pool - rest });
  }

  private resolve(ws: S, ice: WalkIce, types: string[], list: number[], k: number, next: Next, end: Next): boolean {
    if (k >= list.length) return next(ws);
    return this.subroutine(ws, ice.card, types, ice.subs[list[k]], w => this.resolve(w, ice, types, list, k + 1, next, end), end);
  }

  private subroutine(ws: S, card: CardInstance, types: string[], f: SubFacts, then: Next, end: Next): boolean {
    if (f.when && !(f.when.kind === 'iceIs' ? types.includes(f.when.subtype) : f.when.kind === 'runnerTagsAtLeast' && ws.tags >= f.when.n)) return then(ws);
    if (f.orEndRun) return end(ws);
    if (this.effects(ws, card, f.does, 0, then, end)) return true;
    if (f.unless?.credits !== undefined && this.pay(ws, f.unless.credits, then)) return true;
    if (f.unless?.netDamage !== undefined && f.unless.netDamage <= ws.grip && then({ ...ws, grip: ws.grip - f.unless.netDamage })) return true;
    return !!f.unless?.trashInstalled && this.start.rig.some((_, i) => !ws.gone.includes(i) && then({ ...ws, gone: sorted([...ws.gone, i]) }));
  }

  private effects(ws: S, card: CardInstance, does: SubEffect[], i: number, then: Next, end: Next): boolean {
    if (i >= does.length) return then(ws);
    const e = does[i];
    const next: Next = w => this.effects(w, card, does, i + 1, then, end);
    // The run ends where the condition holds, and goes on where it does not
    const ends = (cond: boolean) => (cond ? end(ws) : next(ws));
    switch (e.kind) {
      case 'endRun': {
        const c = e.if;
        if (!c) return end(ws);
        if (c.kind === 'runnerCreditsAtMost') return ends(ws.pool <= c.n);
        if (c.kind === 'corpCreditsMoreThanRunner') return ends(ws.corp > ws.pool);
        if (c.kind === 'runnerTagsAtLeast') return ends(ws.tags >= c.n);
        if (c.kind === 'threatAtLeast') return ends(threatLevel(this.state) >= c.n);
        if (c.kind === 'hqMoreThanGrip') return ends(this.state.corp.hq.length > ws.grip);
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
        return end(ws);
      case 'trashThisIce':
        return next({ ...ws, trashed: [...ws.trashed, card.instanceId].sort() });
      case 'corpMayTrashHqToEndRun':
        return ends(this.state.corp.hq.length > 0);
      case 'borrow': {
        // The Corp picks the subroutine: the Runner gets through only if it gets through each one
        const walked = new Map(this.targets.flatMap(t => t.ice.map(x => [x.card.instanceId, x] as const)));
        let any = false;
        for (const sv of Object.values(this.state.corp.servers)) {
          for (const c of sv.ice) {
            if (c.instanceId === card.instanceId || ws.trashed.includes(c.instanceId)) continue;
            const w = walked.get(c.instanceId);
            if (!(w ? w.rezzed || ws.up.includes(c.instanceId) : c.isRezzed)) continue;
            const up = w ? w.card : c;
            const types = w ? w.types : iceSubtypes(c, this.state);
            if (!types.includes(e.subtype)) continue;
            for (const sub of iceSubroutines(this.state, up)) {
              if (/resolve 1 subroutine on/i.test(sub.label)) continue;
              any = true;
              if (!this.subroutine(ws, up, types, subroutineFacts(sub.label), next, end)) return false;
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

/**
 * The brute force's answer for turnReach(state, servers, rezSets): some split of the clicks gets through them all. `from`:
 * the turn's start (hold.ts TurnFrom): the next turn (default), or the rest of the turn under way (Stage D item 3: its
 * clicks left, its credits, no turn-start money or counters again).
 */
function bruteReach(state: GameState, servers: string[], rezSets: string[][], from: TurnFrom = nextTurn(state), picked?: string[]): boolean | null {
  const start = walkStart(state, true, !from.rest, picked);
  const bases = new Map<string, WalkIce[]>();
  const runs = servers.map((id, i) => runTarget(state, bases.get(id) ?? bases.set(id, walkIce(state, start, state.corp.servers[id]?.ice ?? [])).get(id)!, id, new Set(rezSets[i]), from.clicks));
  // A bypass's price is a worth, not credits (registry debt): boards with one are left out
  if (runs.some(r => r.price > 0)) return null;
  const corp = corpStart(state, [...bases.values()].flat(), state.corp.credits);
  const earn = runnerEarnings(state, from);
  const c = from.clicks;
  const brute = new Brute(state, start, runs.map(r => r.target));
  for (let e = 0; e + servers.length <= c; e++) if (brute.beforeRun({ ...firstState(state, start, c - e, corp), pool: from.credits + earn[e] }, 0)) return true;
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
const PALISADE = '30072';
const IDENTITY_THUNDERBOLT = '34096';

/** Ice that ends the run whatever the state on some subroutine: the inner ice of a probe line. */
const ENDERS = ICE.filter(code => /end the run\./i.test(getCardDefinition(code).text ?? ''));
/**
 * Ice whose rez leaves the turn something a later run reads (brief rev 2, 2.2): Ping's tag (30055), a trojan trashed
 * (35041), a purge (35079), Lycian's subtypes (34100), a self-trash (Vicsek, 36042), a rez for 0 (Vovô Ozetti, 34038), a
 * liability rez (Valentão 34060, Piranhas 34117: bad publicity or a tag).
 */
const PROBES = ['30055', '35041', '35079', '34100', '36042', '34038', '34060', '34117'];

/**
 * A random server: 1 to 3 ice from the pool (some unrezzed), 0 to 2 breakers, maybe a Botulus, the Runner's means at
 * random. `first` is the innermost ice. `probe` builds the probe line the failed run is about (brief rev 2, 4): an
 * ending ice innermost, maybe one more, and outermost an unrezzed ice with a rez-time fact, always in the rez set.
 */
function randomBoard(r: () => number, first?: string, probe = false): { s: GameState; rez: string[] } {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const s = newGame(3);
  s.turnNumber = 7;
  s.corp.hq = s.corp.hq.slice(0, Math.floor(r() * 4));
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = Math.floor(r() * 9);
  s.runner.tags = r() < 0.3 ? Math.floor(r() * 3) : 0;
  s.runner.grip = s.runner.grip.slice(0, Math.floor(r() * 6));
  s.runner.maxClicks = probe ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 4);
  s.corp.credits = Math.floor(r() * 12);
  s.corp.badPublicity = r() < 0.15 ? 1 : 0;
  if (r() < (probe ? 0.3 : 0.1)) s.corp.identity = createCardInstance(s, IDENTITY_THUNDERBOLT);
  const ids: string[] = [];
  if (probe) {
    ids.push(installIceForTest(s, pick(ENDERS), 'remote1', r() < 0.5));
    if (r() < 0.4) ids.push(installIceForTest(s, pick(ICE), 'remote1', r() < 0.5));
    ids.push(installIceForTest(s, pick(PROBES), 'remote1', false));
  } else {
    if (first) ids.push(installIceForTest(s, first, 'remote1', r() < 0.5));
    for (let k = (first ? 0 : 1) + Math.floor(r() * 3); k > 0; k--) ids.push(installIceForTest(s, pick(ICE), 'remote1', r() < 0.6));
  }
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
  const outer = ids[ids.length - 1];
  return { s, rez: unrezzed.filter(id => (probe && id === outer) || r() < 0.6) };
}

const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));

/**
 * The brute force's answer for serverHold's `holds` ('runnerTurn'): some rez set the Corp can afford (each subset of the
 * server's unrezzed ice, at the walk's rez costs) that no line of the Runner's turn gets through. Null where a set's
 * bypass has a price (as bruteReach).
 */
function bruteHolds(state: GameState, server: string, from: TurnFrom = nextTurn(state), picked?: string[]): boolean | null {
  const start = walkStart(state, true, !from.rest, picked);
  const all = state.corp.servers[server].ice;
  const base = walkIce(state, start, all);
  const open = all.map((_, i) => i).filter(i => !base[i].rezzed);
  let holds = false;
  for (let mask = 0; mask < 1 << open.length; mask++) {
    const set = open.filter((_, k) => mask & (1 << k));
    if (set.reduce((n, i) => n + base[i].rezCost, 0) > state.corp.credits) continue;
    const got = bruteReach(state, [server], [set.map(i => all[i].instanceId)], from, picked);
    if (got === null) return null;
    if (!got) holds = true;
  }
  return holds;
}

describe('the hold walk against a brute force of the same model (brief section 6)', () => {
  // Every fourth board two runs; every fifth one-run board also asks serverHold's `holds` of every affordable set
  const check = (seed: number, boards: number, first?: string, probe = false, dress?: (s: GameState, r: () => number) => void) => {
    const r = rng(seed);
    const misses: string[] = [];
    let compared = 0;
    let reached = 0;
    let held = 0;
    let holdsAsked = 0;
    for (let n = 0; n < boards; n++) {
      const { s, rez } = randomBoard(r, first, probe);
      dress?.(s, r);
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
      if (runs === 1 && n % 5 === 0) {
        const holds = inCorp(s, () => bruteHolds(s, 'remote1'));
        if (holds === null) continue;
        holdsAsked++;
        if (holds) held++;
        const h = inCorp(s, () => serverHold(s, 'remote1', { when: 'runnerTurn' }));
        if (h.holds !== holds) misses.push(`#${n} holds: walk ${h.holds}, brute ${holds}`);
      }
    }
    return { compared, reached, misses, held, holdsAsked };
  };

  // 12,000 boards over the three seeds (brief rev 2, section 4): 8,000 random, 1,000 led by Mycoweb, 3,000 probe lines
  it('agrees with turnReach and serverHold on 8,000 random servers, one run and two (seed 20261117)', () => {
    const { compared, reached, misses, held, holdsAsked } = check(20261117, 8000);
    expect(compared).toBeGreaterThan(6000);
    // Both answers well represented (the boards are not all open or all shut)
    expect(Math.min(reached, compared - reached)).toBeGreaterThan(compared / 5);
    expect(Math.min(held, holdsAsked - held)).toBeGreaterThan(holdsAsked / 10);
    expect(misses).toEqual([]);
  }, 600_000);

  // The failed run's probe line: an outer ice whose rez leaves the turn something (its rez-time fact, a self-trash, a rez
  // for 0), an ending ice inside it; 2 to 4 clicks, Thunderbolt's identity on 3 in 10
  it('agrees with turnReach and serverHold on 3,000 probe lines (seed 20261119)', () => {
    const { compared, reached, misses, held, holdsAsked } = check(20261119, 3000, undefined, true);
    expect(compared).toBeGreaterThan(2000);
    expect(Math.min(reached, compared - reached)).toBeGreaterThan(compared / 10);
    expect(Math.min(held, holdsAsked - held)).toBeGreaterThan(holdsAsked / 10);
    expect(misses).toEqual([]);
  }, 600_000);

  // Stealth credits (found-list row 31, the review of ai-hold-stealth R3): Touchstone holding 1 to 5 on every board, its
  // credits paying any cost during a run in the engine's order (before the pool), and Corsair (36004) on half, whose
  // plans have a stealth part and cost more than it (lower by 3 a stealth credit, then break for 1); the pool at 0 to 3,
  // so where the stealth credits went turns the answer
  it('agrees with turnReach and serverHold on 3,000 servers with stealth credits (seed 20261123)', () => {
    const touchstone = (s: GameState, r: () => number) => {
      const t = createCardInstance(s, '36021');
      t.isRezzed = true;
      t.tokens = { credit: 1 + Math.floor(r() * 5) };
      s.runner.rig.hardware.push(t);
      if (r() < 0.5) installProgramForTest(s, '36004');
      s.runner.credits = Math.floor(r() * 4);
    };
    const { compared, reached, misses, held, holdsAsked } = check(20261123, 3000, undefined, false, touchstone);
    expect(compared).toBeGreaterThan(2000);
    expect(Math.min(reached, compared - reached)).toBeGreaterThan(compared / 10);
    expect(Math.min(held, holdsAsked - held)).toBeGreaterThan(holdsAsked / 10);
    expect(misses).toEqual([]);
  }, 600_000);

  // Mycoweb innermost (its three borrows: the lenders worked out once, a borrow's draws and tags, its steps keyed), a
  // rezzed ice on HQ to lend from
  it('agrees with turnReach and serverHold on 1,000 servers led by Mycoweb (seed 20261118)', () => {
    const { compared, reached, misses } = check(20261118, 1000, '35053');
    expect(compared).toBeGreaterThan(700);
    expect(Math.min(reached, compared - reached)).toBeGreaterThan(compared / 10);
    expect(misses).toEqual([]);
  }, 600_000);
});

/**
 * Stage D item 3 (F1; item3-rez-money/design-answer.md section 2, point 5): the 'restOfTurn' horizon is the same walk from
 * a different start, the rest of the Runner's turn under way: its clicks left, its credits (once the run under way is
 * paid), no turn-start money or counters placed again (walkStart's fresh false: Botulus, Tranquilizer, Lycian), the
 * turn's first draw taken or not (turnFlags basic_draws). On mid-turn boards serverHold 'restOfTurn' and rez money's run
 * sequence (reachQuestion from the same start, reachOrder) must agree with the brute force from that start.
 */
describe("the hold walk from the rest of the Runner's turn (mid-turn starts)", () => {
  const midTurn = (s: GameState, r: () => number): number => {
    s.runner.maxClicks = 2 + Math.floor(r() * 3);
    s.runner.clicks = Math.floor(r() * (s.runner.maxClicks + 1));
    if (r() < 0.5) s.turnFlags = { ...s.turnFlags, basic_draws: 1 };
    // Half the boards with a run under way (on HQ): the horizon reads the board with it over
    if (r() < 0.5) s.activeRun = { server: 'hq' } as GameState['activeRun'];
    return Math.floor(r() * 9);
  };

  it('agrees with serverHold and reachOrder on 2,000 mid-turn servers, one run and two (seed 20261124)', () => {
    const r = rng(20261124);
    const misses: string[] = [];
    let compared = 0;
    let reached = 0;
    let held = 0;
    let holdsAsked = 0;
    let differs = 0;
    for (let n = 0; n < 2000; n++) {
      const { s } = randomBoard(r, undefined, n % 3 === 2);
      if (r() < 0.3) installIceForTest(s, ICE[Math.floor(r() * ICE.length)], 'hq', true);
      const credits = midTurn(s, r);
      const board: GameState = { ...s, activeRun: null };
      // The brute force's start written out (not hold.ts's restOfTurn, which the walk side reads)
      const from: TurnFrom = { rest: true, clicks: s.runner.clicks, credits };
      const order = n % 2 ? ['remote1'] : ['hq', 'remote1'];
      const want = inCorp(s, () => bruteReach(board, order, order.map(() => []), from));
      if (want !== null) {
        compared++;
        if (want) reached++;
        const got = inCorp(s, () => reachOrder(reachQuestion(board, order, restOfTurn(board, credits)), order));
        if (got !== want) misses.push(`#${n} reach [${order}]: walk ${got}, brute ${want}; $${credits} clicks ${s.runner.clicks}/${s.runner.maxClicks}`);
      }
      const holds = inCorp(s, () => bruteHolds(board, 'remote1', from));
      if (holds === null) continue;
      holdsAsked++;
      if (holds) held++;
      const h = inCorp(s, () => serverHold(s, 'remote1', { when: 'restOfTurn', runnerCredits: credits }));
      if (h.holds !== holds) misses.push(`#${n} holds: walk ${h.holds}, brute ${holds}; $${credits} clicks ${s.runner.clicks}/${s.runner.maxClicks}`);
      // The start matters: the next turn's answer differs from the rest of this one's on some boards
      if (inCorp(s, () => bruteHolds(board, 'remote1')) !== holds) differs++;
    }
    expect(compared).toBeGreaterThan(1200);
    expect(Math.min(reached, compared - reached)).toBeGreaterThan(compared / 10);
    expect(Math.min(held, holdsAsked - held)).toBeGreaterThan(holdsAsked / 10);
    expect(differs).toBeGreaterThan(holdsAsked / 20);
    expect(misses).toEqual([]);
  }, 600_000);

  // The earnings are a fact both sides read (runnerEarnings): the turn-start money is not paid again mid-turn
  it("pays no turn-start money from the rest of the turn (Smartware Distributor's 1 hosted credit)", () => {
    const s = newGame(3);
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [{ ...createCardInstance(s, '30033'), isRezzed: true, tokens: { credit: 3 } }] };
    expect(getCardDefinition('30033').title).toBe('Smartware Distributor');
    expect(runnerEarnings(s)[0]).toBe(1);
    expect(runnerEarnings(s, restOfTurn(s))[0]).toBe(0);
  });

  // The start's content, read directly (review R2): the brute force calls the same walkStart, firstState and
  // runnerEarnings, so it cannot see a fault in them
  it("places no turn-start counters and derezzes no Lycian from the rest of the turn (5.7.1 is behind it)", () => {
    const s = newGame(3);
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    const lycian = installIceForTest(s, '34100', 'remote1', true);
    const b = createCardInstance(s, BOTULUS);
    b.isRezzed = true;
    b.hostedOnId = lycian;
    b.tokens = { virus: 1 };
    s.runner.rig.programs.push(b);
    const next = walkStart(s, true);
    const rest = walkStart(s, true, false);
    const i = next.index.get(b.instanceId)!;
    expect([next.virus[i], rest.virus[i]]).toEqual([2, 1]);
    expect([next.derezzed.has(lycian), rest.derezzed.has(lycian)]).toEqual([true, false]);
    expect([next.fresh, rest.fresh]).toEqual([true, false]);
  });

  it("adds no turn-start virus counter to a click ability's money from the rest of the turn (Fermenter)", () => {
    const s = newGame(3);
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    const id = installProgramForTest(s, '30007');
    s.runner.rig.programs.find(c => c.instanceId === id)!.tokens = { virus: 2 };
    expect(getCardDefinition('30007').title).toBe('Fermenter');
    s.runner.maxClicks = 4;
    s.runner.clicks = 4;
    // One earning click: Fermenter trashed for 2 a counter, 3 counters as the next turn begins, 2 now
    expect(runnerEarnings(s)[1]).toBe(6);
    expect(runnerEarnings(s, restOfTurn(s))[1]).toBe(4);
  });

  it("reads the turn's first draw as taken from the rest of the turn when the board's turn flags say so", () => {
    const s = newGame(3);
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    const drawn = { ...s, turnFlags: { ...s.turnFlags, basic_draws: 1 } };
    expect(firstState(drawn, walkStart(drawn, true, false), 3, 0).drew).toBe(true);
    expect(firstState(drawn, walkStart(drawn, true), 3, 0).drew).toBe(false);
    expect(firstState(s, walkStart(s, true, false), 3, 0).drew).toBe(false);
  });

  // The memos keyed on the board (turnIce, the walk's plans) keep the start's kind: one board asked from both starts in
  // one decision (no run under way, so afterRun is the board itself). Tranquilizer at 2 counters on a rezzed Palisade on
  // remote1, no breaker, no money: the rest of the turn meets the Palisade rezzed (held for nothing); the next turn's
  // start places Tranquilizer's third counter and derezzes it (5.7.1d), so it is held only by rezzing it again
  it("keeps a board's walked ice apart by start: an ice Tranquilizer derezzes as the next turn begins, asked from both starts, in either order", () => {
    const make = () => {
      const s = newGame(3);
      s.turnNumber = 7;
      for (const id of Object.keys(s.corp.servers)) s.corp.servers[id].ice = [];
      s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
      s.runner.credits = 0;
      s.runner.clicks = 1;
      const host = installIceForTest(s, PALISADE, 'remote1', true);
      const tranq = createCardInstance(s, '30017');
      tranq.isRezzed = true;
      tranq.hostedOnId = host;
      tranq.tokens = { virus: 2 };
      s.runner.rig.programs.push(tranq);
      return s;
    };
    const ask = (s: GameState, when: 'runnerTurn' | 'restOfTurn') => inCorp(s, () => serverHold(s, 'remote1', { when, corpCredits: Infinity }).rezCost);
    const alone = { next: ask(make(), 'runnerTurn'), rest: ask(make(), 'restOfTurn') };
    expect(alone.rest).toBe(0);
    expect(alone.next).toBeGreaterThan(0);
    const a = make();
    expect([ask(a, 'runnerTurn'), ask(a, 'restOfTurn')]).toEqual([alone.next, alone.rest]);
    const b = make();
    expect([ask(b, 'restOfTurn'), ask(b, 'runnerTurn')]).toEqual([alone.rest, alone.next]);
  });
});

/**
 * Stage D item 1 follow-up 4, part 1 (ai-runner-money): the money that arrives as a run begins is walk state (Side
 * Hustle's credits, all taken at 6; Knickknack's first run of the turn, as the bound), from both starts. The brute force
 * gains it into the pool forward, read from the card facts and the board (Brute.begin), with no memo and no cut; the
 * walk takes it off the need backward (Walk.runBegins). On random servers with those cards, from the next turn and from
 * the rest of a turn (a run begun this turn or not, Knickknack installed this turn or not), they must agree.
 */
describe('the hold walk with the money a run brings as it begins (run-begin starts)', () => {
  const money = (s: GameState, r: () => number) => {
    const res = (code: string, credits = 0) => {
      const c = createCardInstance(s, code);
      c.isRezzed = true;
      if (credits) c.tokens = { credit: credits };
      s.runner.rig.resources.push(c);
      return c;
    };
    // At most one Side Hustle: two at 5 with Knickknack make the brute force's forward search minutes long on one board
    if (r() < 0.7) res('35034', Math.floor(r() * 6));
    if (r() < 0.5) {
      const k = res('35033');
      if (r() < 0.3) k.installedTurn = turnKey(s);
    }
    // A card for Knickknack to trash besides the breakers (Carnivore 4, Pennyshaver 3, Docklands Pass 2)
    if (r() < 0.5) {
      const c = createCardInstance(s, ['30003', '30014', '30013'][Math.floor(r() * 3)]);
      c.isRezzed = true;
      s.runner.rig.hardware.push(c);
    }
    s.runner.credits = Math.floor(r() * 5);
  };
  const plain = (s: GameState): GameState => {
    const t = structuredClone(s);
    t.runner.rig.resources = t.runner.rig.resources.filter(c => !['35034', '35033'].includes(c.cardCode));
    return t;
  };

  it('agrees with turnReach and serverHold on 3,000 servers with Side Hustle and Knickknack, from the next turn (seed 20261125)', () => {
    const r = rng(20261125);
    const misses: string[] = [];
    let compared = 0;
    let reached = 0;
    let held = 0;
    let holdsAsked = 0;
    let differs = 0;
    for (let n = 0; n < 3000; n++) {
      const { s, rez } = randomBoard(r, undefined, n % 3 === 2);
      money(s, r);
      const runs = n % 4 === 3 ? 2 : 1;
      const servers = Array(runs).fill('remote1');
      const sets = Array(runs).fill(rez);
      const want = inCorp(s, () => bruteReach(s, servers, sets));
      if (want === null) continue;
      compared++;
      if (want) reached++;
      const got = inCorp(s, () => turnReach(s, servers, sets).reaches);
      if (got !== want) misses.push(`#${n} runs ${runs}: walk ${got}, brute ${want}; rig ${[...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => cardDef(c).title)}; $${s.runner.credits} clicks ${s.runner.maxClicks}`);
      if (inCorp(s, () => bruteReach(plain(s), servers, sets)) !== want) differs++;
      if (runs === 1 && n % 3 === 0) {
        const holds = inCorp(s, () => bruteHolds(s, 'remote1'));
        if (holds === null) continue;
        holdsAsked++;
        if (holds) held++;
        const h = inCorp(s, () => serverHold(s, 'remote1', { when: 'runnerTurn' }));
        if (h.holds !== holds) misses.push(`#${n} holds: walk ${h.holds}, brute ${holds}`);
      }
    }
    expect(compared).toBeGreaterThan(2000);
    expect(Math.min(reached, compared - reached)).toBeGreaterThan(compared / 10);
    expect(Math.min(held, holdsAsked - held)).toBeGreaterThan(holdsAsked / 10);
    // The money turns the answer on some boards (the cards are not idle here)
    expect(differs).toBeGreaterThan(compared / 20);
    expect(misses).toEqual([]);
  }, 600_000);

  it('agrees with serverHold and reachOrder on 2,000 mid-turn servers with Side Hustle and Knickknack (seed 20261126)', () => {
    const r = rng(20261126);
    const misses: string[] = [];
    let compared = 0;
    let reached = 0;
    let held = 0;
    let holdsAsked = 0;
    for (let n = 0; n < 2000; n++) {
      const { s } = randomBoard(r, undefined, n % 3 === 2);
      money(s, r);
      s.runner.maxClicks = 2 + Math.floor(r() * 3);
      s.runner.clicks = Math.floor(r() * (s.runner.maxClicks + 1));
      if (r() < 0.6) s.runsThisTurn = [{ server: 'hq', successful: false }];
      const credits = Math.floor(r() * 5);
      const from: TurnFrom = { rest: true, clicks: s.runner.clicks, credits };
      const order = n % 2 ? ['remote1'] : ['remote1', 'remote1'];
      const want = inCorp(s, () => bruteReach(s, order, order.map(() => []), from));
      if (want !== null) {
        compared++;
        if (want) reached++;
        const got = inCorp(s, () => reachOrder(reachQuestion(s, order, restOfTurn(s, credits)), order));
        if (got !== want) misses.push(`#${n} reach [${order}]: walk ${got}, brute ${want}; $${credits} clicks ${s.runner.clicks}/${s.runner.maxClicks}`);
      }
      const holds = inCorp(s, () => bruteHolds(s, 'remote1', from));
      if (holds === null) continue;
      holdsAsked++;
      if (holds) held++;
      const h = inCorp(s, () => serverHold(s, 'remote1', { when: 'restOfTurn', runnerCredits: credits }));
      if (h.holds !== holds) misses.push(`#${n} holds: walk ${h.holds}, brute ${holds}; $${credits} clicks ${s.runner.clicks}/${s.runner.maxClicks}`);
    }
    expect(compared).toBeGreaterThan(1200);
    expect(Math.min(reached, compared - reached)).toBeGreaterThan(compared / 10);
    expect(Math.min(held, holdsAsked - held)).toBeGreaterThan(holdsAsked / 10);
    expect(misses).toEqual([]);
  }, 600_000);

  // Lightning Laboratory's picks (ruling 8 (a)): the brute force asks each pick of 2 of the server's rezzed ice on its
  // own (the pairs written out here), the server holding only if every pick holds
  it("agrees with serverHold on 600 servers with Lightning Laboratory's turn end, 3 or more rezzed (seed 20261127)", () => {
    const r = rng(20261127);
    const misses: string[] = [];
    let asked = 0;
    let held = 0;
    for (let n = 0; n < 600; n++) {
      const { s } = randomBoard(r);
      for (let k = 3 - s.corp.servers.remote1.ice.filter(c => c.isRezzed).length; k > 0; k--) installIceForTest(s, ICE[Math.floor(r() * ICE.length)], 'remote1', true);
      const lab = createCardInstance(s, '34097');
      s.corp.scoreArea.push(lab);
      s.turnFlags = { ...s.turnFlags, [`lightning:${lab.instanceId}`]: Object.keys(s.corp.servers).indexOf('remote1') + 1 };
      const up = s.corp.servers.remote1.ice.filter(c => c.isRezzed).map(c => c.instanceId);
      const pairs = up.flatMap((a, i) => up.slice(i + 1).map(b => [a, b]));
      const each = pairs.map(p => inCorp(s, () => bruteHolds(s, 'remote1', nextTurn(s), p)));
      if (each.includes(null)) continue;
      asked++;
      const holds = each.every(Boolean);
      if (holds) held++;
      const h = inCorp(s, () => serverHold(s, 'remote1', { when: 'runnerTurn' }));
      if (h.holds !== holds) misses.push(`#${n}: walk ${h.holds}, brute ${holds} (${each})`);
    }
    expect(asked).toBeGreaterThan(400);
    expect(Math.min(held, asked - held)).toBeGreaterThan(asked / 20);
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

  // Review R6: boards where a cache keyed with less than the answer reads gives a wrong answer
  const bare = (credits: number, clicks: number) => {
    const s = newGame(3);
    s.turnNumber = 7;
    for (const id of Object.keys(s.corp.servers)) s.corp.servers[id].ice = [];
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    s.runner.credits = credits;
    s.runner.maxClicks = clicks;
    return s;
  };

  it("keys a server's part with its bypasses' price: two boards a price apart in one decision (review R6)", () => {
    // Malandragem with 3 power counters at threat 4: its counter's bypass (one counter's worth) while its once-a-turn use
    // is open, else the removal at threat 4 (every counter's worth): runBypasses' price, from a turn flag the walk does not
    // read. Whitespace (strength 0), no breaker, $3: the bypass or nothing
    const make = (used: boolean) => {
      const s = bare(3, 1);
      s.corp.score = 4;
      installIceForTest(s, '30074', 'remote1', true);
      const m = installProgramForTest(s, '34081');
      s.runner.rig.programs.find(c => c.instanceId === m)!.tokens = { power: 3 };
      if (used) s.turnFlags[`once:${m}:0`] = 1;
      return s;
    };
    const cheap = make(false);
    const dear = make(true);
    expect([fresh(cheap, ['remote1']), fresh(dear, ['remote1'])]).toEqual([true, false]);
    inCorp(cheap, () => {
      for (const s of [cheap, dear, cheap]) expect(reachSets(reachQuestion(s, ['remote1']))(['remote1'])).toBe(fresh(s, ['remote1']));
    });
  });

  it("keeps one walk memo per set of a question: a lender walked in one set and not in the other (review R6)", () => {
    // Mycoweb rezzed outside Funhouse on remote1, no decoder: its sentry borrow resolves Ballista's "trash 1 installed
    // program or end the run" while Ballista lends. Ballista rezzed on HQ with Tranquilizer at 2 counters: HQ's walk meets
    // it derezzed (5.7.1d), so a set that runs HQ has no lender; one that does not, has it (the lenders as the board has
    // them). Lamplighter rezzed outside it on HQ: $3 pays its first subroutine untagged, and Funhouse tags the Runner, so
    // {HQ, remote1} gets in only in that order, with remote1 last. R&D empty: {R&D, remote1} meets remote1 last too, with
    // the same clicks and state, so only the memo kept per set tells the two apart
    const s = bare(3, 2);
    installIceForTest(s, '30054', 'remote1', true);
    installIceForTest(s, MYCOWEB, 'remote1', true);
    const ballista = installIceForTest(s, '30062', 'hq', true);
    installIceForTest(s, '35080', 'hq', true);
    const tranq = createCardInstance(s, '30017');
    tranq.isRezzed = true;
    tranq.hostedOnId = ballista;
    tranq.tokens = { virus: 2 };
    s.runner.rig.programs.push(tranq);
    const want = [fresh(s, ['remote1']), fresh(s, ['rd', 'remote1']), fresh(s, ['remote1', 'rd']), fresh(s, ['hq', 'remote1']), fresh(s, ['remote1', 'hq'])];
    expect(want).toEqual([false, false, false, true, false]);
    inCorp(s, () => {
      const sets = reachSets(reachQuestion(s, ['rd', 'hq', 'remote1']));
      expect([sets(['remote1']), sets(['rd', 'remote1']), sets(['hq', 'remote1'])]).toEqual([false, false, true]);
    });
  });

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

  // Stage D item 3 (review R2): rez money's run sequence from the rest of the turn (rezMoney's restOfTurn keep): the
  // largest set the rest of the turn reaches in some order, from the same start (reachQuestion with restOfTurn, each
  // order alone), every set inside it reached; the clicks left cut the sets. Some boards must answer differently from the
  // same count from the next turn, or the start would not be tested
  it("gives the rest-of-turn keep the largest set the rest of the turn reaches, every set inside it reached", () => {
    const r = rng(20261125);
    const misses: string[] = [];
    let positive = 0;
    let differs = 0;
    for (let n = 0; n < 400; n++) {
      const { s } = wideBoard(r);
      // Two clicks left (one where the turn has one) and little money: the next turn's clicks and credits reach more
      s.runner.clicks = Math.min(2, s.runner.maxClicks);
      const credits = Math.floor(r() * 3);
      const from = restOfTurn(s, credits);
      const money = inCorp(s, () => rezMoney(s, { restOfTurn: { runnerCredits: credits } }));
      const ids = Object.keys(money.byServer).filter(id => money.byServer[id] > 0);
      const keepFrom = (start: TurnFrom) => {
        const reach = new Map<string, boolean>();
        const reaches = (set: string[]): boolean => {
          const k = set.join();
          if (!reach.has(k)) reach.set(k, set.every((_, i) => set.length === 1 || reaches(set.filter((_, j) => j !== i))) && orders(set).some(o => inCorp(s, () => reachOrder(reachQuestion(s, o, start), o))));
          return reach.get(k)!;
        };
        return Math.max(0, ...subsets(ids, from.clicks).filter(reaches).map(set => set.reduce((t, id) => t + money.byServer[id], 0)));
      };
      const want = keepFrom(from);
      if (want > 0) positive++;
      if (keepFrom(nextTurn(s)) !== want) differs++;
      if (money.keep !== want) misses.push(`board ${n}: keep ${money.keep}, from the rest of the turn ${want} (byServer ${JSON.stringify(money.byServer)}, clicks ${from.clicks}, $${credits})`);
    }
    expect(misses).toEqual([]);
    expect(positive).toBeGreaterThan(60);
    // 6 of 400 on this seed: each is a board where the next turn's clicks or money reach a set the rest of the turn does not
    expect(differs).toBeGreaterThan(3);
  }, 900_000);
});
