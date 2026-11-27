/**
 * F119 (brief /mnt/project-files/netrunner-ai/f119-punisher-field/brief.md rev 1, final): scratch trees for phase A and
 * the ruled arm. Every tree is a copy of the merge base's src (`git archive <ARM_BASE> src`, scripts/corp-owed/trees.ts
 * makeTree) with text patches; the repo's src is never written. Tree dirs go through resolve() (the owed-counts lesson).
 *
 * Each patched tree reads its own switch object, `globalThis.__f119_<tree name>` (one process holds several trees). Unset,
 * every patched line does what the merge base's line did (the field's data is added to the ten entries, read by nothing):
 *   u   part U: the clock's use part (tagUsePart, the field's one reader in evaluate.ts) in place of the punisher term and
 *       the identity's term, the take group only (a use whose effect takes from the Runner: trashRig, damage,
 *       runnerCredits, runnerPoints)
 *   g   with u: the gain group too (a use that only gives the Corp something: Planogram, Synapse Global, Greasing the Palm)
 *   h   part H: Retribution's and Bigger Picture's hand plans read W(does(n)) inside the tag-pricing frame, viewer 'corp';
 *       freeRez.ts's pendingFreeRezzes reads the field's freeRez kind; Mindscaping's and Orbital's corpTurnDamage read the
 *       field's damage (identities but Bigger Picture's plan). Part H rides on both arms (brief, Phase A "Arms").
 *   dbg a function: called with tagLoss's parts { part, ... } (read-only)
 * Arms: base (nothing), U = { u, h }, UG = { u, g, h }.
 *
 * PATCH TEXT FOR THE BUILD: the field's type, the ten entries and the reader are written as the build will write them
 * (phase B bar 2: the branch is the ruled arm, lockstep on every g1 deal), with the switch reads around them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolve } from 'node:path';
import type { Patch } from '../corp-owed/trees';

// (read here from ARGS and argv too: this module is evaluated before count.ts copies ARGS into the environment)
const argBase = `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.match(/(?:^|\s)ARM_BASE=([0-9a-f]{40})/)?.[1];
/** The merge base: beta fd22bef at the branch's start (src/ai tree 0ef5578, the tree the brief read); ARM_BASE overrides it. */
export const MERGE_BASE = argBase ?? process.env.ARM_BASE ?? 'fd22befb800cae59ab27e14729c90de80e8c9879';

// ------------------------------------------------------------------------------------------------ the field's type
const TYPES = `
/** F119: one effect of a tag use (TagUse.does, TagUse.without). Facts only: each kind is priced by its owner in evaluate.ts's
 * one reader (tagUseWorth), never here. */
export interface TagUseEffect {
  trashRig?: 1; // trash 1 installed Runner card (Retribution): trashedCardCost
  damage?: number; // damage dealt, meat or net (damageWorth does not tell them apart)
  runnerCredits?: number; // credits the Runner loses: creditsLessCost on the Runner
  corpCredits?: number; // credits the Corp gains: creditsLessCost on the Corp with a negative n
  corpCards?: number; // net cards the Corp gains in HQ: the flat hand owner handValue
  runnerPoints?: number; // agenda points taken from the Runner's score area: the points owner
  /** an agenda the Corp installs from the Runner's score area (IP Enforcement): its advancement counters, printed advancement
   * requirement and printed points, all public: the installed-agenda owner agendaWorth */
  corpAgenda?: { counters: number; cost: number; points: number };
  freeRez?: number; // installed ice rezzed ignoring all costs (Unleash): freeRez.ts's readers, not the clock
  advance?: number; // advancement counters placed (Greasing the Palm): the click and credit of the advance it saves
  install?: number; // a card installed from HQ ignoring all costs (Synapse Global): the click of the install it saves
}

/** F119: what the Corp does with this card against a Runner holding n tags. Facts only; priced by evaluate.ts's one reader
 * through the owners named per kind (TagUseEffect). Unset: the card uses no tag (the ifTagged synergy flag is not read
 * for this). Every function reads PUBLIC facts only (counts, credits, score areas, counters, tags; never the contents of
 * HQ or R&D or a facedown card's identity), because the Runner's view calls them for cards it cannot see
 * (RULE-HIDDEN-INFO). Every function is closed form in n and finite at n = Infinity (win-now passes Infinity): no loop to
 * n, a min before any product with n. */
export interface TagUse {
  /** where the Corp uses it on its own turn; the reader's cost rule and play gate are by \`from\` */
  from: 'hq' | 'identity' | 'runnerScoreArea' | 'onScore';
  /** tags the use needs (1 for "play only if the Runner is tagged") */
  needs: number;
  /** tags it removes (IP Enforcement: X; Bigger Picture: the useful count) */
  spends: (state: GameState, n: number) => number;
  /** what it does with n tags */
  does: (state: GameState, n: number) => TagUseEffect;
  /** the card's best use with no tag, if it has one; several modes: the reader takes the best (Predictive Planogram) */
  without?: (state: GameState) => TagUseEffect | TagUseEffect[];
}
`;

// ------------------------------------------------------------------------------------------------ the ten entries
const RETRIBUTION = `tagUse: { from: 'hq', needs: 1, spends: () => 0, does: () => ({ trashRig: 1 }) } /* F119: "Trash 1 installed program or piece of hardware." */`;
const ORBITAL_USE = `
/** Orbital Superiority (F119): "When you score this agenda, if the Runner is tagged, do 4 meat damage; otherwise, give the Runner 1 tag." */
const ORBITAL_USE: TagUse = { from: 'onScore', needs: 1, spends: () => 0, does: () => ({ damage: 4 }) };
`;
const PLANOGRAM = `tagUse: {
      // F119: "Resolve 1 of the following. If the Runner is tagged, you may resolve both instead. Gain 3 credits. / Draw 3 cards."
      from: 'hq',
      needs: 1,
      spends: () => 0,
      does: () => ({ corpCredits: 3, corpCards: 3 }),
      without: () => [{ corpCredits: 3 }, { corpCards: 3 }],
    }`;
const IP_PICK = `
/** IP Enforcement's agenda (F119): one in the Runner's score area with printed points X, 1 <= X <= n (the engine's ipTargets,
 * core/scripts/elevation/corp/operations.ts), the most points, then the lowest printed requirement. Public: the score area. */
function ipPick(state: GameState, n: number): { points: number; cost: number } | undefined {
  let best: { points: number; cost: number } | undefined;
  for (const a of state.runner.scoreArea) {
    const def = cardDef(a);
    const points = def.agenda_points ?? 0;
    const cost = def.advancement_cost ?? 0;
    if (points < 1 || points > n) continue;
    if (!best || points > best.points || (points === best.points && cost < best.cost)) best = { points, cost };
  }
  return best;
}
`;
const IP = `tagUse: {
      // F119: "As an additional cost to play this operation, remove X tags. Install 1 agenda from the Runner's score area with a
      // printed agenda point value equal to X. If the Runner is still tagged, place 1 advancement counter on that agenda."
      from: 'hq',
      needs: 1,
      spends: (state, n) => ipPick(state, n)?.points ?? 0,
      does: (state, n) => {
        const pick = ipPick(state, n);
        return pick ? { runnerPoints: pick.points, corpAgenda: { counters: n > pick.points ? 1 : 0, cost: pick.cost, points: pick.points } } : {};
      },
    }`;
const BP = `tagUse: {
      // F119: "Remove any number of tags. The Runner loses 5 credits for each tag removed this way. Gain credits equal to the
      // number of credits the Runner lost." Tags past ceil(credits / 5) buy nothing (rule 1.10.3b)
      from: 'hq',
      needs: 1,
      spends: (state, n) => Math.min(n, Math.ceil(state.runner.credits / 5)),
      does: (state, n) => ({ runnerCredits: Math.min(state.runner.credits, 5 * n), corpCredits: Math.min(state.runner.credits, 5 * n) }),
    }`;
const SYNAPSE = `tagUse: {
      // F119: "[click], remove 1 tag: Gain 2 credits." and "The first time each turn a tag is removed, you may reveal and install 1
      // card from HQ, ignoring all costs." (the click's tag as the first removal on the Corp's next turn: approximation 9)
      from: 'identity',
      needs: 1,
      spends: () => 1,
      does: state => ({ corpCredits: 2, install: state.corp.hq.length > 0 ? 1 : 0 }),
    }`;
const MINDSCAPING_USE = `
/** Mindscaping (F119): "Resolve 1 of the following: Gain 4 credits and draw 2 cards. Add 1 card from HQ to the top of R&D. /
 * Do X net damage. X is equal to the number of tags the Runner has, up to 3." Untagged: 2 drawn, 1 back, net 1 card
 * (the known top card is unpriced: approximation 10). */
const MINDSCAPING_USE: TagUse = { from: 'hq', needs: 1, spends: () => 0, does: (_state, n) => ({ damage: Math.min(3, n) }), without: () => ({ corpCredits: 4, corpCards: 1 }) };
`;
const ORACLE = `tagUse: {
      // F119: "[click], remove 1 tag: Shuffle this agenda into R&D. The Corp can use this ability only if this agenda is in the
      // Runner's score area." Its points leave the Runner's score area; the return to R&D is not read (approximation 5)
      from: 'runnerScoreArea',
      needs: 1,
      spends: () => 1,
      does: () => ({ runnerPoints: 1 }),
    }`;
const GREASING = `tagUse: {
      // F119: "Gain 5 credits. You may install 1 card from HQ. You may remove 1 tag to place 1 advancement counter on that card."
      // (another card in HQ to install; the install is in both modes and cancels)
      from: 'hq',
      needs: 1,
      spends: () => 1,
      does: state => ({ corpCredits: 5, advance: state.corp.hq.length > 1 ? 1 : 0 }),
      without: () => ({ corpCredits: 5 }),
    }`;
const UNLEASH = `tagUse: { from: 'hq', needs: 1, spends: () => 1, does: () => ({ freeRez: 1 }) } /* F119: "As an additional cost to play this operation, remove 1 tag. Rez 1 installed piece of ice, ignoring all costs." */`;

// ------------------------------------------------------------------------------------------------ the reader (evaluate.ts)
const READER = `

/** F119: the cards with a tag use (CardAI tagUse). */
const tagUseOf = (code: string): TagUse | undefined => CARDS[code]?.tagUse;

/**
 * F119 (brief f119-punisher-field rev 1): what one tag use's effect is worth to the Corp, each kind at its owner, as
 * \`viewer\` prices it (the owners table: V7's trashedCardCost, V8's damageWorth, V1's creditsLessCost on both sides, the
 * flat hand owner, the points owner, the installed-agenda owner with no server and no success: the generic steal,
 * approximation 5; an advance or an install as the basic action it saves, approximation 7). freeRez is not priced here.
 */
export function tagUseWorth(state: GameState, viewer: SideCode, e: TagUseEffect): number {
  const corp = state.corp;
  let w = 0;
  if (e.trashRig) w += e.trashRig * trashedCardCost(state);
  if (e.damage) w += damageWorth(state, e.damage);
  if (e.runnerCredits) w += creditsLessCost(state, 'runner', viewer, e.runnerCredits);
  if (e.corpCredits) w -= creditsLessCost(state, 'corp', viewer, -e.corpCredits);
  if (e.corpCards) w += handValue(corp.hq.length + e.corpCards, corp.handSizeLimit, viewer) - handValue(corp.hq.length, corp.handSizeLimit, viewer);
  if (e.runnerPoints) w += pointValue(state.runner.score) - pointValue(Math.max(0, state.runner.score - e.runnerPoints));
  if (e.corpAgenda) w += agendaWorth(state, e.corpAgenda.counters, e.corpAgenda.cost, e.corpAgenda.points);
  if (e.advance || e.install) {
    const click = clickPrice(state, 'corp', viewer);
    if (e.advance) w += e.advance * (click + creditsLessCost(state, 'corp', viewer, 1));
    if (e.install) w += e.install * click;
  }
  return logValue('tag', 'tagUseWorth', state, w, viewer);
}

/** F119: a use takes from the Runner (the take group) or only gives the Corp something (the gain group). */
const takes = (e: TagUseEffect) => !!(e.trashRig || e.damage || e.runnerCredits || e.runnerPoints);

/**
 * F119: the cost of a use, by \`from\`: \`hq\` a click and the card's play cost (IP Enforcement's X is its spends, an additional
 * cost: rules 1.16.10, 1.16.2c), \`identity\` and \`runnerScoreArea\` a click (a [click] trigger cost makes an action, rule
 * 9.5.2a), \`onScore\` nothing (scoring is no action, rule 1.17.3c; the advancing is the agenda owner's). Inside an open hold
 * count the flat form (the tag clock's N1).
 */
function tagUseCost(state: GameState, viewer: SideCode, use: TagUse, credits: number): number {
  if (use.from === 'onScore') return 0;
  if (pricing().countingHold) return CLICK + credits;
  return clickPrice(state, 'corp', viewer) + (credits ? creditsLessCost(state, 'corp', viewer, credits) : 0);
}

/** F119: the gate, by \`from\`: n at least \`needs\`, a click on the Corp's own turn (its next turn has three), and the play
 * cost in credits now (approximation 3). \`onScore\` has its agenda's gate (tagUseFinishable). */
function tagUseGate(state: GameState, n: number, use: TagUse, credits: number): boolean {
  if (n < use.needs) return false;
  if (use.from === 'onScore') return true;
  if (state.activePlayer === 'corp' && state.corp.clicks < 1) return false;
  return state.corp.credits >= credits;
}

/** F119 part D (ruling 3): an installed card the next Corp turn can finish, from its public counters and a printed requirement:
 * three clicks, each advance a click and a credit, a click for each missing credit; on the Corp's own turn its clicks left. */
function tagUseFinishable(state: GameState, counters: number, requirement: number): boolean {
  const need = Math.max(0, requirement - counters);
  const clicks = state.activePlayer === 'corp' ? state.corp.clicks : 3;
  return need + Math.max(0, need - state.corp.credits) <= clicks;
}

/** One use the clock can count: its swing a tag buys and the chance \`viewer\` gives that the Corp has it. */
export interface TagUseCandidate {
  code: string;
  from: TagUse['from'];
  swing: number;
  p: number;
  worth: number;
  cost: number;
  without: number;
}

/**
 * F119 part U: the uses the Corp can make on its next turn with n tags, as \`viewer\` knows the cards, each with the swing a
 * tag buys (open point 1: max(0, W(does(n)) - cost - max(0, W(without) - cost)), a card with no without 0 there) and its
 * chance. The Corp's view: operations in HQ, its identity, a card in the Runner's score area and an installed card it can
 * finish (part D), each a chance of 1. The Runner's view: the public ones (the identity, the Runner's score area) alike;
 * HQ by the unseen pool's odds, card by card (1 - (1 - share) ** hq, approximation 6); a facedown remote card that passes
 * the gate at its public counters by remoteAgendaOdds (with a counter: 1 - trap) times the card's share of the unseen
 * agendas. No card in HQ or R&D is read in the Runner's view, nor a facedown card's identity (RULE-HIDDEN-INFO).
 */
export function tagUseCandidates(state: GameState, viewer: SideCode, n: number): TagUseCandidate[] {
  const A = __F119__;
  const corp = state.corp;
  const out: TagUseCandidate[] = [];
  const add = (code: string, use: TagUse, p: number) => {
    if (p <= 0) return;
    const e = use.does(state, n);
    if (!A.g && !takes(e)) return;
    const credits = use.from === 'hq' ? getCardDefinition(code).cost ?? 0 : 0;
    if (!tagUseGate(state, n, use, credits)) return;
    const cost = tagUseCost(state, viewer, use, credits);
    const worth = tagUseWorth(state, viewer, e);
    const modes = use.without?.(state);
    const without = modes === undefined ? 0 : Math.max(0, ...(Array.isArray(modes) ? modes : [modes]).map(m => tagUseWorth(state, viewer, m) - cost));
    const swing = Math.max(0, worth - cost - without);
    if (swing > 0) out.push({ code, from: use.from, swing, p, worth, cost, without });
  };
  // Public: the identity's ability and a card in the Runner's score area (Oracle Thinktank), in both views
  const id = tagUseOf(corp.identity.cardCode);
  if (id?.from === 'identity') add(corp.identity.cardCode, id, 1);
  for (const c of state.runner.scoreArea) {
    const use = tagUseOf(c.cardCode);
    if (use?.from === 'runnerScoreArea') add(c.cardCode, use, 1);
  }
  const remotes = Object.values(corp.servers).filter(s => s.isRemote);
  if (viewer === 'corp') {
    for (const code of new Set(corp.hq.map(c => c.cardCode))) {
      const use = tagUseOf(code);
      if (use?.from === 'hq') add(code, use, 1);
    }
    for (const s of remotes)
      for (const c of s.root) {
        const use = tagUseOf(c.cardCode);
        if (use?.from === 'onScore' && tagUseFinishable(state, c.advancementCounters, getCardDefinition(c.cardCode).advancement_cost ?? 0)) add(c.cardCode, use, 1);
      }
  } else {
    const unseen = unseenCorpPool(state);
    const count = new Map<string, number>();
    for (const c of unseen) if (tagUseOf(c.cardCode)) count.set(c.cardCode, (count.get(c.cardCode) ?? 0) + 1);
    for (const [code, k] of count) {
      const use = tagUseOf(code)!;
      if (use.from === 'hq') add(code, use, 1 - (1 - k / unseen.length) ** corp.hq.length);
    }
    const scoring = [...count].filter(([code]) => tagUseOf(code)!.from === 'onScore');
    if (scoring.length) {
      const agendas = unseen.filter(c => cardDef(c).type_code === 'agenda').length;
      const trap = trapOdds(state);
      for (const s of remotes)
        for (const c of s.root) {
          if (!isHidden(c)) continue;
          for (const [code, k] of scoring)
            if (tagUseFinishable(state, c.advancementCounters, getCardDefinition(code).advancement_cost ?? 0)) add(code, tagUseOf(code)!, remoteAgendaOdds(state, s, c, trap) * (k / agendas));
        }
    }
  }
  return out;
}

/** F119 part U: what one tag use buys the Corp on its next turn (one use a turn, the best: approximation 1), as viewer's
 * expectation of the best one (the candidates highest swing first, each taken if held and no higher one is). */
function tagUsePart(state: GameState, viewer: SideCode, n: number): number {
  const cands = tagUseCandidates(state, viewer, n).sort((a, b) => b.swing - a.swing);
  let worth = 0;
  let none = 1;
  for (const c of cands) {
    worth += none * c.p * c.swing;
    none *= 1 - c.p;
  }
  return logValue('tag', 'tagUsePart', state, worth, viewer, n);
}

/** F119: the use part read inside the tag-pricing frame on a copy, as the trash part is (tagLossPerTurn). */
export function tagUsePerTurn(state: GameState, viewer: SideCode, n: number): number {
  return withPricing({ pricingTagLoss: true }, () => tagUsePart({ ...state }, viewer, n));
}

/** F119 part H: a held card's W(does(n)) at the board's tags (at least 1), the Corp's own HQ (viewer 'corp'), inside the
 * tag-pricing frame (finding 8): the hand plans' payoff reads the same worth the clock reads. */
export function tagUseHandWorth(state: GameState, code: string): number {
  const use = tagUseOf(code);
  if (!use) return 0;
  return withPricing({ pricingTagLoss: true }, () => tagUseWorth(state, 'corp', use.does(state, Math.max(1, state.runner.tags))));
}`;

/** The patches of a switched tree named `name` (its switches: globalThis.__f119_<name>). */
export function armPatches(name: string): Patch[] {
  const A = `((globalThis as any).__f119_${name} ?? {})`;
  return [
    // ---- types.ts: the field
    ['ai/cards/types.ts', `export interface CardAI {`, `${TYPES.trim()}\n\nexport interface CardAI {`],
    ['ai/cards/types.ts', `  promptAnswer?: (ask: PromptAsk) => PromptChoice | undefined;`, `  promptAnswer?: (ask: PromptAsk) => PromptChoice | undefined;\n  /** F119: what the Corp does with this card against a Runner holding n tags (TagUse), read by evaluate.ts tagUseCandidates. */\n  tagUse?: TagUse;`],
    // ---- the ten entries
    ['ai/cards/systemGateway.ts', `import { CardAI } from './types';`, `import { CardAI, TagUse } from './types';\n${ORBITAL_USE}`],
    ['ai/cards/systemGateway.ts', `  '30065': { synergy: { wants: { tags: 1.5 }, when: ['ifTagged'] } },`, `  '30065': { synergy: { wants: { tags: 1.5 }, when: ['ifTagged'] }, ${RETRIBUTION} },`],
    [
      'ai/cards/systemGateway.ts',
      `  '30068': { corpTurnDamage: state => (state.runner.tags > 0 ? 4 : 0) /* plan.corpTurnDamageOwn: 4 meat only if the Runner is tagged */, synergy:`,
      `  '30068': { tagUse: ORBITAL_USE, corpTurnDamage: state => (${A}.h ? (state.runner.tags >= ORBITAL_USE.needs ? ORBITAL_USE.does(state, state.runner.tags).damage ?? 0 : 0) : state.runner.tags > 0 ? 4 : 0) /* plan.corpTurnDamageOwn: 4 meat only if the Runner is tagged (F119: the field's damage) */, synergy:`,
    ],
    ['ai/cards/systemGateway.ts', `  '30056': { synergy: { gives: { econ: 1, draw: 1 }, wants: { tags: 1 }, when: ['ifTagged'] } },`, `  '30056': {\n    synergy: { gives: { econ: 1, draw: 1 }, wants: { tags: 1 }, when: ['ifTagged'] },\n    ${PLANOGRAM},\n  },`],
    ['ai/cards/elevation.ts', `import { CardAI } from './types';`, `import { CardAI } from './types';\n${IP_PICK}`],
    ['ai/cards/elevation.ts', `  '35066': { synergy: { wants: { tags: 1 }, when: ['ifTagged'] } },`, `  '35066': {\n    synergy: { wants: { tags: 1 }, when: ['ifTagged'] },\n    ${IP},\n  },`],
    ['ai/cards/elevation.ts', `  '35065': { synergy: { gives: { denial: 1.5 }, wants: { tags: 1.5 }, when: ['ifTagged'] } },`, `  '35065': {\n    synergy: { gives: { denial: 1.5 }, wants: { tags: 1.5 }, when: ['ifTagged'] },\n    ${BP},\n  },`],
    ['ai/cards/elevation.ts', `  '35058': { synergy: { gives: { econ: 0.5 }, wants: { tags: 1.5 }, when: ['ifTagged'] } },`, `  '35058': {\n    synergy: { gives: { econ: 0.5 }, wants: { tags: 1.5 }, when: ['ifTagged'] },\n    ${SYNAPSE},\n  },`],
    ['ai/cards/liberation.ts', `import { CardAI } from './types';`, `import { CardAI, TagUse } from './types';\n${MINDSCAPING_USE}`],
    [
      'ai/cards/liberation.ts',
      `    corpTurnDamage: state => Math.min(3, state.runner.tags),`,
      `    tagUse: MINDSCAPING_USE,\n    corpTurnDamage: state => (${A}.h ? (state.runner.tags >= MINDSCAPING_USE.needs ? MINDSCAPING_USE.does(state, state.runner.tags).damage ?? 0 : 0) : Math.min(3, state.runner.tags)),`,
    ],
    ['ai/cards/liberation.ts', `  '34049': { synergy: { gives: { tags: 1 }, wants: { tags: 0.5 } } },`, `  '34049': {\n    synergy: { gives: { tags: 1 }, wants: { tags: 0.5 } },\n    ${ORACLE},\n  },`],
    ['ai/cards/liberation.ts', `  '34037': { synergy: { gives: { econ: 1.5, install: 0.5, advance: 0.5 }, wants: { tags: 0.5 } } },`, `  '34037': {\n    synergy: { gives: { econ: 1.5, install: 0.5, advance: 0.5 }, wants: { tags: 0.5 } },\n    ${GREASING},\n  },`],
    ['ai/cards/vantagePoint.ts', `  '36044': { synergy: { wants: { tags: 1.5, ice: 1 }, when: ['ifTagged'] } },`, `  '36044': { synergy: { wants: { tags: 1.5, ice: 1 }, when: ['ifTagged'] }, ${UNLEASH} },`],
    // ---- evaluate.ts: imports
    ['ai/evaluate.ts', `import { CardInstance, GameState, SideCode, cardDef } from '../core';`, `import { CardInstance, GameState, SideCode, cardDef, getCardDefinition } from '../core';`],
    ['ai/evaluate.ts', `import { PACE, STEAL, coreSlotWorth, flatlineOdds, lifeGrip, runSuccess, stealOdds } from './effectValues';`, `import { PACE, STEAL, coreSlotWorth, damageWorth, flatlineOdds, lifeGrip, runSuccess, stealOdds } from './effectValues';`],
    ['ai/evaluate.ts', `import { remoteAgendaOdds, trapOdds, trashedCardCost } from './runs';`, `import { remoteAgendaOdds, trapOdds, trashedCardCost } from './runs';\nimport type { TagUse, TagUseEffect } from './cards/types';`],
    // ---- evaluate.ts: tagClock passes n; the use part under its own key on the same home
    [
      'ai/evaluate.ts',
      "  const perTurn = memoHome\n    ? memo(memoHome, `tagLoss:${viewer}:${skip}:c${state.runner.clicks}`, () => tagLossPerTurn(state, viewer, skip))\n    : memo(state, `tagLoss:${viewer}:${skip}`, () => tagLossPerTurn(state, viewer, skip));",
      `  const A = ${A};
  const sw = A.u ? (A.g ? 'ug' : 'u') : ''; // scratch only: the switch in the keys (the build has one key each)
  const trashPart = memoHome
    ? memo(memoHome, \`tagLoss\${sw}:\${viewer}:\${skip}:c\${state.runner.clicks}\`, () => tagLossPerTurn(state, viewer, skip))
    : memo(state, \`tagLoss\${sw}:\${viewer}:\${skip}\`, () => tagLossPerTurn(state, viewer, skip));
  // F119 part U: the use part depends on n (the tags priced), kept under its own key on the same home, with the copy's clicks
  // on tagCost's home as the trash part has (finding 9: damageWorth reads the Runner's clicks)
  const usePart = !A.u
    ? 0
    : memoHome
      ? memo(memoHome, \`tagUse\${sw}:\${viewer}:\${tags}:c\${state.runner.clicks}\`, () => tagUsePerTurn(state, viewer, tags))
      : memo(state, \`tagUse\${sw}:\${viewer}:\${tags}\`, () => tagUsePerTurn(state, viewer, tags));
  if (A.dbg) A.dbg({ part: 'clock', trashPart, usePart, viewer, tags });
  const perTurn = trashPart + usePart;`,
    ],
    // ---- evaluate.ts: tagLoss without the punisher term under u
    ['ai/evaluate.ts', `function tagLoss(state: GameState, viewer: SideCode, skip: number): number {`, `function tagLoss(state: GameState, viewer: SideCode, skip: number): number {\n  const A = ${A};`],
    ['ai/evaluate.ts', `    trash = Math.max(0, nets[skip] ?? 0) - cost;`, `    trash = Math.max(0, nets[skip] ?? 0) - cost;\n    if (A.dbg) A.dbg({ part: 'trash', nets, cost, viewer, skip });`],
    [
      'ai/evaluate.ts',
      `  const flagged = (c: CardInstance) => cardSynergy(cardDef(c)).when?.includes('ifTagged') ?? false;`,
      `  // F119 part U: the use part (tagUsePart, read in tagClock) replaces the punisher term and the identity's
  if (A.u) return Math.max(trash, 0);
  const flagged = (c: CardInstance) => cardSynergy(cardDef(c)).when?.includes('ifTagged') ?? false;`,
    ],
    [
      'ai/evaluate.ts',
      `  return Math.max(trash, 0) + punish + (punishes(corp.identity) ? 1 : 0);\n}`,
      `  if (A.dbg) A.dbg({ part: 'punish', held, punish, id: punishes(corp.identity) ? 1 : 0, viewer, skip });
  return Math.max(trash, 0) + punish + (punishes(corp.identity) ? 1 : 0);
}${READER.replace('__F119__', A)}`,
    ],
    // ---- cardPlans.ts: Retribution's and Bigger Picture's payoffs (part H)
    ['ai/cardPlans.ts', `import { corpCardValue, tagsWorth } from './evaluate';`, `import { corpCardValue, tagUseHandWorth, tagsWorth } from './evaluate';`],
    [
      'ai/cardPlans.ts',
      `  '30065': { side: 'corp', hand: { payoff: (state, card) => net(state, card, trashedCardCost(state)), ready: tagReady } },`,
      `  '30065': { side: 'corp', hand: { payoff: (state, card) => net(state, card, ${A}.h ? tagUseHandWorth(state, card.cardCode) : trashedCardCost(state)), ready: tagReady } },`,
    ],
    [
      'ai/cardPlans.ts',
      `    hand: { payoff: (state, card) => net(state, card, 2 * Math.min(state.runner.credits, 5 * Math.max(1, state.runner.tags))), ready: tagReady },`,
      `    hand: { payoff: (state, card) => net(state, card, ${A}.h ? tagUseHandWorth(state, card.cardCode) : 2 * Math.min(state.runner.credits, 5 * Math.max(1, state.runner.tags))), ready: tagReady },`,
    ],
    // ---- freeRez.ts: Unleash read from the field (part H)
    ['ai/freeRez.ts', `import { rezCost } from '../core/engine/cardEffects';`, `import { rezCost } from '../core/engine/cardEffects';\nimport { CARDS } from './cards';`],
    [
      'ai/freeRez.ts',
      `  n += Math.min(state.runner.tags, corp.hq.filter(c => c.cardCode === UNLEASH).length);`,
      `  // F119 part H: the cards in HQ whose tag use rezzes for free (Unleash), at most one per tag
  const gives = (c: CardInstance) => { const use = CARDS[c.cardCode]?.tagUse; return !!use && state.runner.tags >= use.needs && (use.does(state, state.runner.tags).freeRez ?? 0) > 0; };
  n += Math.min(state.runner.tags, corp.hq.filter(c => (${A}.h ? gives(c) : c.cardCode === UNLEASH)).length);`,
    ],
  ];
}

export type Arm = 'base' | 'U' | 'UG' | 'H';
/** The arms phase A reads side by side (H: part H alone, for step 6's identities). */
export const ARMS: Arm[] = ['base', 'U', 'UG'];
export const armSwitch = (arm: Arm) => ({ u: arm === 'U' || arm === 'UG', g: arm === 'UG', h: arm !== 'base' });
/** Set a tree's switches (keeps dbg when given). */
export function setArm(name: string, arm: Arm, extra: Record<string, unknown> = {}) {
  (globalThis as any)[`__f119_${name}`] = { ...armSwitch(arm), ...extra };
}
export const treeRoot = (shard: number) => resolve(process.env.TROOT ?? 'node_modules/.cache/f119-punisher-field', String(shard));
