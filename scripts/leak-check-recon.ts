/**
 * The leak fuzzer's chunk 2 checks (multiplayer phase 1): the GameState the
 * screen draws (stateFromView) and the seat's legality (src/ui/table.ts).
 * Run with `recon` on (scripts/leak-fuzz.ts --recon); the chunk 1 checks stay
 * as they were.
 *
 * 1. The reconstruction holds nothing the view doesn't: no hidden card's
 *    code or title, no card from a hidden zone with a face (but those the
 *    viewer's prompts show), no engine internals.
 * 2. The display helpers the table runs on it don't throw.
 * 3. The seat agrees with the engine on the real state for every action the
 *    screen builds (its buttons), and every own-side probe on a legal action
 *    says legal (disagreements are counted, not failed: see stats).
 */
import {
  CardInstance,
  GameAction,
  GameState,
  GameView,
  SideCode,
  ViewIds,
  actingSide,
  cardDef,
  findCardAnywhere,
  fromEngineAction,
  getLegalActions,
  iceStrength,
  iceSubtypes,
  installedIce,
  isHidden,
  isLegalAction,
  knownInHand,
  knownInRd,
  rezCostOf,
  stateFromView,
  toEngineAction,
  trashableFirst,
} from '../src/core';
import { playCost } from '../src/core/engine/actions/play';
import { runnerInstallCost } from '../src/core/engine/actions/install';
import { liveCardModifiers, liveValues, runCreditPools } from '../src/ui/liveValues';
import { cardFates } from '../src/ui/cardFates';
import { cardPositionLabel } from '../src/ui/cardLabels';
import { isProbeAction, seatCan } from '../src/ui/table';
import { cardObjects, escape, findPaths, titleOf, type LeakChecker } from './leak-check';

export interface ReconStats {
  /** Own-side probe answers checked on legal actions. */
  probes: number;
  /** Legal actions the probe on the reconstruction called illegal (target: none). */
  probeDisagreements: string[];
  /** Screen-built actions compared with the engine. */
  uiShapes: number;
}

interface Input {
  state: GameState;
  side: SideCode;
  view: GameView;
  ids: ViewIds;
  hiddenIds: Set<string>;
  leakedCodes: Set<string>;
  step: number;
  prev?: GameState;
}

const allCards = (s: GameState): CardInstance[] => {
  const out: CardInstance[] = [];
  const add = (c: CardInstance) => {
    out.push(c);
    c.hostedCards?.forEach(add);
  };
  const { corp, runner } = s;
  [corp.identity, runner.identity].forEach(add);
  for (const srv of Object.values(corp.servers)) [...srv.ice, ...srv.root].forEach(add);
  for (const l of [corp.hq, corp.rd, corp.archives.faceUp, corp.archives.faceDown, corp.scoreArea, runner.grip, runner.stack, runner.heap, runner.rig.programs, runner.rig.hardware, runner.rig.resources, runner.scoreArea, s.removedFromGame]) l.forEach(add);
  return out;
};

/** Actions the screen builds itself (buttons that ask `can`), in the viewer's ids. */
function screenActions(recon: GameState, side: SideCode): GameAction[] {
  const out: GameAction[] = [];
  const p = side;
  out.push({ type: 'GAIN_CREDIT', player: p }, { type: 'DRAW_CARD', player: p }, { type: 'END_TURN', player: p });
  if (side === 'corp') {
    out.push({ type: 'PURGE_VIRUS', player: 'corp' }, { type: 'START_TURN', player: 'corp' });
    for (const srv of Object.values(recon.corp.servers)) {
      for (const c of [...srv.ice, ...srv.root]) {
        out.push({ type: 'REZ_CARD', player: 'corp', cardInstanceId: c.instanceId });
        out.push({ type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: c.instanceId, serverId: srv.id });
        out.push({ type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: c.instanceId });
      }
    }
    for (const c of recon.corp.hq) {
      out.push({ type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: c.instanceId });
      for (const srv of Object.values(recon.corp.servers)) {
        const trash = trashableFirst(recon, c, srv.id).map(x => x.instanceId);
        if (trash.length) out.push({ type: 'INSTALL_CARD', player: 'corp', cardInstanceId: c.instanceId, targetServerId: srv.id, trashFirst: trash });
      }
    }
  } else {
    out.push({ type: 'REMOVE_TAG', player: 'runner' }, { type: 'JACK_OUT', player: 'runner' }, { type: 'CONTINUE_RUN', player: 'runner' });
    const ice = installedIce(recon);
    for (const c of recon.runner.grip) {
      out.push({ type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: c.instanceId });
      out.push({ type: 'INSTALL_CARD', player: 'runner', cardInstanceId: c.instanceId, hostInstanceId: ice[0]?.instanceId });
      const trash = trashableFirst(recon, c, null).map(x => x.instanceId);
      if (trash.length) out.push({ type: 'INSTALL_CARD', player: 'runner', cardInstanceId: c.instanceId, trashFirst: trash, hostInstanceId: undefined });
    }
  }
  const prompt = recon.pendingPrompts[0];
  if (prompt?.side === side && prompt.kind === 'access_trash') {
    out.push({ type: 'RESOLVE_PROMPT', player: side, promptId: prompt.id, choice: { kind: 'access_trash', trash: true } });
  }
  return out;
}

/** Runs the chunk 2 checks for one side at one step; returns the reconstruction (the next step's `prev`). */
export function reconChecks(checker: LeakChecker, { state, side, view, ids, hiddenIds, leakedCodes, step, prev }: Input): GameState {
  const fail = (check: 'recon' | 'seat' | 'crash' | 'hidden-card' | 'hidden-code' | 'hidden-title' | 'internal', detail: string, path?: string) =>
    checker.fail(step, side, check, `[recon] ${detail}`, path);
  let recon: GameState;
  try {
    recon = stateFromView(view);
  } catch (e) {
    fail('crash', `stateFromView: ${e}`);
    return prev ?? state;
  }
  const json = JSON.stringify(recon);

  // 1. Nothing the view doesn't hold
  for (const bad of ['inst-', '"secret"', '"rdNotes"', '"bareAssets"', '"whenSettled"']) {
    if (json.includes(bad)) fail('internal', bad, findPaths(recon, s => s.includes(bad.replace(/"/g, '')))[0]);
  }
  if (recon.rng.seed !== 0 || recon.rng.state !== 0 || recon.nextInstanceId !== 0) fail('internal', 'rng or counters are not the dummies');
  const shownByPrompt = new Set(view.pendingPrompts.flatMap(p => p.cards.map(c => c.instanceId)));
  for (const [path, obj] of cardObjects(recon)) {
    if (path.startsWith('$.pendingPrompts') || /^(hidden|known)-/.test(obj.instanceId) || isHidden(obj as CardInstance)) continue;
    const real = ids.real[obj.instanceId];
    if (real === undefined) fail('recon', `${obj.instanceId} not in the id map`, path);
    else if (hiddenIds.has(real) && !shownByPrompt.has(obj.instanceId)) fail('hidden-card', `${obj.cardCode} ${titleOf(obj.cardCode!)} is in a zone hidden from ${side}`, path);
  }
  for (const code of leakedCodes) {
    if (json.includes(`"${code}"`)) fail('hidden-code', `${code} ${titleOf(code)}`, findPaths(recon, s => s === code)[0]);
    const title = titleOf(code);
    if (title.length >= 4 && json.includes(title)) {
      const re = new RegExp(`(^|[^\\w])${escape(title)}($|[^\\w])`);
      const paths = findPaths(recon, s => re.test(s));
      if (paths.length) fail('hidden-title', `${code} ${title}`, paths[0]);
    }
  }
  // Public numbers are exact
  for (const [k, a, b] of [
    ['hq', recon.corp.hq.length, state.corp.hq.length],
    ['rd', recon.corp.rd.length, state.corp.rd.length],
    ['grip', recon.runner.grip.length, state.runner.grip.length],
    ['stack', recon.runner.stack.length, state.runner.stack.length],
    ['archives', recon.corp.archives.faceDown.length, state.corp.archives.faceDown.length],
    ['corp credits', recon.corp.credits, state.corp.credits],
    ['runner credits', recon.runner.credits, state.runner.credits],
  ] as [string, number, number][]) {
    if (a !== b) fail('recon', `${k}: ${a} on screen, ${b} in the game`);
  }

  // 2. The display helpers don't throw on placeholders
  const run = (name: string, fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      fail('crash', `${name}: ${String(e).slice(0, 160)}`);
    }
  };
  run('runCreditPools', () => runCreditPools(recon));
  run('knownInHand', () => [knownInHand(recon, 'corp'), knownInHand(recon, 'runner'), knownInRd(recon)]);
  for (const c of allCards(recon)) {
    run(`liveValues ${c.cardCode}`, () => liveValues(recon, c));
    run(`liveCardModifiers ${c.cardCode}`, () => liveCardModifiers(recon, c));
    run(`cardPositionLabel ${c.cardCode}`, () => cardPositionLabel(recon, c));
    run(`cardDef ${c.cardCode}`, () => cardDef(c));
  }
  for (const srv of Object.values(recon.corp.servers)) {
    for (const ice of srv.ice) {
      run('iceStrength', () => iceStrength(recon, ice));
      run('iceSubtypes', () => iceSubtypes(ice, recon));
    }
    for (const c of [...srv.ice, ...srv.root]) run('rezCostOf', () => rezCostOf(recon, c));
  }
  const hand = side === 'corp' ? recon.corp.hq : recon.runner.grip;
  for (const c of hand) {
    run('playCost', () => playCost(recon, c));
    if (side === 'runner') run('runnerInstallCost', () => runnerInstallCost(recon, c));
    run('trashableFirst', () => (side === 'corp' ? Object.keys(recon.corp.servers).map(id => trashableFirst(recon, c, id)) : trashableFirst(recon, c, null)));
  }
  for (const p of recon.pendingPrompts) for (const id of JSON.stringify(p).match(/\b[cr]\d+\b/g) ?? []) run('findCardAnywhere', () => findCardAnywhere(recon, id));
  if (prev) run('cardFates', () => cardFates(prev, recon));

  // 3. The seat against the engine (the acting side only: the others have no legal actions)
  if (actingSide(state) === side && !state.winner) {
    const legal = getLegalActions(state, side).flatMap(a => {
      const mine = fromEngineAction(a, ids);
      return mine ? [mine] : [];
    });
    const stats = checker.stats;
    for (const a of legal) {
      if (!isProbeAction(a)) continue;
      stats.probes++;
      let ok = false;
      try {
        ok = isLegalAction(recon, a);
      } catch {
        ok = false;
      }
      if (!ok && stats.probeDisagreements.length < 200) stats.probeDisagreements.push(`${checker.seedOf()} step ${step} ${JSON.stringify(a)}`);
    }
    for (const a of screenActions(recon, side)) {
      stats.uiShapes++;
      let real = false;
      try {
        real = isLegalAction(state, toEngineAction(a, ids));
      } catch {
        real = false;
      }
      const seat = seatCan(legal, side, recon, a);
      if (seat !== real) fail('seat', `${JSON.stringify(a)}: seat says ${seat}, engine ${real}`);
    }
  }
  return recon;
}
