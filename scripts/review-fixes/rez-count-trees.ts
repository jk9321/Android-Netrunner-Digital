/**
 * Review fixes 2026-11-19, bundle R (rez and rez money), count step (brief:
 * /mnt/project-files/netrunner-ai/review-fixes-1119/rez-count/brief.md): the trees. A tree is a copy of this checkout's
 * src/ with text patches, loaded as its own module graph (as placement-wiring-trees.ts).
 *
 * Every tree gets the RECORD patch, which only writes globals the script reads, plus exports nothing in src calls:
 *  - countedRez tags its exit in `__rzAt` (match, R5, bypassed, free, held, R2, R3, R4, none);
 *  - decideRez is wrapped: the deciding Corp's own call (chooseRez of the planner agent, `__rzTop`) records the window's
 *    answer, and with `__rzMeasure` (an untimed extra ask on the beta tree) measures the window on the board it was given
 *    (the deciding Corp's view, rule 10.2.2a): `__rzMeasureAt` below;
 *  - spendsKept honours `__rzReal` (the Runner's credits after the toll, per world, from the script's playout) in place of
 *    line 98's `credits - toll.need`; unset (always, in an ask) it is line 98 as it is;
 *  - rezModel.ts gets `__rzTrace`, modelRezParts again with the board each branch ends on (the trace T), and evaluate.ts
 *    `__evalParts` (sideStrength's terms, Corp view);
 *  - leoGain and serverImportance are exported (the A measure asks them).
 *
 * The arms (each RECORD plus its own patch; nothing else differs):
 *  - leoFallThrough: runStopper uses LEO when leoGain is above 0, else goes on to the other stoppers; the LEO line in the
 *    loop (rez.ts 244) is gone.
 *  - rdStakeUnseen: stakedServers lists R&D only while agendasUnseen is above 0.
 *  - tollByHold: countedRez's free gate (line 60) returns null only when the rez is no toll by the hold owner either
 *    (serverHold 'thisRun', further false: need with mustRez this ice above need with none); a toll goes on to R2-R4.
 *  - keepPricedCentral: in decideRez, a priced rez of approached ice that does not stop the run (rezStops false) under
 *    R3's or R4's conditions is not made when spendsKept says it spends the kept money.
 *  - keepPriced: the same on every server.
 *  - control: RECORD only (identical to beta; a changed decision is a stop). source: RECORD only; plays the source games.
 * Fires (`__rzFire`, suffix :top inside the deciding Corp's own rez decision, :look elsewhere): leoFall (a stopper
 * returned after LEO said no), rdOut (R&D left out of the staked servers), tollGate:<answer> (the gate let a toll on, and
 * countedRez's answer), keepPriced (a priced rez not made).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['beta', 'control', 'source', 'leoFallThrough', 'rdStakeUnseen', 'tollByHold', 'keepPricedCentral', 'keepPriced'] as const;
export type Arm = (typeof ARMS)[number];
export const RZ_ARMS: Arm[] = ['leoFallThrough', 'rdStakeUnseen', 'tollByHold', 'keepPricedCentral', 'keepPriced'];

type Patch = [file: string, at: string, to: string];

const FIRE = `const __rzF = (k: string) => {
  const G = globalThis as any;
  const f = (G.__rzFire ??= {});
  const kk = k + (G.__rzInTop ? ':top' : ':look');
  f[kk] = (f[kk] ?? 0) + 1;
};
`;

function patches(arm: Arm): Patch[] {
  const LEO = arm === 'leoFallThrough';
  const RD = arm === 'rdStakeUnseen';
  const TOLL = arm === 'tollByHold';
  const KP = arm === 'keepPricedCentral' || arm === 'keepPriced';
  const KPC = arm === 'keepPricedCentral';
  const out: Patch[] = [
    // ---------------------------------------------------------------- countedRez: its exits (record), the toll gate (tollByHold)
    ['ai/corp/rez.ts', `const type = (card: CardInstance) => cardDef(card).type_code;`, `${FIRE}const type = (card: CardInstance) => cardDef(card).type_code;`],
    [
      'ai/corp/rez.ts',
      `export function countedRez(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {
  const run = state.activeRun;`,
      `export function countedRez(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {
  const G = globalThis as any;
  G.__rzTG = false;
  G.__rzAt = 'none';
  const r = __countedRez0(state, ice);
  if (G.__rzTG) __rzF('tollGate:' + r);
  return r;
}

function __countedRez0(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {
  const G = globalThis as any;
  const run = state.activeRun;`,
    ],
    ['ai/corp/rez.ts', `  if (atMatch) return atMatch;`, `  if (atMatch) return ((G.__rzAt = 'match'), atMatch);`],
    ['ai/corp/rez.ts', `  if (run.server === 'archives' && !archivesWantsIce(state)) return 'pass';`, `  if (run.server === 'archives' && !archivesWantsIce(state)) return ((G.__rzAt = 'R5'), 'pass');`],
    ['ai/corp/rez.ts', `  if (runBypassed(view, up)) return rezEffectOf(cardDef(ice).code) ? null : 'pass';`, `  if (runBypassed(view, up)) return ((G.__rzAt = 'bypassed'), rezEffectOf(cardDef(ice).code) ? null : 'pass');`],
    [
      'ai/corp/rez.ts',
      `  if (need === 0 && !countNeeds(state, ice)) return null;`,
      `  if (need === 0 && !countNeeds(state, ice)) {
    if (!(${TOLL} && __tollByHold(state, ice))) return ((G.__rzAt = 'free'), null);
    G.__rzTG = true;
  }`,
    ],
    ['ai/corp/rez.ts', `  if (serverHold(state, run.server, { when: 'thisRun', mustRez: [], further: false }).holds) return null;`, `  if (serverHold(state, run.server, { when: 'thisRun', mustRez: [], further: false }).holds) return ((G.__rzAt = 'held'), null);`],
    ['ai/corp/rez.ts', `  if (server.root.some(isAgenda) && rezStops(state, ice, true)) return 'rez';`, `  if (server.root.some(isAgenda) && rezStops(state, ice, true)) return ((G.__rzAt = 'R2'), 'rez');`],
    ['ai/corp/rez.ts', `  if (run.server === 'hq' && hqAgendas > 0) return stops || !spendsKept(state, ice) ? 'rez' : 'pass';`, `  if (run.server === 'hq' && hqAgendas > 0) return ((G.__rzAt = stops ? 'R3s' : 'R3t'), stops || !spendsKept(state, ice) ? 'rez' : 'pass');`],
    [
      'ai/corp/rez.ts',
      `  if (run.server === 'rd' && hqAgendas === 0 && agendasUnseen(state) > 0) return stops || !spendsKept(state, ice) ? 'rez' : 'pass';
  return null;
}`,
      `  if (run.server === 'rd' && hqAgendas === 0 && agendasUnseen(state) > 0) return ((G.__rzAt = stops ? 'R4s' : 'R4t'), stops || !spendsKept(state, ice) ? 'rez' : 'pass');
  return ((G.__rzAt = 'none'), null);
}

/** REZ-COUNT (tollByHold): the rez is a toll by the hold owner ('thisRun', further false): it raises the Runner's need. */
export function __tollByHold(state: GameState, ice: CardInstance): boolean {
  const run = state.activeRun!;
  const w = serverHold(state, run.server, { when: 'thisRun', mustRez: [ice.instanceId], further: false });
  const n = serverHold(state, run.server, { when: 'thisRun', mustRez: [], further: false });
  return w.need > n.need;
}`,
    ],
    // ---------------------------------------------------------------- spendsKept: the real credits, when the script hands them
    [
      'ai/corp/rez.ts',
      `    const runnerCredits = toll.holds ? state.runner.credits : Math.max(0, state.runner.credits - toll.need);`,
      `    const __o = (globalThis as any).__rzReal?.[mustRez.length ? 'rez' : 'pass'];
    const runnerCredits = __o !== undefined ? __o : toll.holds ? state.runner.credits : Math.max(0, state.runner.credits - toll.need);`,
    ],
    // ---------------------------------------------------------------- decideRez: the deciding call (record), the measure, keepPriced
    [
      'ai/corp/rez.ts',
      `export function decideRez(state: GameState, cards: CardInstance[], synergy: boolean): GameAction | null {
  const run = state.activeRun;`,
      `export function decideRez(state: GameState, cards: CardInstance[], synergy: boolean): GameAction | null {
  const G = globalThis as any;
  const __top = !!G.__rzTop;
  G.__rzTop = false;
  const __was = G.__rzInTop;
  G.__rzInTop = __top;
  try {
    const a = __decideRez(state, cards, synergy);
    if (__top) {
      G.__rzDec = { at: G.__rzLastAt ?? null, gain: G.__rzLastGain ?? null };
      if (G.__rzMeasure) {
        G.__rzView = state;
        G.__rzM = __rzMeasureAt(state, cards, synergy);
      }
    }
    return a;
  } finally {
    G.__rzInTop = __was;
  }
}

function __decideRez(state: GameState, cards: CardInstance[], synergy: boolean): GameAction | null {
  const G = globalThis as any;
  if (G.__rzInTop) {
    G.__rzLastAt = null;
    G.__rzLastGain = null;
  }
  const run = state.activeRun;`,
    ],
    [
      'ai/corp/rez.ts',
      `      const call = countedRez(state, card);
      if (call === 'rez')`,
      `      const call = countedRez(state, card);
      if (G.__rzInTop) G.__rzLastAt = G.__rzAt;
      if (call === 'rez')`,
    ],
    [
      'ai/corp/rez.ts',
      `      const gain = modelRezGain(state, card, synergy);
      if (!(gain > 0)) continue;`,
      `      const gain = modelRezGain(state, card, synergy);
      if (G.__rzInTop) G.__rzLastGain = gain;
      if (!(gain > 0)) continue;
      if (${KP} && run.phase === 'approach_ice' && __keepScope(state, ${KPC}) && !rezStops(state, card, false) && spendsKept(state, card)) {
        __rzF('keepPriced');
        continue;
      }`,
    ],
    // ---------------------------------------------------------------- exports for the measures
    ['ai/corp/rez.ts', `function leoGain(state: GameState, action: GameAction, synergy: boolean): number {`, `export function leoGain(state: GameState, action: GameAction, synergy: boolean): number {`],
    ['ai/corp/rez.ts', `function serverImportance(state: GameState, server: ServerState | undefined, aware = false): number {`, `export function serverImportance(state: GameState, server: ServerState | undefined, aware = false): number {`],
    ['ai/corp/rez.ts', `import { modelRezGain, runBypassed } from '../rezModel';`, `import { __rzTrace, modelRezGain, runBypassed } from '../rezModel';`],
    [
      'ai/corp/rez.ts',
      `/** An asset whose whole worth is what it does when rezzed (Spin Doctor), not a money asset that pays out. */`,
      `/** REZ-COUNT: R3's or R4's conditions (keepPricedCentral), or any server (keepPriced). */
function __keepScope(state: GameState, central: boolean): boolean {
  if (!central) return true;
  const run = state.activeRun!;
  const hqAgendas = state.corp.hq.filter(c => type(c) === 'agenda').length;
  return (run.server === 'hq' && hqAgendas > 0) || (run.server === 'rd' && hqAgendas === 0 && agendasUnseen(state) > 0);
}

/** REZ-COUNT (measure): the board's B numbers (agendasUnseen and R&D's rez money), on the board given. */
export function __rzBoard(state: GameState) {
  const m = rezMoney(state);
  return { unseen: agendasUnseen(state), rd: m.byServer.rd ?? null, keep: m.keep, byServer: m.byServer, unholdable: m.unholdable };
}

/** REZ-COUNT (measure): spendsKept with the Runner's credits after the toll as the script played them (spentApart). */
export function __rzSpent(state: GameState, iceId: string, real: { rez?: number; pass?: number }): boolean {
  const G = globalThis as any;
  const ice = state.corp.servers[state.activeRun!.server].ice.find(c => c.instanceId === iceId)!;
  G.__rzReal = real;
  try {
    return spendsKept(state, ice);
  } finally {
    G.__rzReal = undefined;
  }
}

const __labels = (ice: CardInstance) => (iceScript(ice)?.subroutines ?? []).map(s => s.label);

/** REZ-COUNT (measure): one rez window on the deciding Corp's board (classes A, B, C1, C2 and the trace T). */
export function __rzMeasureAt(state: GameState, cards: CardInstance[], synergy: boolean): any {
  const G = globalThis as any;
  const run = state.activeRun!;
  const server = state.corp.servers[run.server];
  const isAg = (c: CardInstance) => type(c) === 'agenda';
  const hqAgendas = state.corp.hq.filter(isAg).length;
  const unseen = agendasUnseen(state);
  const r34 = (run.server === 'hq' && hqAgendas > 0) || (run.server === 'rd' && hqAgendas === 0 && unseen > 0);
  const out: any = {
    phase: run.phase,
    server: run.server,
    sk: server?.isRemote ? (server.root.some(isAg) ? 'remoteAgenda' : 'remote') : run.server,
    r34,
    hqAgendas,
    unseen,
    cr: state.corp.credits,
    rc: state.runner.credits,
    rk: state.runner.clicks,
    pos: run.icePosition,
    b: __rzBoard(state),
  };
  if (run.phase === 'approach_ice' && run.icePosition !== null) {
    out.ice = [];
    for (const ice of cards) {
      if (type(ice) !== 'ice') continue;
      const call = countedRez(state, ice);
      const at = G.__rzAt;
      const up = { ...ice, isRezzed: true };
      const view: GameState = { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [server.id]: { ...server, ice: server.ice.map(c => (c.instanceId === ice.instanceId ? up : c)) } } } };
      const w = serverHold(state, run.server, { when: 'thisRun', mustRez: [ice.instanceId], further: false });
      const n = serverHold(state, run.server, { when: 'thisRun', mustRez: [], further: false });
      const handed = (h: { holds: boolean; need: number }) => (h.holds ? state.runner.credits : Math.max(0, state.runner.credits - h.need));
      const inner = server.ice.slice(0, run.icePosition);
      const row: any = {
        id: ice.instanceId,
        code: ice.cardCode,
        title: cardDef(ice).title,
        cost: rezCost(state, ice),
        call,
        at,
        need: iceCreditNeed(view, up),
        w: { holds: w.holds, need: w.need, rezCost: w.rezCost },
        n: { holds: n.holds, need: n.need, rezCost: n.rezCost },
        handedRez: handed(w),
        handedPass: handed(n),
        tollHold: w.need > n.need,
        stops: rezStops(state, ice, false),
        subs: __labels(ice),
        innerRezzed: inner.map((c, i) => (c.isRezzed ? { i, code: c.cardCode, title: cardDef(c).title, subs: __labels(c) } : null)).filter(Boolean),
        innerUnrezzed: inner.filter(c => !c.isRezzed).length,
      };
      row.spends = spendsKept(state, ice);
      if (call === null) {
        row.gain = modelRezGain(state, ice, synergy);
        if (row.gain > 0) {
          row.trace = __rzTrace(state, ice, synergy);
          // What the value model reads for rez money after the rez (next turn's keep: boardNeed, corpPorts) against what
          // the rest of this turn needs (rezMoney with restOfTurn, the run's server out, as spendsKept reads it)
          const after = simulate(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.instanceId });
          if (after) {
            row.keeps = {
              crAfter: after.corp.credits,
              nextTurn: rezMoney(after).keep,
              nextTurnByServer: rezMoney(after).byServer,
              restRez: rezMoney(after, { restOfTurn: { runnerCredits: row.handedRez }, except: run.server }).keep,
              restRezByServer: rezMoney(after, { restOfTurn: { runnerCredits: row.handedRez }, except: run.server }).byServer,
              restPass: rezMoney(state, { restOfTurn: { runnerCredits: row.handedPass }, except: run.server }).keep,
              restPassByServer: rezMoney(state, { restOfTurn: { runnerCredits: row.handedPass }, except: run.server }).byServer,
            };
          }
        }
      }
      out.ice.push(row);
    }
  } else if (run.phase === 'approach_server') {
    const legal = getLegalActions(state, 'corp');
    const codeOf = (a: GameAction) => (a.type === 'USE_ABILITY' ? findCardAnywhere(state, a.cardInstanceId)?.cardCode : undefined);
    const leo = legal.find(a => codeOf(a) === '35035');
    const importance = serverImportance(state, server, synergy);
    const archivesAgenda = state.corp.archives.faceDown.some(c => type(c) === 'agenda');
    out.importance = importance;
    out.leo = !!leo;
    if (leo) out.leoGain = leoGain(state, leo, synergy);
    const ok = (code: string | undefined) =>
      code === '35048' ? !archivesAgenda && run.server !== 'archives' : code === '36045' ? true : code === '36035' ? !!perfectRecallTarget(state) : code === '36058' ? importance >= 7 : false;
    out.stoppers = [...new Set(legal.map(codeOf).filter((c): c is string => !!c && ['35048', '36045', '36035', '36058'].includes(c)))].map(c => ({ code: c, usable: ok(c) }));
    out.rootUnrezzed = (server?.root ?? []).filter(c => !c.isRezzed).map(c => type(c));
  }
  return out;
}

/** An asset whose whole worth is what it does when rezzed (Spin Doctor), not a money asset that pays out. */`,
    ],
    // ---------------------------------------------------------------- chooseRez: the deciding call
    [
      'ai/corpAI.ts',
      `      const action = decideRez(view, cards, this.synergy);`,
      `      (globalThis as any).__rzTop = this.planner;
      const action = decideRez(view, cards, this.synergy);`,
    ],
    // ---------------------------------------------------------------- rezMoney: R&D staked (rdStakeUnseen)
    ['ai/corp/rezMoney.ts', `import { memo } from '../valueModel';`, `import { memo } from '../valueModel';\nimport { agendasUnseen as __unseen } from './pools';\n${FIRE}`],
    [
      'ai/corp/rezMoney.ts',
      `  const out = ['rd'];`,
      `  const out = ${RD} && __unseen(state) <= 0 ? (__rzF('rdOut'), [] as string[]) : ['rd'];`,
    ],
    // ---------------------------------------------------------------- rezModel: the trace T
    [
      'ai/rezModel.ts',
      `const ended = (state: GameState): GameState => ({ ...state, activeRun: null });`,
      `const ended = (state: GameState): GameState => ({ ...state, activeRun: null });

/** REZ-COUNT (trace T): a branch's value with the board it ends on (the leaf restOfRun's max picked), and the toll extra. */
interface __VB {
  v: number;
  b: GameState;
  x: number;
  leaf: string;
  loss: number;
  rezzedOnWay: string[];
}
function __rest(state: GameState, position: number, synergy: boolean): __VB {
  const server = state.activeRun ? state.corp.servers[state.activeRun.server] : undefined;
  if (!server || position < 0) return __gotIn(state, state.runner.credits);
  const ice = server.ice[position];
  if (!ice) return __gotIn(state, state.runner.credits);
  if (!ice.isRezzed) {
    const pass = __rest(state, position - 1, synergy);
    const cost = rezCost(state, ice);
    if (cost > state.corp.credits) return pass;
    const rezzed = { ...ice, isRezzed: true };
    const after: GameState = {
      ...state,
      corp: { ...state.corp, credits: state.corp.credits - cost, servers: { ...state.corp.servers, [server.id]: { ...server, ice: server.ice.map((c, i) => (i === position ? rezzed : c)) } } },
    };
    const r = __atR(after, rezzed, position, synergy);
    return r.v > pass.v ? { ...r, rezzedOnWay: [ice.instanceId, ...r.rezzedOnWay] } : pass;
  }
  return __atR(state, ice, position, synergy);
}
function __atR(state: GameState, ice: CardInstance, position: number, synergy: boolean): __VB {
  const need = iceCreditNeed(state, ice);
  if (need === BLOCK || need > state.runner.credits) {
    const b = ended(state);
    return { v: evaluate(b, 'corp'), b, x: 0, leaf: 'stopped', loss: 0, rezzedOnWay: [] };
  }
  return __through(state, ice, position, synergy);
}
function __through(state: GameState, ice: CardInstance, position: number, synergy: boolean): __VB {
  const need = iceCreditNeed(state, ice);
  const toll = Math.min(iceCost(state, ice), iceStop(state));
  const paid = Math.min(Math.max(toll, need), Math.max(0, state.runner.credits));
  const poorer: GameState = { ...state, runner: { ...state.runner, credits: state.runner.credits - paid } };
  const r = __rest(poorer, position - 1, synergy);
  const x = Math.max(0, toll - paid);
  return { ...r, v: r.v + x, x: r.x + x };
}
function __gotIn(state: GameState, spare: number): __VB {
  const server = state.activeRun ? state.corp.servers[state.activeRun.server] : undefined;
  if (!server) {
    const b = ended(state);
    return { v: evaluate(b, 'corp'), b, x: 0, leaf: 'gotIn', loss: 0, rezzedOnWay: [] };
  }
  const agendas = server.root.filter(c => cardDef(c).type_code === 'agenda');
  const trashable = server.root
    .filter(c => cardDef(c).type_code !== 'agenda' && typeof cardDef(c).trash_cost === 'number')
    .sort((a, b) => (cardDef(a).trash_cost ?? 0) - (cardDef(b).trash_cost ?? 0));
  const trashed: CardInstance[] = [];
  let money = Math.max(0, spare);
  for (const card of trashable) {
    const cost = cardDef(card).trash_cost ?? 0;
    if (cost > money) break;
    money -= cost;
    trashed.push(card);
  }
  const gone = new Set([...agendas, ...trashed].map(c => c.instanceId));
  const points = agendas.reduce((n, c) => n + (cardDef(c).agenda_points ?? 0), 0);
  const after: GameState = {
    ...state,
    corp: {
      ...state.corp,
      servers: { ...state.corp.servers, [server.id]: { ...server, root: server.root.filter(c => !gone.has(c.instanceId)) } },
      archives: { ...state.corp.archives, faceUp: [...state.corp.archives.faceUp, ...trashed.map(c => ({ ...c, isRezzed: false }))] },
    },
    runner: {
      ...state.runner,
      credits: state.runner.credits - (Math.max(0, spare) - money),
      score: state.runner.score + points,
      scoreArea: [...state.runner.scoreArea, ...agendas],
    },
  };
  const b = ended(after);
  const loss = runLoss(after);
  return { v: evaluate(b, 'corp') - loss, b, x: 0, leaf: 'gotIn', loss, rezzedOnWay: [] };
}

/** REZ-COUNT (trace T): modelRezParts with the boards, each branch's evaluate split into sideStrength's terms. */
export function __rzTrace(state: GameState, ice: CardInstance, synergy: boolean): any {
  const run = state.activeRun;
  if (!run || run.icePosition === null) return null;
  let after = simulate(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.instanceId });
  for (let i = 0; after && i < 3 && activePrompt(after)?.side === 'corp'; i++) after = simulate(after, answerPrompt(after, 'corp', undefined, synergy));
  if (!after?.activeRun) return null;
  const rezzed = after.corp.servers[run.server]?.ice.find(c => c.instanceId === ice.instanceId);
  if (!rezzed?.isRezzed) return null;
  const pass = __rest(state, run.icePosition - 1, synergy);
  let rez: __VB;
  let stops = false;
  if (runBypassed(after, rezzed)) rez = __rest(after, run.icePosition - 1, synergy);
  else {
    const need = iceCreditNeed(after, rezzed);
    stops = need === BLOCK || need > after.runner.credits;
    if (stops) {
      const b = ended(after);
      rez = { v: evaluate(b, 'corp'), b, x: 0, leaf: 'stopped', loss: 0, rezzedOnWay: [] };
    } else rez = __through(after, rezzed, run.icePosition, synergy);
  }
  const side = (x: __VB) => ({ v: x.v, leaf: x.leaf, x: x.x, loss: x.loss, rezzedOnWay: x.rezzedOnWay, cc: x.b.corp.credits, rc: x.b.runner.credits, rs: x.b.runner.score, parts: __evalParts(x.b) });
  return { gain: rez.v - pass.v, stops, toll: { iceCost: iceCost(after, rezzed), iceStop: iceStop(after), need: iceCreditNeed(after, rezzed) }, pass: side(pass), rez: side(rez) };
}`,
    ],
    ['ai/rezModel.ts', `import { evaluate } from './evaluate';`, `import { __evalParts, evaluate } from './evaluate';`],
    // ---------------------------------------------------------------- evaluate: sideStrength's terms (Corp view)
    [
      'ai/evaluate.ts',
      `/** How good the position is for \`side\` (mine minus theirs; a win is decisive). */`,
      `/** REZ-COUNT (trace T): sideStrength's terms on this board, Corp view (corp terms less the Runner's), and the Corp's credit need. */
export function __evalParts(state: GameState): Record<string, number> {
  const corp = state.corp;
  const runner = state.runner;
  return {
    cCredit: sideCreditValue(state, 'corp', 'corp'),
    cNeed: creditNeed(state, 'corp'),
    cBoardNeed: boardNeed(state, 'corp'),
    cHand: handAndClicks(state, 'corp', 'corp'),
    cPoints: pointValue(corp.score, KNOBS.corpPoints),
    cBoard: corpBoardValue(state, 'corp'),
    cTags: tagsWorth(state, 'corp'),
    cCounters: corp.scoreArea.reduce((n, a) => n + countersWorth(state, a, 'agenda'), 0) + countersWorth(state, corp.identity, 'power'),
    rCredit: -sideCreditValue(state, 'runner', 'corp'),
    rHand: -handAndClicks(state, 'runner', 'corp'),
    rPoints: -pointValue(runner.score),
    rTags: tagsWorth(state, 'corp'),
    rCore: coreSlotWorth(state) * runner.coreDamage,
    rClock: flatlineWorth(state) * flatlineOdds(state, lifeGrip(state), true) + lifeCards(runner.grip.length),
    rRig: -runnerRigValue(state),
    total: state.winner ? NaN : sideStrength(state, 'corp', 'corp') - sideStrength(state, 'runner', 'corp'),
  };
}

/** How good the position is for \`side\` (mine minus theirs; a win is decisive). */`,
    ],
    [
      'ai/evaluate.ts',
      `import { CLICK, KNOBS, RATES, cardRate, flatlineWorth, guardLoop, handFilter, logValue, mean, memo, payoutSlide, pointValue, reachCard, setRunnerAgendaOdds, sideCreditValue } from './valueModel';`,
      `import { CLICK, KNOBS, RATES, boardNeed, cardRate, creditNeed, flatlineWorth, guardLoop, handFilter, logValue, mean, memo, payoutSlide, pointValue, reachCard, setRunnerAgendaOdds, sideCreditValue } from './valueModel';`,
    ],
  ];
  // ---------------------------------------------------------------- runStopper (leoFallThrough only)
  if (LEO)
    out.push(
      ['ai/corp/rez.ts', `  if (leo) return leoGain(state, leo, synergy) > 0 ? leo : null;`, `  if (leo && leoGain(state, leo, synergy) > 0) return leo;\n  const __r = __stopperRest(state, importance);\n  if (__r && leo) __rzF('leoFall');\n  return __r;\n}\n\nfunction __stopperRest(state: GameState, importance: number): GameAction | null {`],
      ['ai/corp/rez.ts', `    if (code === '35035') return action; // LEO: trash a bioroid, end the run\n`, ``],
    );
  return out;
}

/** Copies this checkout's src into root/<arm>/src with the arm's patches; each patch must match exactly once. */
export function makeTrees(root: string, arms: readonly Arm[], from = 'src'): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of arms) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync(from, join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of patches(arm)) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`tree ${arm}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(
        path,
        text.replace(at, () => to),
      );
    }
    dirs[arm] = dir;
  }
  return dirs;
}

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  rez: any;
  view: (s: any) => any;
  inCorp: <T>(s: any, f: () => T) => T;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/corp/rez.ts', 'ai/turnPlanner.ts', 'ai/synergy.ts']) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, rez, tp, syn] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    rez,
    view: tp.corpDecisionView,
    inCorp: (s, f) => syn.asSide('corp', () => (hv.decisionContext(s, 'corp'), f())),
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
