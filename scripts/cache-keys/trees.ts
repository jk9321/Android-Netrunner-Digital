/**
 * F3 / R-80 count (brief /mnt/project-files/netrunner-ai/cache-keys/brief-count.md rev 0): the trees. Scratch copies of
 * this checkout's src with text patches; the repo's src is never patched. A patch is a slice of one file, from a start
 * marker to an end marker (both inclusive), each marker matching exactly once (a stop otherwise).
 *
 * The three maps and their variants (the brief's arms):
 *   base     src's code, with the count's hooks only (calls, hits, misses, fills, cap clears; each hook is a global the
 *            script sets, inert while unset). `ctl` is this for all three maps.
 *   exact    the key completed with everything the value reads (V-B B1's form, aeba2d86): threats, the codes of the live
 *            pool itself (the list the value is worked out from, so nothing it reads is left out) and the board facts;
 *            deckAverage and clickCache, the whole position (every field of the GameState but its log, hashed, kept per
 *            position object with fingerprint's check as valueModel memo does) and the pricing context fields pricingKey
 *            leaves out (frozen, both sides' known hands, the anchor with its root's content, the decision seed,
 *            rezzingToUse). The cap clear is kept.
 *   byState  the map hung on the GameState object (a WeakMap), the inner key only what is not in the state: threats
 *            skipIce and own; deckAverage deckPricingKey and the side; clickCache pricingKey and the side; for both of
 *            these, the same context fields as exact (the anchor's root by object). No cap.
 *   off      no map: the value worked out on every call.
 *   table    threats only (the arm of this count's own, step 0): no threats map; cardDamage (a pure function of the card
 *            code: its printed text) looked up from a per-code table filled on first use. Exact by construction.
 *
 * Asked trees: `ctl`, and for each map M in t (threats), d (deckAverage), c (clickCache), all (the three together):
 * M.exact, M.byState, M.off (+ t.table). Step 0.4's planted faults: f.threat (a threats hit served with share + 0.01),
 * f.deck (a deckAverage hit served the value of the entry stored just before it).
 * `source` is src unchanged (plays); `eval` has every value cache serving nothing (the on-hit audit's recompute).
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { HOOKS, applyPatches } from '../runner-rework/core-hooks';
import { PointVariant, branchPoints, clickPoints, deckPoints, threatsPoints } from './points';

export type Slice = [file: string, from: string, to: string, text: string];
export type Variant = 'base' | 'exact' | 'byState' | 'off' | 'table' | 'fault';
export type MapName = 'threats' | 'deckAverage' | 'clickCache';
export const MAPS: MapName[] = ['threats', 'deckAverage', 'clickCache'];
/** buildTargets (F113, the coordinator's addition after step 0): optional, base when absent. */
/** `point`: the maps' base and byState variants as point patches (points.ts: key, lookup, set and cap lines only; F3 build). */
export type Arm = Record<MapName, Variant> & { buildTargets?: 'base' | 'exact' | 'byState' | 'off'; point?: boolean; asIs?: boolean; fault?: MapName; freeze?: boolean };

const B: Arm = { threats: 'base', deckAverage: 'base', clickCache: 'base' };
const A3 = (v: Variant): Arm => ({ threats: v, deckAverage: v, clickCache: v });
export const ARMS: Record<string, Arm> = {
  ctl: B,
  't.exact': { ...B, threats: 'exact' },
  't.byState': { ...B, threats: 'byState' },
  't.off': { ...B, threats: 'off' },
  't.table': { ...B, threats: 'table' },
  'd.exact': { ...B, deckAverage: 'exact' },
  'd.byState': { ...B, deckAverage: 'byState' },
  'd.off': { ...B, deckAverage: 'off' },
  'c.exact': { ...B, clickCache: 'exact' },
  'c.byState': { ...B, clickCache: 'byState' },
  'c.off': { ...B, clickCache: 'off' },
  'all.exact': { threats: 'exact', deckAverage: 'exact', clickCache: 'exact' },
  'all.byState': { threats: 'byState', deckAverage: 'byState', clickCache: 'byState' },
  'all.off': { threats: 'off', deckAverage: 'off', clickCache: 'off' },
  'b.exact': { ...B, buildTargets: 'exact' },
  'b.byState': { ...B, buildTargets: 'byState' },
  'b.off': { ...B, buildTargets: 'off' },
  'all4.exact': { ...A3('exact'), buildTargets: 'exact' },
  'all4.byState': { ...A3('byState'), buildTargets: 'byState' },
  'all4.off': { ...A3('off'), buildTargets: 'off' },
  // F3 build (brief-build rev 1): point-patched control and byState arms, honest on a base whose value code moved
  ctlP: { ...B, point: true },
  'tP.byState': { ...B, threats: 'byState', point: true },
  'dP.byState': { ...B, deckAverage: 'byState', point: true },
  'cP.byState': { ...B, clickCache: 'byState', point: true },
  'allP.byState': { ...A3('byState'), point: true },
  // The build branch itself: this checkout's src with the GameRunner scope labels only (BASE_REF gives the others the base's src)
  branch: { ...B, asIs: true },
  // Step 0.5: the planted faults on the branch's own lines
  'branch.fT': { ...B, asIs: true, fault: 'threats' },
  'branch.fD': { ...B, asIs: true, fault: 'deckAverage' },
  'branch.fC': { ...B, asIs: true, fault: 'clickCache' },
  // Step 0.3: the branch with the asked-board freeze on (valueModel askedFreeze), in the lockstep and in its own play
  'branch.frz': { ...B, asIs: true, freeze: true },
  'f.threat': { ...B, threats: 'fault' },
  'f.deck': { ...B, deckAverage: 'fault' },
};
/** A process plays one group: ctl beside the group's arms (memory: each tree is its own module graph). */
export const GROUPS: Record<string, string[]> = {
  t: ['ctl', 't.exact', 't.byState', 't.off', 't.table'],
  d: ['ctl', 'd.exact', 'd.byState', 'd.off'],
  c: ['ctl', 'c.exact', 'c.byState', 'c.off'],
  all: ['ctl', 'all.exact', 'all.byState', 'all.off'],
  f: ['ctl', 'f.threat', 'f.deck'],
  b: ['ctl', 'b.exact', 'b.byState', 'b.off'],
  all4: ['ctl', 'all4.exact', 'all4.byState', 'all4.off'],
  // The point arms beside the count's slice arms, on the counted tree's kind of base (they must agree there)
  pchk: ['ctl', 'ctlP', 'all.byState', 'allP.byState'],
  // The point arms alone (any base)
  p: ['ctlP', 'tP.byState', 'dP.byState', 'cP.byState', 'allP.byState'],
  // Bar 1 and the time bar (rev 1, findings 4, 5b): control and the counted arm on the base (BASE_REF), the branch beside them
  bar1: ['ctlP', 'allP.byState', 'branch'],
  // Step 0.5 (bar 4): the branch beside its three planted faults; each must stop in the lockstep
  bf: ['branch', 'branch.fT', 'branch.fD', 'branch.fC'],
  // Step 0.3 (bar 3): the freeze in self-play; a write to an asked board is an ask error or a deal error
  bfz: ['branch', 'branch.frz'],
};

const H = `(globalThis as any).__ck`;

// ------------------------------------------------------------------------------------------------ threats
const T_FROM = '  const key = `${state.id}:${state.corp.archives.faceUp.length}:';
const T_TO = '  threats.set(key, threat);\n  return threat;\n}';
const T_WORK = `  const hits = live
    .filter(c => !skipIce || cardDef(c).type_code !== 'ice')
    .map(c => (own ? ownTurnDamage(state, c.cardCode) : cardDamage(c.cardCode)))
    .filter(n => n > 0);
  const threat = { burst: hits.length ? Math.max(...hits) : 0, share: live.length ? hits.length / live.length : 0 };`;
const T_LIVE = `  const gone = new Set([...state.corp.archives.faceUp, ...state.corp.scoreArea, ...state.runner.scoreArea].map(c => c.instanceId));
  const live = sideCards(state, 'corp').filter(c => !gone.has(c.instanceId));`;
const T_BASEKEY = '  const key = `${state.id}:${state.corp.archives.faceUp.length}:${state.corp.scoreArea.length}:${state.runner.scoreArea.length}:${skipIce}:${own}:${own && tagged}:${own ? boardFacts(state) : \'\'}:${count}`;';
function threatsText(v: Variant, tree: string): string {
  const call = `  const __H = ${H};\n  __H?.call('${tree}', 'threats');`;
  const cachedGet = (get: string, ref: string, fault = false) => `  const cached = ${get};
  if (cached && !threatsAudit.on) return __H ? __H.hit('${tree}', 'threats', ${fault ? '{ burst: cached.burst, share: cached.share + 0.01 }' : 'cached'}, state, corpTurn, ${ref}) : ${fault ? '{ burst: cached.burst, share: cached.share + 0.01 }' : 'cached'};
  __H?.miss('${tree}', 'threats');`;
  if (v === 'base' || v === 'fault')
    return `${T_BASEKEY}
${call}
  scopeToGame(threats, state);
${cachedGet('threats.get(key)', 'key', v === 'fault')}
${T_LIVE}
${T_WORK}
  if (threats.size > 200) {
    threats.clear();
    __H?.clear('${tree}', 'threats');
  }
  threats.set(key, threat);
  __H?.fill('${tree}', 'threats', threat, state, corpTurn, key);
  return threat;
}`;
  if (v === 'exact')
    return `${call}
${T_LIVE}
  const key = \`\${state.id}:\${skipIce}:\${own}:\${own && tagged}:\${own ? boardFacts(state) : ''}:\${live.map(c => c.cardCode).join(',')}\`;
  scopeToGame(threats, state);
${cachedGet('threats.get(key)', 'key')}
${T_WORK}
  if (threats.size > 200) {
    threats.clear();
    __H?.clear('${tree}', 'threats');
  }
  threats.set(key, threat);
  __H?.fill('${tree}', 'threats', threat, state, corpTurn, key);
  return threat;
}`;
  if (v === 'byState')
    return `${call}
  let __in = __threatsBS.get(state);
  if (!__in) __threatsBS.set(state, (__in = new Map()));
  const key = \`\${skipIce}:\${own}\`;
${cachedGet('__in.get(key)', '[state, key]')}
${T_LIVE}
${T_WORK}
  __in.set(key, threat);
  __H?.fill('${tree}', 'threats', threat, state, corpTurn, [state, key]);
  return threat;
}`;
  // off, table: no map (table: cardDamage itself is looked up per code, below); every value checked as a fill (no entry)
  return `${call}
  void count;
  void tagged;
${T_LIVE}
${T_WORK}
  __H?.fill('${tree}', 'threats', threat, state, corpTurn, null);
  return threat;
}`;
}
const T_DECL = 'const threats = new Map<string, { burst: number; share: number }>();';
const T_TABLE: Slice = [
  'ai/effectValues.ts',
  'function cardDamage(code: string): number {',
  'function cardDamage(code: string): number {',
  `const __dmgTable = new Map<string, number>();
function cardDamage(code: string): number {
  let d = __dmgTable.get(code);
  if (d === undefined) __dmgTable.set(code, (d = __cardDamageText(code)));
  return d;
}
function __cardDamageText(code: string): number {`,
];

// ------------------------------------------------------------------------------------------------ deckAverage
const D_FROM = "  const credits = `${side === 'corp' ? state.corp.credits : state.runner.credits}:`;";
const D_TO = '  deckAverage.set(key, value);\n  return value;\n}';
const D_WORK = '  const value = withPricing({ averaging: true }, () => (deck.length ? deck.reduce((n, c) => n + heldWorth(state, c, side), 0) / deck.length : RATES.drawnCard));';
const D_KEY = "  const key = `${deckPricingKey()}:${side}:${state.id}:${state.turnNumber}:${credits}${board}${deck.map(c => c.instanceId + c.cardCode).join(',')}`;";
function deckText(v: Variant, tree: string): string {
  const call = `  const __H = ${H};\n  __H?.call('${tree}', 'deckAverage');`;
  const hit = (get: string, ref: string, served = 'cached') => `  const cached = ${get};
  if (cached !== undefined && !drawAudit.on) return __H ? __H.hit('${tree}', 'deckAverage', ${served}, state, side, ${ref}) : ${served};
  __H?.miss('${tree}', 'deckAverage');`;
  const pre = `  const credits = \`\${side === 'corp' ? state.corp.credits : state.runner.credits}:\`;
  const board = \`\${fingerprint(state)}:\`;`;
  if (v === 'base' || v === 'exact' || v === 'fault')
    return `${pre}
${v === 'exact' ? D_KEY.replace('.join(\',\')}`;', ".join(',')}:${__ckContent(state)}:${__ckCtx(false)}`;") : D_KEY}
${call}
  scopeToGame(deckAverage, state);
${hit('deckAverage.get(key)', 'key', v === 'fault' ? '(__deckLast ?? cached)' : 'cached')}
${D_WORK}
  if (deckAverage.size > 500) {
    deckAverage.clear();
    __H?.clear('${tree}', 'deckAverage');
  }
  deckAverage.set(key, value);${v === 'fault' ? '\n  __deckLast = value;' : ''}
  __H?.fill('${tree}', 'deckAverage', value, state, side, key);
  return value;
}${v === 'fault' ? '\nlet __deckLast: number | undefined;' : ''}`;
  if (v === 'byState')
    return `${call}
  let __in = __deckBS.get(state);
  if (!__in) __deckBS.set(state, (__in = new Map()));
  const key = \`\${deckPricingKey()}:\${side}:\${__ckCtx(true)}\`;
${hit('__in.get(key)', '[state, key]')}
${D_WORK}
  __in.set(key, value);
  __H?.fill('${tree}', 'deckAverage', value, state, side, [state, key]);
  return value;
}`;
  return `${call}
${D_WORK}
  __H?.fill('${tree}', 'deckAverage', value, state, side, null);
  return value;
}`;
}
const D_DECL = 'const deckAverage = new Map<string, number>();';

// ------------------------------------------------------------------------------------------------ clickCache
const C_FROM = '  const key = `${pricingKey()}:${side}:${state.id}:${state.turnNumber}:${player.clicks}:';
const C_TO = '  clickCache.set(key, value);\n  return value;\n}';
const C_BASEKEY = "  const key = `${pricingKey()}:${side}:${state.id}:${state.turnNumber}:${player.clicks}:${player.credits}:${(side === 'corp' ? state.corp.hq : state.runner.grip).map(c => c.instanceId).join(',')}:${fingerprint(state)}`;";
const C_WORK = `  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  const credits = player.credits;
  const plays = hand
    .filter(c => (cardDef(c).cost ?? 0) <= credits && cardDef(c).type_code !== 'agenda')
    .map(c => (1 - SOON.now) * (playedWorth(state, c) + CLICK))
    .sort((a, b) => b - a);
  const repeatable = Math.max(1, logValue('cardDrawn', 'clickWorth drawWorth', state, side === actingSide() ? cardRate(state, side) : drawWorth(state, side), side));
  let total = 0;
  for (let i = 0; i < clicks; i++) total += Math.max(repeatable, plays[i] ?? 0);
  const value = Math.max(1, Math.min(3, total / clicks));`;
function clickText(v: Variant, tree: string): string {
  const call = `  const __H = ${H};\n  __H?.call('${tree}', 'clickCache');`;
  const hit = (get: string, ref: string) => `  const cached = ${get};
  if (cached !== undefined && !clickAudit.on) return __H ? __H.hit('${tree}', 'clickCache', cached, state, side, ${ref}) : cached;
  __H?.miss('${tree}', 'clickCache');`;
  if (v === 'base' || v === 'exact')
    return `${v === 'exact' ? C_BASEKEY.replace('${fingerprint(state)}`;', '${fingerprint(state)}:${__ckContent(state)}:${__ckCtx(false)}`;') : C_BASEKEY}
${call}
  scopeToGame(clickCache, state);
${hit('clickCache.get(key)', 'key')}
${C_WORK}
  if (clickCache.size > 2000) {
    clickCache.clear();
    __H?.clear('${tree}', 'clickCache');
  }
  clickCache.set(key, value);
  __H?.fill('${tree}', 'clickCache', value, state, side, key);
  return value;
}`;
  if (v === 'byState')
    return `${call}
  let __in = __clickBS.get(state);
  if (!__in) __clickBS.set(state, (__in = new Map()));
  const key = \`\${pricingKey()}:\${side}:\${__ckCtx(true)}\`;
${hit('__in.get(key)', '[state, key]')}
${C_WORK}
  __in.set(key, value);
  __H?.fill('${tree}', 'clickCache', value, state, side, [state, key]);
  return value;
}`;
  return `${call}
${C_WORK}
  __H?.fill('${tree}', 'clickCache', value, state, side, null);
  return value;
}`;
}
const C_DECL = 'const clickCache = new Map<string, number>();';

// ------------------------------------------------------------------------------------------------ buildTargets (F113)
// The value reads corpIceMean (its own per-game map, 0 wrong in step 0's E) and the side's cards in every zone: the
// Corp's agendas' advancement costs, or the Runner's card costs. exact keys those (the side, the ice mean, the codes of
// the side's cards); byState hangs the map on the GameState; off works it out on every call.
const B_FROM = '  const key = `${side}:${state.id}:${state.corp.identity.cardCode}:${state.runner.identity.cardCode}`;';
const B_TO = '  buildTargets.set(key, target);\n  return target;\n}';
const B_WORK = `  const corpCards = sideCards(state, 'corp');
  const runnerCards = sideCards(state, 'runner');
  const ice = corpIceMean(state);
  let target: number;
  if (side === 'corp') {
    target = 2.5 * ice + mean(corpCards.filter(c => cardDef(c).type_code === 'agenda').map(c => cardDef(c).advancement_cost ?? 3), 3);
  } else {
    const costs = runnerCards.map(c => cardDef(c).cost ?? 0).sort((a, b) => b - a);
    target = 2.5 * ice + mean(costs.slice(0, 3), 3);
  }`;
function buildText(v: 'exact' | 'byState' | 'off', tree: string): string {
  const hit = `  if (cached !== undefined) return ${H}?.other ? ${H}.other('${tree}', 'buildTargets', cached, state, side) : cached;`;
  if (v === 'exact')
    return `  const key = \`\${side}:\${corpIceMean(state)}:\${sideCards(state, side).map(c => c.cardCode).sort().join(',')}\`;
  const cached = buildTargets.get(key);
${hit}
${B_WORK}
  buildTargets.set(key, target);
  return target;
}`;
  if (v === 'byState')
    return `  let __in = __buildBS.get(state);
  if (!__in) __buildBS.set(state, (__in = new Map()));
  const cached = __in.get(side);
${hit}
${B_WORK}
  __in.set(side, target);
  return target;
}`;
  return `${B_WORK}
  return target;
}`;
}

// ------------------------------------------------------------------------------------------------ helpers (valueModel.ts)
/** The exact arms' position print and the context print; appended to valueModel.ts in every asked tree (unused by base). */
const HELPERS = `
// ---- cache-keys count (scratch tree only)
import { pricing as __ckPricing } from './pricing';
const __ckPrints = new WeakMap<GameState, { print: string; hash: string }>();
/** The whole position but its log, hashed (53 bits), kept per position object with fingerprint's check (memo's form). */
export function __ckContent(state: GameState): string {
  const print = fingerprint(state);
  const had = __ckPrints.get(state);
  if (had && had.print === print) return had.hash;
  const text = JSON.stringify(state, (k, v) => (k === 'log' ? undefined : v));
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ text.charCodeAt(i), 0x5bd1e995) ^ (b >>> 15);
  }
  const hash = ((a >>> 0) * 2 ** 21 + ((b >>> 0) & 0x1fffff)).toString(36);
  __ckPrints.set(state, { print, hash });
  return hash;
}
/** The pricing context fields pricingKey leaves out; the anchor's root by content, or (byObject) by object. */
export function __ckCtx(byObject: boolean): string {
  const c = __ckPricing();
  const k = (s: Set<string> | null) => (s ? [...s].join(',') : '-');
  const a = c.anchor;
  const root = a?.root ? (byObject ? 'o' + positionSerial(a.root) : 'c' + __ckContent(a.root)) : '';
  return \`\${c.frozen ? 'f' : ''}|\${k(c.known.corp)}|\${k(c.known.runner)}|\${a ? a.id + ':' + a.credits + ':' + (a.side ?? '') + ':' + root : ''}|\${c.decisionSeed ?? ''}|\${[...c.rezzingToUse].join(',')}\`;
}
`;

function slice(dir: string, [file, from, to, text]: Slice, what: string) {
  const path = join(dir, 'src', file);
  const src = readFileSync(path, 'utf8');
  if (src.split(from).length !== 2) throw new Error(`${what}: start marker does not match once in ${file}: ${from.slice(0, 80)}`);
  const a = src.indexOf(from);
  const rest = src.slice(a);
  if (rest.split(to).length !== 2) throw new Error(`${what}: end marker does not match once after the start in ${file}: ${to.slice(0, 80)}`);
  const b = a + rest.indexOf(to) + to.length;
  writeFileSync(path, src.slice(0, a) + text + src.slice(b));
}
const read = (p: string) => readFileSync(p, 'utf8');
const write = (p: string, t: string) => writeFileSync(p, t);

/** An asked tree: the arm's three map variants, the hooks, the GameRunner scope labels (reply, oracle, hard). */
export function armTree(dir: string, tree: string, arm: Arm) {
  if (arm.asIs) {
    applyPatches(dir, HOOKS.filter(h => h[2].includes('__lkIn') || h[2].includes('__lkScope')), `${tree} scopes`, read, write);
    // The branch's own key, lookup and set lines, with the count's hooks (bar 1: calls, hits, misses; bar 2: the audit)
    branchPoints(dir, tree, arm.fault);
    if (arm.freeze) {
      const vm = join(dir, 'src/ai/valueModel.ts');
      const text = read(vm);
      if (!text.includes('export const askedFreeze = { on: false, frozen: 0 };')) throw new Error(`${tree}: no askedFreeze switch`);
      write(vm, text.replace('export const askedFreeze = { on: false, frozen: 0 };', 'export const askedFreeze = { on: true, frozen: 0 };'));
    }
    return;
  }
  if (arm.point) {
    const pv = (v: Variant): PointVariant => {
      if (v !== 'base' && v !== 'byState') throw new Error(`${tree}: point arms take base or byState, not ${v}`);
      return v;
    };
    threatsPoints(dir, tree, pv(arm.threats));
    deckPoints(dir, tree, pv(arm.deckAverage));
    clickPoints(dir, tree, pv(arm.clickCache));
  } else {
    slice(dir, ['ai/effectValues.ts', T_FROM, T_TO, threatsText(arm.threats, tree)], `${tree} threats`);
    slice(dir, ['ai/handValues.ts', D_FROM, D_TO, deckText(arm.deckAverage, tree)], `${tree} deckAverage`);
    slice(dir, ['ai/handValues.ts', C_FROM, C_TO, clickText(arm.clickCache, tree)], `${tree} clickCache`);
  }
  if (arm.threats === 'table') slice(dir, T_TABLE, `${tree} table`);
  const bv = arm.buildTargets ?? 'base';
  if (bv !== 'base') slice(dir, ['ai/valueModel.ts', B_FROM, B_TO, buildText(bv, tree)], `${tree} buildTargets`);
  applyPatches(
    dir,
    [
      ['ai/effectValues.ts', T_DECL, `${T_DECL}\nconst __threatsBS = new WeakMap<GameState, Map<string, { burst: number; share: number }>>();`],
      ['ai/handValues.ts', D_DECL, `${D_DECL}\nconst __deckBS = new WeakMap<GameState, Map<string, number>>();`],
      ['ai/handValues.ts', C_DECL, `${C_DECL}\nconst __clickBS = new WeakMap<GameState, Map<string, number>>();`],
      ['ai/handValues.ts', `import { CLICK, `, `import { __ckContent, __ckCtx, CLICK, `],
      // E: the other maps' hits (counted and audited in the ctl tree only; inert elsewhere)
      ['ai/valueModel.ts', `  const cached = iceMeans.get(key);\n  if (cached !== undefined) return cached;`, `  const cached = iceMeans.get(key);\n  if (cached !== undefined) return ${H}?.other ? ${H}.other('${tree}', 'iceMeans', cached, state) : cached;`],
      ...(bv === 'base'
        ? ([['ai/valueModel.ts', `  const cached = buildTargets.get(key);\n  if (cached !== undefined) return cached;`, `  const cached = buildTargets.get(key);\n  if (cached !== undefined) return ${H}?.other ? ${H}.other('${tree}', 'buildTargets', cached, state, side) : cached;`]] as [string, string, string][])
        : [['ai/valueModel.ts', 'const buildTargets = new Map<string, number>();', 'const buildTargets = new Map<string, number>();\nconst __buildBS = new WeakMap<GameState, Map<string, number>>();'] as [string, string, string]]),
      ['ai/iceValues.ts', `  const cached = deckShares.get(key);\n  if (cached) return cached;`, `  const cached = deckShares.get(key);\n  if (cached) return ${H}?.other ? ${H}.other('${tree}', 'deckShares', cached, state) : cached;`],
...(read(join(dir, 'src/ai/effectValues.ts')).includes(`  let codes = boardFactCodes.get('codes');`) ? [['ai/effectValues.ts', `  let codes = boardFactCodes.get('codes');\n  if (!codes)`, `  let codes = boardFactCodes.get('codes');\n  if (codes && ${H}?.other) codes = ${H}.other('${tree}', 'boardFactCodes', codes, state);\n  if (!codes)`]] as [string, string, string][] : []),
      ['ai/evaluate.ts', `  return memo(state, 'hiddenCardOdds', () => hiddenCardOddsOf(state));`, `  let __filled = false;\n  const __v = memo(state, 'hiddenCardOdds', () => ((__filled = true), hiddenCardOddsOf(state)));\n  return !__filled && ${H}?.other ? ${H}.other('${tree}', 'hiddenCardOdds', __v, state) : __v;`],
    ],
    `${tree} declarations`,
    read,
    write
  );
  writeFileSync(join(dir, 'src/ai/valueModel.ts'), read(join(dir, 'src/ai/valueModel.ts')) + HELPERS);
  applyPatches(dir, HOOKS.filter(h => h[2].includes('__lkIn') || h[2].includes('__lkScope')), `${tree} scopes`, read, write);
}

/** The eval tree: every value cache serves and stores nothing; the miss paths are reached through exports. */
export const CACHES: [file: string, name: string][] = [
  ['ai/valueModel.ts', 'memos'],
  ['ai/valueModel.ts', 'buildTargets'],
  ['ai/valueModel.ts', 'iceMeans'],
  ['ai/iceValues.ts', 'deckShares'],
  ['ai/oracle.ts', 'playedOut'],
  ['ai/handValues.ts', 'deckAverage'],
  ['ai/handValues.ts', 'clickCache'],
  ['ai/effectValues.ts', 'threats'],
  ['ai/effectValues.ts', 'boardFactCodes'],
  ['ai/prompts.ts', 'runAfters'],
  ['ai/corp/hold.ts', 'turnAnswers'],
  ['ai/corp/hold.ts', 'reachAnswers'],
  ['ai/corp/hold.ts', 'runAnswers'],
  ['ai/turnPlanner.ts', 'runnerViews'],
  ['ai/turnPlanner.ts', 'corpViews'],
  ['ai/turnPlanner.ts', 'corpViewSet'],
  // R-14h (F3 build rev 1, finding 3): drawMoney's per-board money; on a base without R-14h it is absent (OPTIONAL)
  ['ai/handValues.ts', 'laterMoneys'],
];
/** CACHES entries a base may not have yet. */
// boardFactCodes: deleted with threats' string key by the F3 build (its one reader), present on older bases
const OPTIONAL = new Set(['laterMoneys', 'boardFactCodes']);
/**
 * The module-level maps of src/ai that are neither in CACHES nor known pure (a function of a card's text or a label, or
 * not a value at all). Re-derived on the build's base (rev 1, finding 3): makeTrees stops when one is new, so the eval
 * tree serves nothing it should work out again.
 */
const NOT_VALUE_CACHES = new Set([
  'rootRd', // systemGateway: the decision root's R&D, carried to its look-aheads (not a cache)
  'INERT', 'typeFlags', 'factsCache', 'firstIceByOption', 'keywordRes', 'labelRules', 'placesOf', // card text / labels
  'runnerOtherKinds', 'valueLoops', // counters for reports
  'mapGames', 'stateIds', // scopeToGame's and positionSerial's bookkeeping
  'rootIds', // pricing contextKey's object ids for the decision root (not a value)
]);
export function unlistedMaps(dir: string): string[] {
  const out: string[] = [];
  const listed = new Set(CACHES.map(([, n]) => n));
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts'))
        for (const m of read(p).matchAll(/^(?:export )?(?:const|let) (\w+)\s*(?::[^=]+)?=\s*new (?:Weak)?(?:Map|Set)\b/gm)) if (!listed.has(m[1]) && !NOT_VALUE_CACHES.has(m[1])) out.push(`${p.slice(dir.length + 1)}: ${m[1]}`);
    }
  };
  walk(join(dir, 'src/ai'));
  return out;
}
export function evalTree(dir: string) {
  const unlisted = unlistedMaps(dir);
  if (unlisted.length) throw new Error(`eval tree: module maps in src/ai neither in CACHES nor known pure (add each to one list): ${unlisted.join('; ')}`);
  for (const [file, name] of CACHES) {
    const path = join(dir, 'src', file);
    const text = read(path);
    const re = new RegExp(`^((?:export )?(?:const|let) ${name}\\s*(?::[^=]+)?=\\s*)(new (?:Weak)?(?:Map|Set)\\b.*?\\));?\\s*$`, 'm');
    if (!re.test(text)) {
      if (OPTIONAL.has(name)) continue;
      throw new Error(`cache ${name} not found in ${file}`);
    }
    write(path, text.replace(re, (_m, a, b) => `${a}(globalThis as any).__ckNoStore(${b});`));
  }
  applyPatches(
    dir,
    [
      ['ai/handValues.ts', `  const all = (anchor.deckValues ??= new Map());`, `  const all = new Map<string, Map<string, number>>();`],
      ['ai/synergy.ts', `const ownCache = { corp: new WeakMap<GameState, Profile>(), runner: new WeakMap<GameState, Profile>() };`, `const ownCache = { corp: (globalThis as any).__ckNoStore(new WeakMap<GameState, Profile>()), runner: (globalThis as any).__ckNoStore(new WeakMap<GameState, Profile>()) };`],
      ['ai/synergy.ts', `const oppCache = { corp: new WeakMap<GameState, Profile>(), runner: new WeakMap<GameState, Profile>() };`, `const oppCache = { corp: (globalThis as any).__ckNoStore(new WeakMap<GameState, Profile>()), runner: (globalThis as any).__ckNoStore(new WeakMap<GameState, Profile>()) };`],
      ['ai/handValues.ts', `function drawWorth(state: GameState, side: SideCode`, `export function drawWorth(state: GameState, side: SideCode`],
      ...(read(join(dir, 'src/ai/effectValues.ts')).includes('function boardFacts(state: GameState): string {')
        ? ([['ai/effectValues.ts', `function boardFacts(state: GameState): string {`, `export function __bfCodes(state: GameState): string[] {\n  return [...new Set(sideCards(state, 'corp').map(c => c.cardCode))].filter(code => typeof CARDS[code]?.corpTurnDamage === 'function');\n}\nfunction boardFacts(state: GameState): string {`]] as [string, string, string][])
        : []),
      ['ai/evaluate.ts', `function hiddenCardOddsOf(state: GameState)`, `export function hiddenCardOddsOf(state: GameState)`],
    ],
    'eval',
    read,
    write
  );
}

export function makeTrees(root: string, names: string[], withEval: boolean, baseRef = process.env.BASE_REF ?? ''): Record<string, string> {
  if (baseRef && !/^[0-9a-f]{7,40}$/.test(baseRef)) throw new Error(`BASE_REF must be a commit sha: ${baseRef}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const name of ['source', ...names, ...(withEval ? ['eval'] : [])]) {
    const dir = join(root, name.replace(/\./g, '_'));
    dirs[name] = dir;
    mkdirSync(dir, { recursive: true });
    // BASE_REF=<sha>: every tree but the branch's (asIs) on that commit's src (git archive), the branch's on this checkout's
    // The fetch under one lock per machine: the four processes of a CI runner share the checkout's .git, and fetching
    // at once fails on its shallow lock (ai-script 45738945358: 47 of 64 processes stopped there); retried once
    if (baseRef && !ARMS[name]?.asIs) execSync(`flock /tmp/cache-keys-fetch.lock bash -c 'git cat-file -e ${baseRef}^{commit} 2>/dev/null || git fetch -q --depth 1 origin ${baseRef} || (sleep 5; git fetch -q --depth 1 origin ${baseRef})'; git archive ${baseRef} src | tar -x -C ${dir}`, { shell: '/bin/bash' });
    else cpSync('src', join(dir, 'src'), { recursive: true });
    // The batch driver (scripts/lossLog.ts playLogged) for D, played on this tree's own src
    cpSync('scripts', join(dir, 'scripts'), { recursive: true, filter: s => !s.includes('/cache-keys') && !s.includes('node_modules') });
    if (name === 'eval') evalTree(dir);
    else if (name !== 'source') armTree(dir, name, ARMS[name]);
  }
  return dirs;
}
