/**
 * Valuation V-A, the disagreement log (brief-stage-va-owners.md rev 2, section 3, and the red-team rulings 4, 9, 10):
 * every valuation owner and copy in the eight valuation files hands the value it priced to valueModel.ts logValue, which
 * passes it to the diagnostics sink's onValue. This script installs that sink while the AI decides, on the recorded
 * states (the 56 local deals, both sides; Jeff's games in tests/fixtures/human-games, both sides at every state), and:
 *
 *  1. counts every ask per site, tagged root, leaf, playout, reply or outside (where in the decision it was asked);
 *  2. keeps a reservoir of K samples per site and tag: the board (a copy), the arguments, the value play got, and the
 *     pricing context it was asked in;
 *  3. afterwards, with no sink, in a pass of its own (the incomplete-key caches cleared before each sample and nothing
 *     carried back into play), restores each sample's context and prices again: the owner (known-answer check 1: the
 *     number play got, n of n) and each copy with the comparison docs/ai-priced-quantities.md states for it;
 *  4. on the Corp formula cards (48), the two V-B columns on the sampled boards: the worth as today against the cost
 *     subtracted once (f(0) - cost) with its linearity in the cost, and the worth with PAYOUT_RISK.corpBare at 0.06
 *     against the measured risks (bare: bareAssetRisk, iced: moneyIced).
 *
 * The play itself is not changed: logValue returns the value it was handed, the sink only copies. Per shard, writes
 * OUT_DIR/value-log.json; scripts/value-owners/sum.mjs adds the shards up.
 *   SHARD=0/64 OUT_DIR=out npx vite-node scripts/value-owners/log.ts -- [K]
 * DEALS= and HUMAN= pick sources as scripts/stage-a/harness.ts reads them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, SideCode, actingSide as whoActs, cardDef, createInitialGameState, executeAction, getCardDefinition } from '../../src/core';
import { resourceTrashHqCost } from '../../src/core/engine/actions/basic';
import { counters } from '../../src/core/engine/cardEffects';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { installDiagnostics, newDiagnostics } from '../../src/ai/diagnostics';
import { Pricing, pricing, withPricing } from '../../src/ai/pricing';
import { CLICK, RATES, cardRate, flatlineWorth, payoutSlide, pointGain, reachCard, sampledEndWorth, sideCreditValue, valueLoops } from '../../src/ai/valueModel';
import { clickPrice, handByCard, heldWorth, ownHandValue } from '../../src/ai/handValues';
import { agendaWorth, corpCardValue, handValue, hqTrashCardsLoss, keepValue, tagsWorth } from '../../src/ai/evaluate';
import { agendaOdds, corpEffect, damageWorth, perTurn, rezzedWorth } from '../../src/ai/effectValues';
import { EFFECT_CODES } from '../../src/ai/cards';
import { flatIceWorth, iceWorth } from '../../src/ai/iceValues';
import { counterWorth, countersWorth } from '../../src/ai/counterValues';
import { CARD_PROFILES, bareAssetRisk, payoutWait, payoutWorth, turnsLeft, unrezzedWorth } from '../../src/ai/cardProfiles';
import { PAYOUT_RISK } from '../../src/ai/payoutRisk';
import { corpKeepValue, runnerCardValue, upgradeValue } from '../../src/ai/cardValues';
import { CARDS, corpFormula } from '../../src/ai/cards';
import { clearCaches, dealState, deals, humanFiles } from '../stage-a/harness';

const K = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? process.env.ARGS?.trim() ?? 4) || 4;
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const OUT = process.env.OUT_DIR ?? '.';

type Tag = 'root' | 'leaf' | 'playout' | 'reply' | 'outside';
interface Sample {
  q: string;
  site: string;
  tag: Tag;
  src: string;
  turn: number;
  value: number;
  state: GameState | undefined;
  args: unknown[];
  ctx: Partial<Pricing>;
}

// ---- 1, 2: the sink -------------------------------------------------------------------------------------------------
let rng = 0x9e3779b9 ^ (shard * 7919);
const random = () => {
  rng = (rng + 0x6d2b79f5) | 0;
  let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const asks = new Map<string, Record<Tag, number>>();
const pools = new Map<string, { seen: number; kept: Sample[] }>();
let where = { src: '', turn: 0 };
let sinkOn = false;

const snapshot = (): Partial<Pricing> => {
  const c = pricing();
  return {
    side: c.side,
    plan: c.plan,
    frozen: c.frozen,
    known: { ...c.known },
    anchor: c.anchor ? { ...c.anchor, deckValues: new Map(), stops: c.anchor.stops ? new Map(c.anchor.stops) : undefined } : null,
    leaves: [...c.leaves],
    averaging: c.averaging,
    pricingRootDeck: c.pricingRootDeck,
    pricingTagLoss: c.pricingTagLoss,
    pricingIce: c.pricingIce,
    planning: c.planning,
    decisionSeed: c.decisionSeed,
    rezzingToUse: new Set(c.rezzingToUse),
    pricingBreakers: new Set(c.pricingBreakers),
    oracleRunning: c.oracleRunning,
  };
};

/**
 * V-B (brief rev 2, ruling 6): every value play got, per site: a reservoir of VALUES numbers for p50 and p99, the exact
 * min and max, and the count that is not finite. The named sentinels (hqTrashCardsLoss's Infinity when HQ is short,
 * corpEffect's NaN for a card with no formula, evaluate's +-1000 for a certain end) are counted apart and left out.
 */
const VALUES = 4000;
const dist = new Map<string, { n: number; seen: number; kept: number[]; min: number; max: number; notFinite: number; sentinel: number }>();
const isSentinel = (site: string, v: number) =>
  (site === 'hqTrashCardsLoss' && v === Infinity) || (site === 'corpEffect' && Number.isNaN(v)) || (site === 'evaluate' && Math.abs(v) >= 1000);
const record = (site: string, v: number) => {
  const d = dist.get(site) ?? { n: 0, seen: 0, kept: [], min: Infinity, max: -Infinity, notFinite: 0, sentinel: 0 };
  dist.set(site, d);
  d.n++;
  if (isSentinel(site, v)) return void d.sentinel++;
  if (!Number.isFinite(v)) return void d.notFinite++;
  d.min = Math.min(d.min, v);
  d.max = Math.max(d.max, v);
  d.seen++;
  const slot = d.kept.length < VALUES ? d.kept.length : Math.floor(random() * d.seen);
  if (slot < VALUES) d.kept[slot] = v;
};
/** Values served by a loop guard, per guard key (the lookup that met itself, its instance and position left out). */
const guards = new Map<string, number>();
const takeLoops = () => {
  for (const [chain, n] of valueLoops) {
    const key = chain.split(' > ').pop()!.replace(/ @\d+$/, '').replace(/ inst-\d+/g, '').replace(/ (left)$/, ' $1');
    guards.set(key, (guards.get(key) ?? 0) + n);
  }
  valueLoops.clear();
};

const diag = newDiagnostics();
diag.onValue = (q, site, state, value, args) => {
  if (!sinkOn) return;
  record(site, value);
  const c = pricing();
  const tag: Tag = diag.replying ? 'reply' : c.leaves.length ? 'leaf' : c.frozen ? 'playout' : c.side === null ? 'outside' : 'root';
  const count = asks.get(site) ?? { root: 0, leaf: 0, playout: 0, reply: 0, outside: 0 };
  count[tag]++;
  asks.set(site, count);
  if (tag === 'root') example(site, value, args);
  const key = `${site}|${tag}`;
  const pool = pools.get(key) ?? { seen: 0, kept: [] };
  pools.set(key, pool);
  pool.seen++;
  const slot = pool.kept.length < K ? pool.kept.length : Math.floor(random() * pool.seen);
  if (slot >= K) return;
  try {
    pool.kept[slot] = { q, site, tag, src: where.src, turn: where.turn, value, state: state && structuredClone(state), args: structuredClone(args.slice(0, 8)), ctx: snapshot() };
  } catch {
    // a board or argument that can't be copied: counted, not sampled
  }
};
installDiagnostics(diag);

/** One example per site for the definitions page (ruling 14): the first root ask in Jeff's games #48 to #54, else in a deal. */
const examples = new Map<string, { src: string; turn: number; value: number; args: string }>();
const JEFF = /human:report-(4[89]|5[0-4])\.json$/;
const describe = (x: unknown): string =>
  x && typeof x === 'object' && 'cardCode' in x ? cardDef(x as CardInstance).title : typeof x === 'number' ? String(Math.round(x * 100) / 100) : typeof x === 'string' || typeof x === 'boolean' ? String(x) : x === undefined ? '-' : typeof x;
const example = (site: string, value: number, args: readonly unknown[]) => {
  const had = examples.get(site);
  if (had && (JEFF.test(had.src) || !JEFF.test(where.src))) return;
  examples.set(site, { src: where.src, turn: where.turn, value, args: args.slice(0, 8).map(describe).join(', ').replace(/(, -)+$/, '') });
};

// ---- the recorded states --------------------------------------------------------------------------------------------
const watched = (inner: Agent): Agent => {
  const wrap = <T>(state: GameState, f: () => T): T => {
    clearCaches();
    where = { src: where.src, turn: state.turnNumber };
    sinkOn = true;
    try {
      return f();
    } finally {
      sinkOn = false;
    }
  };
  const out: Partial<Agent> & { side: SideCode } = { side: inner.side, chooseAction: (s: GameState) => wrap(s, () => inner.chooseAction(s)) };
  if (inner.chooseRez) out.chooseRez = (s: GameState, cards: CardInstance[]) => wrap(s, () => inner.chooseRez!(s, cards));
  if (inner.chooseOffTurn) out.chooseOffTurn = (s: GameState) => wrap(s, () => inner.chooseOffTurn!(s));
  return out as Agent;
};

function playDeal(seed: number) {
  takeLoops();
  where = { src: `deal:${seed}`, turn: 0 };
  const game = new GameRunner(dealState(seed), { corp: watched(createAgent('corp', 'normal')), runner: watched(createAgent('runner', 'normal')) });
  for (let n = 0; n < 4000 && game.step(); n++);
  takeLoops();
}

/** Jeff's games: the recorded moves replayed; at each state, a fresh Normal agent of the acting side decides (its answer is not played). */
function replayHuman(file: string) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (!report.moves?.length) return;
  takeLoops();
  where = { src: `human:${file.split('/').pop()}`, turn: 0 };
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const move of report.moves as GameAction[]) {
    const side = whoActs(s);
    if (side && !s.winner && !s.priority) {
      try {
        watched(createAgent(side, 'normal')).chooseAction(s);
      } catch (e) {
        console.error(`${where.src} turn ${s.turnNumber}: ${(e as Error).message}`);
      }
    }
    try {
      s = executeAction(s, move);
    } catch {
      break;
    }
  }
  takeLoops();
}

const sources: (() => void)[] = [...deals().map(seed => () => playDeal(seed)), ...humanFiles().map(f => () => replayHuman(f))];
const t0 = performance.now();
sources.forEach((run, k) => k % shards === shard && run());
const playMs = performance.now() - t0;

// ---- 3: the pass of its own -----------------------------------------------------------------------------------------
interface Pair {
  copy: number;
  owner: number;
}
const pairs = new Map<string, { q: string; pairs: { d: number; copy: number; owner: number; src: string; turn: number; tag: Tag; note: string }[] }>();
const known = new Map<string, { n: number; equal: number; worst: number; examples: string[] }>();
const errors: string[] = [];

const near = (a: number, b: number) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const add = (q: string, name: string, s: Sample, p: Pair, note = '') => {
  if (!Number.isFinite(p.copy) || !Number.isFinite(p.owner)) return;
  const e = pairs.get(name) ?? { q, pairs: [] };
  pairs.set(name, e);
  e.pairs.push({ d: p.copy - p.owner, copy: p.copy, owner: p.owner, src: s.src, turn: s.turn, tag: s.tag, note });
};
const check = (s: Sample, again: number) => {
  const e = known.get(s.site) ?? { n: 0, equal: 0, worst: 0, examples: [] };
  known.set(s.site, e);
  e.n++;
  if (near(again, s.value) || (Number.isNaN(again) && Number.isNaN(s.value))) e.equal++;
  else {
    e.worst = Math.max(e.worst, Math.abs(again - s.value));
    if (e.examples.length < 5) e.examples.push(`${s.src} turn ${s.turn} ${s.tag}: play ${s.value.toFixed(4)}, again ${again.toFixed(4)}`);
  }
};
const side = (c: CardInstance): SideCode => (cardDef(c).side_code === 'corp' ? 'corp' : 'runner');
const serverOf = (state: GameState, id: string) => Object.values(state.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id));

function priceAgain(s: Sample): void {
  const st = s.state!;
  const a = s.args;
  switch (s.site) {
    case 'sideCreditValue': {
      const [sd, viewer] = a as [SideCode, SideCode];
      check(s, sideCreditValue(st, sd, viewer));
      return;
    }
    case 'clickPrice': {
      const [sd, viewer] = a as [SideCode, SideCode];
      check(s, clickPrice(st, sd, viewer));
      add('click', 'flat CLICK (playedWorth, payoutClick, clickRate) vs clickPrice', s, { copy: CLICK, owner: s.value }, `${sd} as ${viewer}`);
      return;
    }
    case 'playedWorth': {
      const card = a[0] as CardInstance;
      const t = cardDef(card).type_code;
      if (t === 'event' || t === 'operation') return;
      const viewer = (s.ctx.side ?? side(card)) as SideCode;
      add('click', "playedWorth's CLICK vs clickPrice(card's side, deciding side)", s, { copy: CLICK, owner: clickPrice(st, side(card), viewer) });
      return;
    }
    case 'handAndClicks': {
      const [sd, viewer] = a as [SideCode, SideCode];
      const hand = sd === 'corp' ? st.corp.hq : st.runner.grip;
      const limit = (sd === 'corp' ? st.corp.handSizeLimit : st.runner.handSizeLimit) ?? 5;
      const own = ownHandValue(st, sd);
      // the money operation moneyReach prices is left out of the flat count, as handAndClicks does (`reached`)
      const flat = handValue(hand.length - (sd === 'corp' && viewer === 'corp' && reachCard(st) ? 1 : 0), limit, viewer);
      check(s, sd === viewer && handByCard(sd) ? own : flat);
      add('hand', 'flat handValue vs ownHandValue (whole hand)', s, { copy: flat, owner: own }, `${sd} as ${viewer}, ${hand.length} cards`);
      for (const c of hand) {
        const held = heldWorth(st, c, sd);
        const keep = keepValue(st, c);
        add('hand', 'keepValue vs heldWorth (per card)', s, { copy: keep, owner: held }, cardDef(c).title);
        add('hand', "scoreOutcome's 0.5 x keepValue vs heldWorth (per card)", s, { copy: 0.5 * keep, owner: held }, cardDef(c).title);
      }
      return;
    }
    case 'hqTrashCardsLoss': {
      const resource = a[0] as CardInstance;
      check(s, hqTrashCardsLoss(st, resource));
      const k = resourceTrashHqCost(st, resource);
      if (k <= 0 || !Number.isFinite(s.value)) return;
      const ranked = st.corp.hq.map(c => ({ c, loss: Math.max(0.5, keepValue(st, c) - CLICK) })).sort((x, y) => x.loss - y.loss);
      const gone = new Set(ranked.slice(0, k).map(r => r.c.instanceId));
      const after = { ...st, corp: { ...st.corp, hq: st.corp.hq.filter(c => !gone.has(c.instanceId)) } };
      add('hand', 'hqTrashCardsLoss vs ownHandValue(hq) - ownHandValue(hq less those k)', s, { copy: s.value, owner: ownHandValue(st, 'corp') - ownHandValue(after, 'corp') }, `k ${k}`);
      return;
    }
    case 'keepValue':
      check(s, keepValue(st, a[0] as CardInstance));
      return;
    case 'cardRate': {
      const [sd] = a as [SideCode];
      check(s, cardRate(st, sd));
      // V-B B1 (recount VA-LOG-AVERAGING-MASK): inside an average the owner's hook returns the flat 1.6 itself, so those
      // asks would count as agreement; they go to a row of their own and the comparison rows read outside it only
      const avg = s.ctx.averaging ? ' (averaging: the guard serves 1.6)' : '';
      add('cardDrawn', `flat 1.6 (handValue) vs cardRate${avg}`, s, { copy: RATES.drawnCard, owner: s.value }, sd);
      add('cardDrawn', `drawBonus 0.5 vs cardRate${avg}`, s, { copy: RATES.cardDrawn, owner: s.value }, sd);
      return;
    }
    case 'ownHandValue drawWorth':
    case 'clickWorth drawWorth': {
      const [sd] = a as [SideCode];
      add('cardDrawn', `${s.site} (direct entry) vs cardRate`, s, { copy: s.value, owner: cardRate(st, sd) }, `${sd}${s.ctx.averaging ? ', averaging' : ''}`);
      return;
    }
    case 'iceWorth': {
      const [ice, viewer] = a as [CardInstance, SideCode];
      check(s, iceWorth(st, ice, viewer));
      add('ice', 'flatIceWorth vs iceWorth', s, { copy: flatIceWorth(ice), owner: s.value }, `${viewer}, ${ice.isRezzed ? 'rezzed' : 'unrezzed'}`);
      if (!ice.isRezzed && viewer === 'corp') add('ice', "Ingatan's RATES.ice vs iceWorth (unrezzed, Corp)", s, { copy: RATES.ice, owner: s.value });
      return;
    }
    case 'agendaWorth': {
      const [c, cost, points, serverId, success, inHand, budget, stealChance] = a as [number, number, number, string | undefined, number | undefined, boolean, { clicks: number; credits: number }, number | undefined];
      check(s, agendaWorth(st, c, cost, points, serverId, success, inHand, budget ?? st.corp, stealChance));
      return;
    }
    case 'placedCounterWorth': {
      const [card] = a as [CardInstance, boolean];
      const def = cardDef(card);
      const server = serverOf(st, card.instanceId);
      if (!server) return;
      const at = (n: number) => agendaWorth(st, n, def.advancement_cost ?? 0, def.agenda_points ?? 1, server.id);
      add('agenda', "placedCounterWorth's agenda share vs agendaWorth(c+1) - agendaWorth(c)", s, { copy: s.value, owner: at(card.advancementCounters + 1) - at(card.advancementCounters) }, def.title);
      return;
    }
    case 'tagsWorth': {
      const [viewer, count, home] = a as [SideCode, number | undefined, GameState | undefined];
      check(s, tagsWorth(st, viewer, count, home));
      const tags = count ?? st.runner.tags;
      add('tag', 'flat 3 a tag vs tagsWorth', s, { copy: tags * RATES.tagAgainstRunner, owner: s.value }, viewer);
      add('tag', "Liberation's 1.5 vs tagsWorth(corp, 1)", s, { copy: RATES.tagAgainstRunner * 0.5, owner: tagsWorth(st, 'corp', 1) });
      return;
    }
    case 'tagsWorth flat (tag clock)':
    case 'tagsWorth flat (loop)': {
      const [viewer, count] = a as [SideCode, number | undefined];
      const clock = withPricing({ pricingTagLoss: false }, () => tagsWorth(st, viewer, count));
      add('tag', `${s.site} vs the clock on the same board`, s, { copy: s.value, owner: clock }, viewer);
      return;
    }
    case 'damageWorth': {
      const [n, drawBack, grip] = a as [number, boolean, number];
      check(s, damageWorth(st, n, drawBack, grip));
      return;
    }
    case 'counterWorth': {
      const [card, type] = a as [CardInstance, 'credit' | 'virus' | 'power' | 'agenda'];
      check(s, counterWorth(st, card, type));
      return;
    }
    case 'counterWorthOf': {
      const [code, type] = a as [string, 'credit' | 'virus' | 'power'];
      const probe = { cardCode: code, instanceId: 'probe', tokens: {} } as unknown as CardInstance;
      add('counter', 'counterWorthOf vs counterWorth (same probe)', s, { copy: s.value, owner: counterWorth(st, probe, type) }, `${getCardDefinition(code).title} ${type}`);
      return;
    }
    case 'perTurn': {
      const [x, owner, minTurns, maxTurns, wait, lock, risk] = a as [number, 'corp' | 'runner' | number, number, number, number, number, number];
      check(s, perTurn(st, x, owner, minTurns, maxTurns, wait, lock));
      // V-B B3: the risk the call used: an asset formula hands its measured risk (ctx.risk), every other Corp card 0.06
      if (typeof owner === 'number') return void add('effectOverTurns', 'perTurn risk used by an asset formula vs bareAssetRisk', s, { copy: risk, owner: bareAssetRisk(st) });
      if (owner !== 'corp') return;
      add('effectOverTurns', 'perTurn risk used by a non-asset Corp formula (corpBare)', s, { copy: risk, owner: PAYOUT_RISK.corpBare });
      const at = (risk: number) => withRisk(risk, () => perTurn(st, x, owner, minTurns, maxTurns, wait, lock));
      add('effectOverTurns', 'perTurn at corpBare 0.06 vs at bareAssetRisk (per call)', s, { copy: s.value, owner: at(bareAssetRisk(st)) });
      add('effectOverTurns', 'perTurn at corpBare 0.06 vs at moneyIced (per call)', s, { copy: s.value, owner: at(PAYOUT_RISK.moneyIced) });
      return;
    }
    case 'corpCardValue': {
      const [card, viewer, left] = a as [CardInstance, SideCode, boolean];
      check(s, corpCardValue(card, st, viewer, left));
      add('boardCard', 'stateless flat corpKeepValue(code) vs corpCardValue', s, { copy: corpKeepValue(card.cardCode), owner: s.value }, `${cardDef(card).title}, ${viewer}${left ? ', left' : ''}`);
      const hosted = counters(card, 'credit');
      const profile = CARD_PROFILES[card.cardCode];
      if (card.isRezzed && hosted > 0) {
        const own = 1 + countersWorth(st, card, 'credit');
        add('hostedCredit', 'flat hosted x 0.6 (no state) vs 1 + countersWorth', s, { copy: 1 + hosted * RATES.counters.hostedCredit, owner: own }, cardDef(card).title);
        if (profile) add('hostedCredit', 'payoutWorth(hosted) (profiled path) vs 1 + countersWorth', s, { copy: s.value, owner: own }, cardDef(card).title);
      }
      if (profile && !card.isRezzed) {
        const bare = unrezzedWorth(st, card.cardCode, false)!;
        const iced = unrezzedWorth(st, card.cardCode, true)!;
        add('effectOverTurns', "owner's own split: unrezzed profiled asset bare vs iced", s, { copy: bare, owner: iced }, `${cardDef(card).title}${serverOf(st, card.instanceId)?.ice.length ? ', in an iced server' : ', bare'}`);
      }
      return;
    }
    case 'corpKeepValue': {
      const [code, rezzed] = a as [string, boolean];
      check(s, corpKeepValue(code, st, rezzed));
      const title = getCardDefinition(code).title;
      add('cardBeforeInstall', 'flat CARD_VALUES keep (no state) vs corpKeepValue', s, { copy: corpKeepValue(code), owner: s.value }, title);
      if (getCardDefinition(code).type_code === 'upgrade') {
        const [remote, central] = upgradeValue(code, st);
        add('cardBeforeInstall', 'upgradeValue remote (install-score scale) vs corpKeepValue', s, { copy: remote, owner: s.value }, title);
        add('cardBeforeInstall', 'upgradeValue central (install-score scale) vs corpKeepValue', s, { copy: central, owner: s.value }, title);
      }
      return;
    }
    case 'rezzedWorth': {
      const [card, rezCost] = a as [CardInstance, number];
      check(s, rezzedWorth(st, card, rezCost));
      // V-B B1 (recount VA-LOG-REZZED-SENTINEL): -1 with no formula and no entry is "don't rez", not a price; counted apart
      // and an entry's own `rezzed` rule (the instance's counters: Clearinghouse, elevation.ts) is a row of its own too
      const kind = CARDS[card.cardCode]?.rezzed ? " (the entry's own rezzed rule)" : corpEffect(st, card.cardCode, true) ? '' : ' (no formula: the -1 sentinel)';
      add('cardBeforeInstall', `rezzedWorth vs corpKeepValue(rezzed) - rezCost${kind}`, s, { copy: s.value, owner: corpKeepValue(card.cardCode, st, true) - rezCost }, cardDef(card).title);
      return;
    }
    case 'runnerCardValue': {
      const [code, card] = a as [string, CardInstance | undefined];
      check(s, runnerCardValue(code, st, card));
      add('rigCard', 'flat rig worth (no state) vs runnerCardValue', s, { copy: runnerCardValue(code), owner: s.value }, getCardDefinition(code).title);
      // installed profiled rig cards: the income owner on the hosted credits against the rig owner, both in credits
      for (const c of [...st.runner.rig.resources, ...st.runner.rig.hardware]) {
        const profile = CARD_PROFILES[c.cardCode];
        if (!profile || cardDef(c).side_code !== 'runner') continue;
        // V-B B1 (recount VA-LOG-RIG-SLIDE): play's term is payoutWorth x payoutSlide (evaluate.ts runnerRigValue)
        const pay = payoutWorth(profile, turnsLeft(st), counters(c, 'credit'), payoutWait(st, profile, 'runner'), cardRate(st, 'runner')) * payoutSlide(st, 'runner', counters(c, 'credit'));
        add('rigCard', 'profiled rig card: payoutWorth x payoutSlide vs 2 x runnerCardValue', s, { copy: pay, owner: RATES.rigCardScale * runnerCardValue(c.cardCode, st, c) }, cardDef(c).title);
      }
      return;
    }
    case 'flatlineWorth':
      check(s, flatlineWorth(st));
      return;
  }
}

/** Sites with no board: priced again from their arguments (pure). */
function priceAgainNoBoard(s: Sample): void {
  const a = s.args;
  switch (s.site) {
    case 'payoutWorth': {
      const [profile, turns, hosted, wait, card] = a as [Parameters<typeof payoutWorth>[0], number, number, number, number];
      check(s, payoutWorth(profile, turns, hosted, wait, card));
      return;
    }
    case 'sampledEndWorth':
      check(s, sampledEndWorth(a[0] as SideCode, a[1] as number));
      return;
    case 'handValue':
      check(s, handValue(a[0] as number, a[1] as number, a[2] as SideCode));
      return;
  }
}

/** PAYOUT_RISK.corpBare set to `risk` for `fn` only (a plain object at run time), caches cleared before and after. */
function withRisk<T>(risk: number, fn: () => T): T {
  const was = PAYOUT_RISK.corpBare;
  clearCaches();
  (PAYOUT_RISK as { corpBare: number }).corpBare = risk;
  try {
    return fn();
  } finally {
    (PAYOUT_RISK as { corpBare: number }).corpBare = was;
    clearCaches();
  }
}

// ---- 4: the Corp formula cards on the sampled boards ----------------------------------------------------------------
const CORP_FORMULAS = EFFECT_CODES.filter(code => getCardDefinition(code).side_code === 'corp' && !CARD_PROFILES[code]);
const formula = new Map<string, { title: string; cost: number; n: number; gap: number[]; slopes: number[][]; risk: { bare: number[]; iced: number[]; today: number[] }; keep: number[] }>();
function formulaColumns(st: GameState, ctx: Partial<Pricing>) {
  withPricing({ ...ctx, side: 'corp' }, () => {
    for (const code of CORP_FORMULAS) {
      const def = getCardDefinition(code);
      const cost = def.cost ?? 0;
      clearCaches();
      const today = corpEffect(st, code, false)?.keep;
      const rezzed = corpEffect(st, code, true)?.keep;
      if (today === undefined || rezzed === undefined) continue;
      const row = formula.get(code) ?? { title: def.title, cost, n: 0, gap: [], slopes: [], risk: { bare: [], iced: [], today: [] }, keep: [] };
      formula.set(code, row);
      row.n++;
      row.keep.push(today);
      // the audit's P3 gap: unrezzed - rezzed + cost; 0 when the formula subtracts its cost exactly once
      row.gap.push(today - (rezzed - cost));
      // linearity: f(c) - f(0) for a few costs, through the card's formula with only `cost` changed
      const agenda = pointGain(st.corp.score, agendaOdds(st).points);
      const card = cardRate(st, 'corp');
      const f = (c: number) => corpFormula(st, code, { cost: c, agenda, card, get tag() { return tagsWorth(st, 'corp', 1); } })?.keep ?? NaN;
      const f0 = f(0);
      row.slopes.push([1, 2, 3, 5].map(c => f(c) - f0));
      row.risk.today.push(today);
      row.risk.bare.push(withRisk(bareAssetRisk(st), () => corpEffect(st, code, false)?.keep ?? NaN));
      row.risk.iced.push(withRisk(PAYOUT_RISK.moneyIced, () => corpEffect(st, code, false)?.keep ?? NaN));
    }
  });
}

// ---- run the pass ---------------------------------------------------------------------------------------------------
const t1 = performance.now();
const samples = [...pools.values()].flatMap(p => p.kept);
let formulaBoards = 0;
for (const s of samples) {
  clearCaches();
  try {
    withPricing({ ...s.ctx, diagnostics: null }, () => (s.state ? priceAgain(s) : priceAgainNoBoard(s)));
  } catch (e) {
    if (errors.length < 20) errors.push(`${s.site} ${s.src} turn ${s.turn}: ${(e as Error).message}`);
  }
  // the formula columns on the Corp's own sampled boards (at most 3 a site, Corp deciding)
  if (s.state && s.ctx.side === 'corp' && s.site === 'corpKeepValue' && formulaBoards < 12) {
    formulaBoards++;
    try {
      formulaColumns(s.state, { ...s.ctx, diagnostics: null });
    } catch (e) {
      if (errors.length < 20) errors.push(`formulas ${s.src}: ${(e as Error).message}`);
    }
  }
}
clearCaches();
const passMs = performance.now() - t1;

mkdirSync(OUT, { recursive: true });
writeFileSync(
  `${OUT}/value-log.json`,
  JSON.stringify({
    shard: `${shard}/${shards}`,
    k: K,
    sources: sources.filter((_, k) => k % shards === shard).length,
    playMs,
    passMs,
    asks: Object.fromEntries(asks),
    sampled: Object.fromEntries([...pools].map(([key, p]) => [key, { seen: p.seen, kept: p.kept.length }])),
    known: Object.fromEntries(known),
    pairs: Object.fromEntries([...pairs].map(([name, e]) => [name, e])),
    formulas: Object.fromEntries(formula),
    formulaBoards,
    examples: Object.fromEntries(examples),
    dist: Object.fromEntries(dist),
    guards: Object.fromEntries(guards),
    errors,
  }),
);
console.log(`shard ${shard}/${shards}: ${samples.length} samples, play ${(playMs / 1000).toFixed(0)} s, pass ${(passMs / 1000).toFixed(0)} s, errors ${errors.length}`);
