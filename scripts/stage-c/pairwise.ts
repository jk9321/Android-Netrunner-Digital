/**
 * Step 4 Stage C, piece C0 (brief-stage-c.md): the pairwise table of the intent lines (spec-step4-corp-core.md 1.3),
 * re-run on the branch base with the spec's lines 2 and 4 told apart by the owners, on the recorded states of
 * scripts/stage-a/harness.ts (the 56 local deals and every human game, the hand-value caches cleared before every
 * decision). Stage A's table (stage-a/7-pairwise.md) read line 2 as "ice on an existing server" and line 4 as "ice into
 * a new remote"; here:
 *
 *   2  ice the hold owner says changes a count: the server is staked (stake(server).loss > 0, the ice leaving HQ) and
 *      serverHold('runnerTurn') with the ice installed, asked with the credits the Corp has after the install, has fewer
 *      entries than before, or holds where it did not (spec 1.3 line 2: ice the Corp cannot also rez changes no count);
 *   4  a build pair: ice into a new remote while HQ holds an agenda or an asset to go in its root;
 *   9  ice that changes no count (neither of the above): a kind of move the spec's eight lines do not name.
 *
 * Line 3 is split by the hold owner too, since spec 1.3 makes `margin` an order key for agenda candidates: 3 an agenda
 * install or advance on a server that holds (serverHold 'runnerTurn' after the move, with the credits left), 10 one on
 * a server that does not.
 *
 * The other lines as in Stage A: 1 expiring (a resource trash while tagged, Petty Cash), 3 agenda install or advance,
 * 5 economy (money operation, econ asset install, a click ability), 6 other play, 7 purge, 8 draw or credit.
 *
 * Decisions that reach Q7: the Corp's main phase, no prompt, no win now, no score now, no held line's later step, no
 * money pick (Q6), and no two-turn line begun or vetoed on the pick (Q5: scoreInTwoPick returns another action). The
 * played move is the move the Corp made (the planner's pick, else the ranking's first; after placement, which moves an
 * install to another server and so can move ice between lines 2, 4 and 9).
 *
 *   SHARD=0/4 npx vite-node scripts/stage-c/pairwise.ts > pairs-0.json
 *   node scripts/stage-c/pairwise-sum.mjs pairs-*.json > 7-pairwise-c.md
 */
import { CardInstance, GameAction, GameState, cardDef, executeAction } from '../../src/core';
import { ScoredAction } from '../../src/ai/agent';
import { asSide, plan } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { moneyPick } from '../../src/ai/incomeLine';
import { scoreNowPlan } from '../../src/ai/winNow';
import { moneyOpGain } from '../../src/ai/corpAI';
import { econValue } from '../../src/ai/cardValues';
import { serverHold } from '../../src/ai/corp/hold';
import { stake } from '../../src/ai/corp/pools';
import { HeldLine, heldLaterStep, isCorpMain } from '../../src/ai/corp/lines';
import { scoreInTwoPick } from '../../src/ai/corp/placement';
import { isPettyCash } from '../../src/ai/corp/core';
import { evaluate } from '../../src/ai/evaluate';
import { simulate } from '../../src/ai/prompts';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { Decision, clearCaches, forEachRecorded } from '../stage-a/harness';

const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
const where = (d: Decision) => `${d.src} #${d.i} T${d.turn}`;

const out = {
  reached: 0,
  q5: 0,
  played: {} as Record<string, number>,
  counts: {} as Record<string, number>,
  /** the same, a line counted available only when the ranking scored one of its moves above -Infinity (playable) */
  finite: {} as Record<string, number>,
  /** the same, only above 0 (a move the old ranking wanted at all) */
  positive: {} as Record<string, number>,
  /** the same, a line counted available when one of its moves meets the line's own condition (pass 3, the C0 table) */
  cond: {} as Record<string, number>,
  /** played moves that fail their own line's condition, by line (an early read of coverage) */
  failed: {} as Record<string, number>,
  /** per source kind ('deal' | 'human'), the same counts */
  bySrc: {} as Record<string, { reached: number; played: Record<string, number>; counts: Record<string, number> }>,
  iceKinds: { two: 0, four: 0, nine: 0, nineExisting: 0, nineNew: 0 },
  examples: {} as Record<string, string[]>,
  errors: 0,
};

interface Watch {
  ranked: ScoredAction[] | null;
  planned: GameAction | null | undefined;
}
const watch = new WeakMap<object, Watch>();

function arm(agent: object) {
  const w: Watch = { ranked: null, planned: undefined };
  watch.set(agent, w);
  const a = agent as { rankMainActions?: (s: GameState, legal?: GameAction[]) => ScoredAction[]; plan?: (s: GameState, r: ScoredAction[]) => GameAction | null; __watched?: boolean };
  if (!a.rankMainActions || a.__watched) return;
  a.__watched = true;
  const rank = a.rankMainActions.bind(agent);
  const planner = a.plan!.bind(agent);
  a.rankMainActions = (s, legal) => {
    const r = rank(s, legal);
    const cur = watch.get(agent);
    if (cur && !cur.ranked) cur.ranked = r;
    return r;
  };
  a.plan = (s, r) => {
    const p = planner(s, r);
    const cur = watch.get(agent);
    if (cur) cur.planned = p;
    return p;
  };
}

type Install = GameAction & { type: 'INSTALL_CARD'; cardInstanceId: string; targetServerId?: string; asNewRemote?: boolean };

/** Does installing this ice change a count of the hold owner on a staked server (line 2)? */
function changesCount(s: GameState, a: Install, card: CardInstance): boolean {
  if (a.asNewRemote || !a.targetServerId) return false;
  const server = a.targetServerId;
  if (!(stake(s, server, { leaving: card.instanceId }).loss > 0)) return false;
  let after: GameState;
  try {
    after = executeAction(s, a);
  } catch {
    return false;
  }
  const before = serverHold(s, server, { when: 'runnerTurn' });
  const now = serverHold(after, server, { when: 'runnerTurn', corpCredits: after.corp.credits });
  return (now.holds && !before.holds) || (!now.holds && now.entries < before.entries);
}

/** After an agenda install or advance, does its server hold over the Runner's next turn (the credits left to rez)? */
function agendaHolds(s: GameState, a: GameAction): boolean {
  let after: GameState;
  try {
    after = executeAction(s, a);
  } catch {
    return false;
  }
  const id = (a as { cardInstanceId: string }).cardInstanceId;
  const server = Object.values(after.corp.servers).find(v => v.root.some(c => c.instanceId === id))?.id;
  return !!server && serverHold(after, server, { when: 'runnerTurn', corpCredits: after.corp.credits }).holds;
}

const rootCardInHq = (s: GameState, but: string) => s.corp.hq.some(c => c.instanceId !== but && ['agenda', 'asset'].includes(typeOf(c) ?? ''));

/**
 * Pass 3: the line's own condition (spec 1.3), from the owners and the valuation model, not the ranking:
 *  1 any legal expiring play; 2, 4, 9 ice that is paid for (the install cost and its own rez cost leave rezMoney's keep);
 *  3, 10 any legal agenda move; 5, 6 a positive play value (evaluate after the move, less before); 7 the ranking's purge
 *  score above 0 (the counters' worth by the model against the three clicks, the nearest computed form); 8 always.
 */
function meets(s: GameState, a: GameAction, line: number): boolean {
  switch (line) {
    case 2:
    case 4:
    case 9: {
      const i = a as Install;
      const card = s.corp.hq.find(c => c.instanceId === i.cardInstanceId);
      const install = i.asNewRemote || !i.targetServerId ? 0 : s.corp.servers[i.targetServerId]?.ice.length ?? 0;
      return !!card && s.corp.credits - install - (cardDef(card).cost ?? 0) >= rezMoney(s).keep;
    }
    case 5:
    case 6: {
      const after = simulate(s, a);
      return !!after && evaluate(after, 'corp') - evaluate(s, 'corp') > 0;
    }
    default:
      return true;
  }
}

/** The intent line of a main-phase action (see the file comment). */
function intent(s: GameState, a: GameAction): number | null {
  const card = 'cardInstanceId' in a && a.cardInstanceId ? [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice])].find(c => c.instanceId === a.cardInstanceId) : undefined;
  switch (a.type) {
    case 'TRASH_RESOURCE':
      return 1;
    case 'PLAY_OPERATION_OR_EVENT':
      if (isPettyCash(s, a)) return 1;
      return card && moneyOpGain(card.cardCode) !== undefined ? 5 : 6;
    case 'INSTALL_CARD': {
      const i = a as Install;
      if (typeOf(card) === 'ice') {
        if (changesCount(s, i, card!)) return 2;
        if ((i.asNewRemote || !i.targetServerId) && rootCardInHq(s, card!.instanceId)) return 4;
        return 9;
      }
      if (typeOf(card) === 'agenda') return agendaHolds(s, i) ? 3 : 10;
      if (typeOf(card) === 'asset' && econValue(card!.cardCode, s) !== undefined) return 5;
      return 6;
    }
    case 'ADVANCE_CARD':
      return typeOf(card) === 'agenda' ? (agendaHolds(s, a) ? 3 : 10) : 6;
    case 'USE_ABILITY':
      return 5;
    case 'PURGE_VIRUS':
      return 7;
    case 'DRAW_CARD':
    case 'GAIN_CREDIT':
      return 8;
    case 'END_TURN':
    case 'START_TURN':
    case 'SCORE_AGENDA':
      return null;
    default:
      return 6;
  }
}

function example(key: string, text: string) {
  const list = (out.examples[key] ??= []);
  if (list.length < 12) list.push(text);
}

function table(d: Decision) {
  const s = d.state;
  const w = watch.get(d.agent);
  if (d.kind !== 'action' || !w?.ranked || !d.action || !isCorpMain(s)) return;
  const held0 = (d.before?.heldLine ?? null) as HeldLine | null;
  const score = asSide('corp', () => (decisionContext(s, 'corp'), scoreNowPlan(s)));
  const later = !!heldLaterStep(s, held0);
  const ranked = w.ranked;
  const planned = w.planned ?? null;
  const money = !score && !later ? asSide('corp', () => moneyPick(s, planned ?? ranked[0]?.action)) : null;
  if (score || later || money) return;
  let chosen: GameAction | undefined = planned ?? (ranked[0]?.score > -Infinity ? ranked[0].action : undefined);
  if (chosen?.type === 'GAIN_CREDIT' && plan().pettyCashFirst) chosen = ranked.find(r => isPettyCash(s, r.action) && r.score > -Infinity)?.action ?? chosen;
  if (plan().tagFirst && ranked[0]?.action.type === 'TRASH_RESOURCE' && ranked[0].tagFirst) chosen = ranked[0].action;
  if (!chosen) return;
  // Q5: a two-turn line begun or the pick vetoed (the counted line takes the click)
  const two = asSide('corp', () => scoreInTwoPick(s, chosen!, held0 ? structuredClone(held0) : null));
  if (two.action !== chosen) {
    out.q5++;
    return;
  }
  // The move made: the pick after placement (an install of the same card at another server)
  const made = d.action.type === 'INSTALL_CARD' && chosen.type === 'INSTALL_CARD' && d.action.cardInstanceId === chosen.cardInstanceId ? d.action : chosen;
  const lineOf = (a: GameAction) => asSide('corp', () => (decisionContext(s, 'corp'), intent(s, a)));
  const playedLine = lineOf(made);
  if (playedLine === null) return;
  const src = d.src.startsWith('deal') ? 'deal' : 'human';
  const bucket = (out.bySrc[src] ??= { reached: 0, played: {}, counts: {} });
  out.reached++;
  bucket.reached++;
  out.played[playedLine] = (out.played[playedLine] ?? 0) + 1;
  bucket.played[playedLine] = (bucket.played[playedLine] ?? 0) + 1;
  const avail = new Set<number>();
  const finite = new Set<number>([playedLine]);
  const positive = new Set<number>([playedLine]);
  const cond = new Set<number>([playedLine]);
  if (!asSide('corp', () => meets(s, made, playedLine))) out.failed[playedLine] = (out.failed[playedLine] ?? 0) + 1;
  for (const r of ranked) {
    const l = lineOf(r.action);
    if (l === null) continue;
    avail.add(l);
    if (l === 7 ? r.score > 0 : !cond.has(l) && asSide('corp', () => (decisionContext(s, 'corp'), meets(s, r.action, l)))) cond.add(l);
    if (r.score > -Infinity) finite.add(l);
    if (r.score > 0) positive.add(l);
  }
  for (const [set, to] of [[finite, out.finite], [positive, out.positive], [cond, out.cond]] as const)
    for (const other of set) if (other !== playedLine) to[`${playedLine}>${other}`] = (to[`${playedLine}>${other}`] ?? 0) + 1;
  // The move made is available on its own line even where placement put it at a server the ranking did not list
  avail.add(playedLine);
  if (playedLine === 2 || playedLine === 4 || playedLine === 9) {
    const c = made as Install;
    const k = playedLine === 2 ? 'two' : playedLine === 4 ? 'four' : 'nine';
    out.iceKinds[k]++;
    if (playedLine === 9) out.iceKinds[c.asNewRemote ? 'nineNew' : 'nineExisting']++;
    const card = s.corp.hq.find(x => x.instanceId === c.cardInstanceId);
    example(`played${playedLine}`, `${where(d)} ${card ? cardDef(card).title : '?'} to ${c.asNewRemote ? 'new remote' : c.targetServerId}; credits ${s.corp.credits}, clicks ${s.corp.clicks}`);
  }
  for (const other of avail)
    if (other !== playedLine) {
      const key = `${playedLine}>${other}`;
      out.counts[key] = (out.counts[key] ?? 0) + 1;
      bucket.counts[key] = (bucket.counts[key] ?? 0) + 1;
      if ((playedLine === 8 && other === 3) || (playedLine === 3 && other === 8) || other === 9 || playedLine === 9)
        example(key, `${where(d)} played ${JSON.stringify(made)}; credits ${s.corp.credits}, clicks ${s.corp.clicks}, HQ ${s.corp.hq.length}`);
    }
}

forEachRecorded({
  arm: agent => arm(agent),
  decision: d => {
    try {
      table(d);
    } catch (e) {
      out.errors++;
      console.error(`table at ${where(d)}: ${(e as Error).message}`);
    }
    clearCaches();
  },
});
console.log(JSON.stringify(out));
