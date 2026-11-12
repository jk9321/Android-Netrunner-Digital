/**
 * Runner reading R0 (spec-runner-reading.md, Part R0): measure first, no behaviour change. Plays the game-0 deals
 * Normal v Normal on base beta and, at every Corp decision that installs an agenda into a remote or advances one there,
 * records the count's verdict for the coming Runner turn (holdCost against runnerBudget with the credits the Corp ends
 * on, as placement-g0.ts: this action's cost out, the clicks after it to credits). One verdict per agenda per Corp turn
 * (the last such decision of the turn); whether a counted line (plan.scoreInTwo, the agent's held line) carries it.
 *
 * For each "holds" verdict, from the Corp's viewpoint only (both deck lists and corpSeenGrip; never the grip's unseen
 * contents or the stack's order, rules 10.2.2a, 10.2.3a), by reach.ts's pool and odds:
 *  - the breaker types the target's ice needs that the rig lacks, reach's odds for each (atLeastOne over the unseen
 *    pool, 1 when seen), whether one was seen in the grip;
 *  - pHold: reach's cases for the Runner's next turn (reach.cases, t = 1; the target's ice probed as rezzed so the cases
 *    are built), each priced by holdCost with that case's breakers installed (a click and the install cost each, rule
 *    5.2.7d) and its run event played (its cost; the run's click, 5.2.7e; its bypass and run credits), weighted;
 *  - flips: (i) seen grip cards only (each, and all the seen breakers together), (ii) any breaker in the pool alone
 *    within budget and clicks (and (ii+e) with a helping run event), (iii) pHold below one half.
 * Fate: scored, stolen in the next Runner turn, stolen later, other. Each steal of an agenda that had a holds verdict is
 * classed by how the Runner got in, from the latest holds verdict V, the Runner's turn start T and the state just
 * before the stealing run R: (a) a breaker installed since V whose type the server's ice has; (b) an event played that
 * turn (the run's own event included); (c) the Runner had more money than the count gave it (T's budget above V's, or
 * the run's credits above T's budget); (d) the Corp could not (short of the rez money at T) or did not rez (ice left
 * unrezzed); (e) other (the count's pricing).
 * Item 5: Corp advances and ice installs on a server whose root holds a card the Runner has accessed (run.accessed).
 * One JSON line per deal; scripts/runner-reading-r0-sum.mjs sums them.
 *
 *   SEEDS=1001,1011 npx vite-node scripts/runner-reading-r0.ts
 */
import { CardInstance, GameState, cardDef } from '../src/core';
import { breakerScript, iceSubtypes, installedIcebreakers, isIcebreaker } from '../src/core/engine/ice';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { HeldLine, holdCost, runnerBudget } from '../src/ai/countedScore';
import { atLeastOne, cases, runnerPool } from '../src/ai/reach';
import { runBypasses } from '../src/ai/runs';
import { runEventOptions } from '../src/ai/prompts';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { applyPlanOff } from '../src/ai/synergy';
import { createInitialGameState } from '../src/core';

applyPlanOff(process.env.PLAN_OFF ?? '');

const typeOf = (c: CardInstance) => cardDef(c).type_code;
const isAgenda = (c: CardInstance) => typeOf(c) === 'agenda';
type BreakType = 'barrier' | 'code gate' | 'sentry';
const TYPES: BreakType[] = ['barrier', 'code gate', 'sentry'];
const breaks = (c: CardInstance) => breakerScript(c)?.breaks as BreakType | 'any' | undefined;

interface Verdict {
  turn: number;
  agenda: string;
  id: string;
  server: string;
  kind: 'install' | 'advance';
  line: boolean;
  holds: boolean;
  ice: number;
  /** Holds verdicts only. */
  needed?: { type: string; p: number; seen: boolean; certain: boolean }[];
  pHold?: number;
  flipSeen?: boolean;
  flipAny?: boolean;
  flipAnyEvent?: boolean;
  /** The pool's breakers that alone let the Runner in (titles). */
  anyBy?: string[];
  fate?: 'scored' | 'stolenNext' | 'stolenLater' | 'other';
  cls?: 'a' | 'b' | 'c' | 'd' | 'e';
  flags?: Record<string, boolean | string>;
  /** Class (a)/(b): the card that did it, and whether the Corp had seen it in the grip at V. */
  by?: string;
  bySeen?: boolean;
  byP?: number;
}

/** The board with these Runner cards played: breakers installed (a click and the install cost each, 5.2.7d), an event's cost paid (its play is the run's click, 5.2.7e), its bypass and run credits. Null: the Runner can't afford it. */
function playedView(s: GameState, server: string, added: CardInstance[], event?: CardInstance): { view: GameState; ice: CardInstance[] } | null {
  const cost = [...added, ...(event ? [event] : [])].reduce((t, c) => t + (cardDef(c).cost ?? 0), 0);
  const clicks = Math.max(0, s.runner.maxClicks - 1 - added.length);
  // runnerBudget counts every click but the run's as at least 1 credit; the install clicks are spent instead
  const budget = runnerBudget(s) - added.length;
  if (cost > budget || s.runner.maxClicks - 1 - added.length < 0) return null;
  const programs = [...s.runner.rig.programs, ...added.map((c, i) => ({ ...c, instanceId: `r0-${i}-${c.cardCode}`, isRezzed: true, faceUp: true, hostedOnId: undefined, tokens: {} }) as CardInstance)];
  let view: GameState = { ...s, runner: { ...s.runner, credits: s.runner.credits - cost, maxClicks: clicks + 1, rig: { ...s.runner.rig, programs } } };
  let ice = view.corp.servers[server].ice;
  if (event) {
    const options = runEventOptions(event.cardCode, view);
    const skipped = runBypasses(view, server, options).ids;
    ice = ice.filter(i => !skipped.has(i.instanceId));
    view = { ...view, runner: { ...view.runner, credits: view.runner.credits + (options.bonusCredits ?? 0) } };
    const sv = view.corp.servers[server];
    view = { ...view, corp: { ...view.corp, servers: { ...view.corp.servers, [server]: { ...sv, ice } } } };
  }
  return { view, ice };
}

const holdsIn = (s: GameState, server: string, credits: number, added: CardInstance[], event?: CardInstance): boolean => {
  const p = playedView(s, server, added, event);
  if (!p) return true; // unaffordable: the rig as it is, which holds
  return holdCost(p.view, p.ice, credits) !== null;
};

function reading(s: GameState, server: string, end: number, v: Verdict) {
  const ice = s.corp.servers[server].ice;
  const pool = runnerPool(s);
  const all = [...pool.seen, ...pool.unseen];
  const rig = installedIcebreakers(s).map(breaks);
  const covered = (t: BreakType) => rig.includes(t) || rig.includes('any');
  const needTypes = TYPES.filter(t => !covered(t) && ice.some(c => iceSubtypes({ ...c, isRezzed: true }, s).includes(t)));
  const n = pool.gripUnseen + 1.6;
  v.needed = needTypes.map(t => {
    const fits = (c: CardInstance) => isIcebreaker(c) && (breaks(c) === t || breaks(c) === 'any');
    const seen = pool.seen.some(fits);
    const hits = pool.unseen.filter(fits).length;
    // Certain: seen in the grip, or every unseen card is in the grip (an empty stack)
    const certain = seen || (s.runner.stack.length === 0 && hits > 0);
    const p = seen ? 1 : atLeastOne(pool.unseen.length, hits, n);
    return { type: t, p: Math.round(p * 1000) / 1000, seen, certain };
  });
  // (iii) reach's cases: the ice probed as rezzed so the cases are built; each case priced on the real board
  const probed: GameState = { ...s, corp: { ...s.corp, servers: { ...s.corp.servers, [server]: { ...s.corp.servers[server], ice: ice.map(c => ({ ...c, isRezzed: true })) } } } };
  let pHold = 0;
  for (const c of cases(probed, server, 1)) {
    const added = c.added.map(a => all.find(x => x.cardCode === a.cardCode) ?? a);
    if (holdsIn(s, server, end, added, c.event)) pHold += c.weight;
  }
  v.pHold = Math.round(pHold * 1000) / 1000;
  // (i) seen grip cards: each alone, and all seen breakers together
  const seenBreakers = [...new Map(pool.seen.filter(isIcebreaker).map(c => [c.cardCode, c])).values()];
  const seenEvents = [...new Map(pool.seen.filter(c => typeOf(c) === 'event').map(c => [c.cardCode, c])).values()];
  v.flipSeen = seenBreakers.some(b => !holdsIn(s, server, end, [b])) || seenEvents.some(e => !holdsIn(s, server, end, [], e)) || (seenBreakers.length > 1 && !holdsIn(s, server, end, seenBreakers));
  // (ii) any breaker in the pool alone; (ii+e) or with the pool's run events
  const poolBreakers = [...new Map(all.filter(isIcebreaker).map(c => [c.cardCode, c])).values()];
  const by = poolBreakers.filter(b => !holdsIn(s, server, end, [b]));
  v.flipAny = by.length > 0;
  v.anyBy = by.map(b => cardDef(b).title);
  const poolEvents = [...new Map(all.filter(c => typeOf(c) === 'event').map(c => [c.cardCode, c])).values()];
  v.flipAnyEvent = v.flipAny || poolEvents.some(e => !holdsIn(s, server, end, [], e)) || poolBreakers.some(b => poolEvents.some(e => !holdsIn(s, server, end, [b], e)));
}

function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  const start = createInitialGameState(deckGameSetup(seed, c, r));
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  const heldOf = () => (corp as unknown as { heldLine: HeldLine | null }).heldLine;
  const verdicts = new Map<string, Verdict>();
  /** The latest holds verdict on each agenda, with its state and end credits. */
  const lastHold = new Map<string, { v: Verdict; s: GameState }>();
  let linesBegun = 0;
  const accessed = new Set<string>();
  const onAccessed: { kind: 'advance' | 'ice'; type: string; title: string; turn: number }[] = [];
  const runnerEvents: { turn: number; code: string; title: string }[] = [];
  let lastRunnerAction = '';

  const pickR = runner.chooseAction.bind(runner);
  runner.chooseAction = (s: GameState) => {
    const a = pickR(s);
    if (a.type !== 'RESOLVE_PROMPT' && a.type !== 'PASS') lastRunnerAction = a.type;
    if (a.type === 'PLAY_OPERATION_OR_EVENT' && s.activePlayer === 'runner') {
      const card = s.runner.grip.find(x => x.instanceId === (a as { cardInstanceId?: string }).cardInstanceId);
      if (card) runnerEvents.push({ turn: s.turnNumber, code: card.cardCode, title: cardDef(card).title });
    }
    return a;
  };

  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = (s: GameState) => {
    const held = heldOf();
    const a = choose(s);
    const after = heldOf();
    if (after && after !== held && after.game === s.id && (!held || held.line.agendaId !== after.line.agendaId || held.turn !== after.turn)) linesBegun++;
    if (s.activePlayer !== 'corp' || s.activeRun) return a;
    const id = (a as { cardInstanceId?: string }).cardInstanceId;
    const onLine = (x: string) => (!!held && held.game === s.id && held.line.agendaId === x) || (!!after && after.game === s.id && after.line.agendaId === x);
    let card: CardInstance | undefined;
    let server: string | undefined;
    let kind: Verdict['kind'] = 'install';
    if (a.type === 'INSTALL_CARD' && id) {
      const hc = s.corp.hq.find(x => x.instanceId === id);
      const target = (a as { targetServerId?: string }).targetServerId;
      if (hc && typeOf(hc) === 'ice') {
        const sv = target ? s.corp.servers[target] : undefined;
        if (sv?.root.some(x => accessed.has(x.instanceId))) onAccessed.push({ kind: 'ice', type: typeOf(sv.root.find(x => accessed.has(x.instanceId))!), title: cardDef(sv.root.find(x => accessed.has(x.instanceId))!).title, turn: s.turnNumber });
      }
      if (hc && isAgenda(hc) && target && s.corp.servers[target]?.isRemote) [card, server] = [hc, target];
    }
    if (a.type === 'ADVANCE_CARD' && id) {
      const where = Object.values(s.corp.servers).find(v => v.root.some(x => x.instanceId === id));
      const rc = where?.root.find(x => x.instanceId === id);
      if (rc && accessed.has(rc.instanceId)) onAccessed.push({ kind: 'advance', type: typeOf(rc), title: cardDef(rc).title, turn: s.turnNumber });
      if (rc && isAgenda(rc) && where?.isRemote) [card, server, kind] = [rc, where.id, 'advance'];
    }
    if (card && server) {
      const v = asSide('corp', () => {
        decisionContext(s, 'corp');
        const cost = kind === 'advance' ? 1 : 0;
        const end = s.corp.credits - cost + Math.max(0, s.corp.clicks - 1);
        const ice = s.corp.servers[server!].ice;
        const v: Verdict = { turn: s.turnNumber, agenda: cardDef(card!).title, id: card!.instanceId, server: server!, kind, line: onLine(card!.instanceId), holds: ice.length > 0 && holdCost(s, ice, end) !== null, ice: ice.length };
        if (v.holds && !process.env.NOMEASURE) reading(s, server!, end, v);
        return v;
      });
      verdicts.set(`${v.id}:${v.turn}`, v);
      if (v.holds) lastHold.set(v.id, { v, s });
      else lastHold.delete(v.id);
    }
    return a;
  };

  let prev: GameState = start;
  let runnerTurnStart: GameState | null = null;
  let runStart: { s: GameState; byEvent: boolean } | null = null;
  const game = new GameRunner(start, { corp, runner });
  const classify = (agendaId: string, s: GameState) => {
    const h = lastHold.get(agendaId);
    if (!h) return;
    const { v, s: V } = h;
    v.fate = s.turnNumber <= v.turn ? 'stolenNext' : 'stolenLater';
    const R = runStart?.s ?? prev;
    const T = runnerTurnStart ?? R;
    const server = v.server;
    const iceT = T.corp.servers[server]?.ice ?? [];
    const types = new Set(iceT.flatMap(c => iceSubtypes({ ...c, isRezzed: true }, T)));
    const was = new Set(installedIcebreakers(V).map(b => b.cardCode));
    const fresh = installedIcebreakers(R).filter(b => !was.has(b.cardCode) && (breaks(b) === 'any' || types.has(breaks(b) as never)));
    const evs = runnerEvents.filter(e => e.turn === s.turnNumber);
    const f: Record<string, boolean | string> = {};
    const [holdsT, holdsTRich, budgetUp, runRich, unrezzed] = asSide('corp', () => {
      decisionContext(T, 'corp');
      const holdsT = iceT.length > 0 && holdCost(T, iceT, T.corp.credits) !== null;
      const holdsTRich = iceT.length > 0 && holdCost(T, iceT, Infinity) !== null;
      const budgetUp = runnerBudget(T) > runnerBudget(V);
      const runRich = R.runner.credits + Math.max(0, R.runner.clicks - 1) > runnerBudget(T);
      const unrezzed = (s.corp.servers[server]?.ice ?? prev.corp.servers[server]?.ice ?? []).some(c => !c.isRezzed);
      return [holdsT, holdsTRich, budgetUp, runRich, unrezzed];
    });
    Object.assign(f, { holdsT, holdsTRich, budgetUp, runRich, unrezzed, runEvent: !!runStart?.byEvent, freshBreaker: fresh.map(b => cardDef(b).title).join('/'), events: evs.map(e => e.title).join('/') });
    v.flags = f;
    let by: CardInstance | undefined;
    if (fresh.length) {
      v.cls = 'a';
      by = fresh[0];
    } else if (evs.length) {
      v.cls = 'b';
      const code = runStart?.byEvent ? evs[evs.length - 1].code : evs[0].code;
      by = [...V.runner.grip, ...V.runner.stack, ...T.runner.heap, ...s.runner.heap].find(c => c.cardCode === code);
    } else if (!holdsT && holdsTRich) v.cls = 'd';
    else if (budgetUp || runRich) v.cls = 'c';
    else if (unrezzed) v.cls = 'd';
    else v.cls = 'e';
    if (by) {
      v.by = cardDef(by).title;
      const pool = asSide('corp', () => (decisionContext(V, 'corp'), runnerPool(V)));
      v.bySeen = pool.seen.some(c => c.cardCode === by!.cardCode);
      const fits = isIcebreaker(by) ? v.needed?.find(x => breaks(by!) === 'any' || x.type === breaks(by!)) : undefined;
      if (fits) v.byP = fits.p;
    }
  };
  const step = (s: GameState) => {
    if (prev.activePlayer === 'corp' && s.activePlayer === 'runner') runnerTurnStart = s;
    if (!prev.activeRun && s.activeRun) runStart = { s: prev, byEvent: lastRunnerAction === 'PLAY_OPERATION_OR_EVENT' };
    if (s.activeRun) for (const x of s.activeRun.accessed ?? []) accessed.add(x.id);
    const had = new Set(prev.runner.scoreArea.map(x => x.instanceId));
    for (const x of s.runner.scoreArea) {
      if (had.has(x.instanceId) || !isAgenda(x)) continue;
      if (!process.env.NOMEASURE) classify(x.instanceId, s);
      for (const v of verdicts.values()) if (v.id === x.instanceId && !v.fate) v.fate = s.turnNumber <= v.turn ? 'stolenNext' : 'stolenLater';
    }
    const scored = new Set(prev.corp.scoreArea.map(x => x.instanceId));
    for (const x of s.corp.scoreArea) if (!scored.has(x.instanceId)) for (const v of verdicts.values()) if (v.id === x.instanceId && !v.fate) v.fate = 'scored';
    if (!s.activeRun) runStart = null;
    prev = s;
  };
  for (let i = 0; i < 6000; i++) {
    step(game.state);
    if (!game.step()) break;
  }
  step(game.state);
  for (const v of verdicts.values()) v.fate ??= 'other';
  return { seed, corp: c.name, runner: r.name, winner: game.state.winner ?? null, turns: game.state.turnNumber, linesBegun, verdicts: [...verdicts.values()], onAccessed };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) console.log(JSON.stringify(playDeal(seed)));
