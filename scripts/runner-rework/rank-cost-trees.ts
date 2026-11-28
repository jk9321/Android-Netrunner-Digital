/**
 * R0 count 2 of the Runner rework: what the Runner's ranking costs, and what it depends on. The trees.
 * Brief: /mnt/project-files/netrunner-ai/runner-rework/r0/count2-rank-cost/brief.md (shared rules: ../standing-rules.md).
 * Scripts only: nothing under src/ changes. A tree is a copy of this checkout's src/ (beta) with text patches, loaded as
 * its own module graph (as scripts/stage-vc/breaker-once-trees.ts); every patch must match exactly once.
 *
 * Every tree but `source` gets RECORD, which only writes globals the script reads (globalThis.__rc):
 *  - `reply`: depth of runnerReply (the Corp's look-ahead playing the Runner's next turn);
 *  - per reply sample, a cheap key of the board it starts from and the sequence of actions played in it (each action's
 *    JSON, its side from `player`), so the samples of two trees can be laid side by side and their first differing pick
 *    found (count-note: "per reply step");
 *  - time in the Runner agent (`chooseAction`) and in its ranking (`rankMainActions`) inside the reply; the ranking's
 *    time outside a reply (the deciding Runner and its own playouts) apart.
 * RECORD also exports handValues' drawWorth and adds imports to runnerAI.ts (unused on beta and control).
 *
 * Ported to beta 0b9d44a by R-C1 Part 0 (tracker R-26): the anchors moved with B1 to B4c (handValues drawWorth's `when`,
 * runnerAI's imports, the terms named in runner/terms.ts RUNNER_TERMS, answerPrompt's chain position, the helpers inserted
 * before READ_WRITE_SHARE); check with scripts/runner-rework/rc1-part0/patch-check.ts.
 *
 * Arms (a set of features; each feature is the whole rule, no number added):
 *  OPEN    `promptOpen`: the ranking does not follow a candidate's prompts (runnerAI.ts scoreMain, the 3-step loop): the
 *          candidate is scored on the board with its prompt open. The prompt is answered when the move is played, as today.
 *  OWNER   `promptOwner`: as OPEN, and a candidate whose prompt the loop would have followed (the Runner's own, or the
 *          Corp's under synergy) and that plays a card from the grip is scored by its hand owner's output: playedWorth
 *          less heldWorth (handValues.ts) on the Runner's view. A candidate with no grip card (an installed card's
 *          ability) is scored as OPEN.
 *  DECKROOT `runnerDeckRoot`: atDeckRoot (handValues.ts) also serves the Runner's stack: in a frozen look-ahead whose
 *          decision root is this board's game (the Corp's reply, anchor side corp; the Runner's own playouts, anchor side
 *          runner). The Corp's side is unchanged.
 *  PLAIN   `plainOwners`: installs (from the grip, no trash-first, no host), draws and credits are scored with no
 *          simulated play: install = playedWorth - heldWorth; draw = drawWorth; credit = sideCreditValue(credits + 1) -
 *          sideCreditValue(credits) (the Runner's own view). The draw bonuses, the saving-up bonus (credits gained:
 *          install -runnerInstallCost, credit +1, draw 0) are applied as they are; the free-action cut does not apply
 *          (each of the three takes a click, rules 1.? basic actions). Everything else as beta.
 *  CLICK   `plainOwnersClick` (PLAIN with CLICK): each of the three less the click owner clickPrice(view, runner, runner);
 *          the install adds back the flat CLICK playedWorth charges, so its click is priced once, by the owner. (Mine: the
 *          literal PLAIN prices a click on installs only; evaluate prices it on all three through clickPrice.)
 *  HOSTED  `hostedRule`: a breaker hosted on Bling or Madani is priced at the rule-based worth (its held worth with the
 *          breaker guard up, as tree R of scripts/breaker-guard-key: the lead on file).
 *  AUDIT   `deckRootA`: DECKROOT with an audit: every AUDIT_EVERY-th value served from the root prices (rootDeckAverage)
 *          is worked out again on the asking board (drawWorth's per-board average) and compared, Corp and Runner apart.
 *          Picks of this tree are not compared (the audit fills caches).
 *  INSTR   `instr`: exclusive timers and counts inside the Runner's ranking (globalThis.__ri): by context (reply / own),
 *          by kind of candidate, by region (simulate, answerPrompt, evaluate, runScore, drawWorth, nudge, make-room list).
 *          Its answers must equal beta's (checked); its times are read as shares only.
 *  D terms (picks only), each one term of scoreMain off: dBigHand (draw +1.5), dDigBreakers (draw +1.2), dDigValue
 *          (draw + digValue), dTrojan (the trojan host value and the -3), dSaving (the saving-up +0.8 / -0.4), dFreeCut
 *          (free action <= 0.3 cut), dNudge (synergy nudge), dChain (Chain Reaction's success bonus), dTagFlat (REMOVE_TAG's
 *          flat 1.2 / 0.3: scored by the generic path, simulated and evaluated, as any other action), dEndFlat (END_TURN's
 *          flat -0.5: the generic path).
 *  Combos: any `+`-joined list of the C arms' features, e.g. `c:OPEN+DECKROOT` (the arms together).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const C_ARMS = ['promptOpen', 'promptOwner', 'deckRoot', 'plainOwners', 'plainOwnersClick', 'hostedRule'] as const;
export const D_ARMS = ['dBigHand', 'dDigBreakers', 'dDigValue', 'dTrojan', 'dSaving', 'dFreeCut', 'dNudge', 'dChain', 'dTagFlat', 'dEndFlat'] as const;
const FEATURES: Record<string, string[]> = {
  beta: [],
  control: [],
  source: [],
  instr: ['INSTR'],
  deckRootA: ['DECKROOT', 'AUDIT'],
  promptOpen: ['OPEN'],
  promptOwner: ['OPEN', 'OWNER'],
  deckRoot: ['DECKROOT'],
  plainOwners: ['PLAIN'],
  plainOwnersClick: ['PLAIN', 'CLICK'],
  hostedRule: ['HOSTED'],
  ...Object.fromEntries(D_ARMS.map(d => [d, [d]])),
};
export function features(arm: string): string[] {
  if (arm.startsWith('c:')) return [...new Set(arm.slice(2).split('+').flatMap(f => FEATURES[f] ?? [f]))];
  const f = FEATURES[arm];
  if (!f) throw new Error(`unknown arm ${arm}`);
  return f;
}

type Patch = [file: string, at: string, to: string];

/** `export function NAME(` becomes a wrapper timed as `region` (instr tree only). */
const wrapFn = (file: string, head: string, region: string): Patch => {
  const name = head.match(/function (\w+)\(/)![1];
  return [file, head, `${head.startsWith('export') ? 'export ' : ''}function ${name}(...__args: any[]): any {\n  return __RIT('${region}', () => (${name}0 as any)(...__args));\n}\n${head.replace(/^export /, '').replace(`function ${name}(`, `function ${name}0(`)}`];
};
const RIT = `\n// scripts/runner-rework/rank-cost-trees.ts INSTR\nfunction __RIT(r: string, f: () => any): any {\n  const ri = (globalThis as any).__ri;\n  return ri ? ri.T(r, f) : f();\n}\n`;

const HELPERS = `
// ---- scripts/runner-rework/rank-cost-trees.ts: arm helpers (measuring only) ----
/** promptOwner: a prompt-raising candidate that plays a grip card, by its hand owner's output; undefined: not one. */
function __ownerScore(view: GameState, action: GameAction, after: GameState, synergy: boolean): number | undefined {
  const side = activePrompt(after)?.side;
  if (side !== 'runner' && !(side === 'corp' && synergy)) return undefined;
  const id = (action as any).cardInstanceId;
  const card = id ? view.runner.grip.find(c => c.instanceId === id) : undefined;
  if (!card) return undefined;
  return __playedWorth(view, card) - __heldWorth(view, card, 'runner');
}
/** plainOwners: installs, draws and credits by their owners, no simulated play; the bonuses as scoreMain has them. */
function __plainScore(ai: any, state: GameState, action: GameAction, view: GameState, clicked: boolean): number | undefined {
  let score: number;
  let gained = 0;
  const click = () => (clicked ? __clickPrice(view, 'runner', 'runner') : 0);
  if (action.type === 'INSTALL_CARD' && !action.trashFirst?.length && !action.hostInstanceId) {
    const card = view.runner.grip.find(c => c.instanceId === action.cardInstanceId);
    if (!card) return undefined;
    score = __playedWorth(view, card) - __heldWorth(view, card, 'runner') + (clicked ? __CLICK : 0) - click();
    gained = -__runnerInstallCost(view, card);
  } else if (action.type === 'DRAW_CARD') {
    score = __drawWorth(view, 'runner', 'now') - click();
  } else if (action.type === 'GAIN_CREDIT') {
    const plus = { ...view, runner: { ...view.runner, credits: view.runner.credits + 1 } } as GameState;
    score = __sideCreditValue(plus, 'runner', 'runner') - __sideCreditValue(view, 'runner', 'runner') - click();
    gained = 1;
  } else return undefined;
  const room = state.runner.grip.length < state.runner.handSizeLimit;
  if (action.type === 'DRAW_CARD' && needsBiggerHand(state, ai.memory) && (room || state.runner.clicks >= RUNNER_TERMS.bigHandClicks)) score += RUNNER_TERMS.bigHandDraw;
  if (action.type === 'DRAW_CARD' && ai.digForBreakers && state.runner.stack.length > RUNNER_TERMS.digStackFloor && room) score += RUNNER_TERMS.digDraw;
  if (action.type === 'DRAW_CARD' && ai.synergy && state.runner.grip.length < state.runner.handSizeLimit) score += digValue(state, 'runner');
  if (ai.savingFor) {
    if (gained > 0) score += RUNNER_TERMS.savingGain;
    else if (gained < RUNNER_TERMS.savingSpendFloor) score += RUNNER_TERMS.savingSpend;
  }
  return score;
}
`;

export function patches(arm: string): Patch[] {
  if (arm === 'source') return [];
  const f = new Set(features(arm));
  const P: Patch[] = [];
  const R = 'ai/runnerAI.ts';
  // ------------------------------------------------------------------------------------------ RECORD
  P.push(
    ['ai/handValues.ts', 'function drawWorth(state: GameState, side: SideCode, when: DrawWhen): number {', 'export function drawWorth(state: GameState, side: SideCode, when: DrawWhen): number {'],
    [R, "import { inDecision } from './handValues';", "import { inDecision, playedWorth as __playedWorth, heldWorth as __heldWorth, clickPrice as __clickPrice, drawWorth as __drawWorth } from './handValues';"],
    [R, "import { RATES } from './valueModel';", "import { RATES, CLICK as __CLICK, sideCreditValue as __sideCreditValue } from './valueModel';"],
    [R, "import { runnerInstallBlocker } from '../core/engine/actions/install';", "import { runnerInstallBlocker, runnerInstallCost as __runnerInstallCost } from '../core/engine/actions/install';"],
    [
      R,
      "  chooseAction(state: GameState): GameAction {\n    return asSide('runner', () => this.decide(state));\n  }",
      "  chooseAction(state: GameState): GameAction {\n    const rc = (globalThis as any).__rc;\n    if (!rc?.on || !rc.reply) return asSide('runner', () => this.decide(state));\n    const t0 = performance.now();\n    try {\n      return asSide('runner', () => this.decide(state));\n    } finally {\n      rc.runnerMs += performance.now() - t0;\n    }\n  }",
    ],
    [
      R,
      "  rankMainActions(state: GameState, legal = getLegalActions(state, 'runner')): ScoredAction[] {\n",
      "  rankMainActions(state: GameState, legal = getLegalActions(state, 'runner')): ScoredAction[] {\n    const rc = (globalThis as any).__rc;\n    const ri = (globalThis as any).__ri;\n    if (!rc?.on && !ri) return this.rankMainActions0(state, legal);\n    const ctx = rc?.reply ? 'reply' : 'own';\n    ri?.enter(ctx);\n    const t0 = performance.now();\n    try {\n      return this.rankMainActions0(state, legal);\n    } finally {\n      const ms = performance.now() - t0;\n      ri?.leave();\n      if (rc?.on) {\n        if (ctx === 'reply') {\n          rc.rankMs += ms;\n          rc.rankCalls++;\n        } else {\n          rc.ownRankMs += ms;\n          rc.ownRankCalls++;\n        }\n      }\n    }\n  }\n  rankMainActions0(state: GameState, legal: GameAction[]): ScoredAction[] {\n",
    ],
    ['ai/runnerReply.ts', '  const undoReply = inReply();\n', '  const undoReply = inReply();\n  const __rc = (globalThis as any).__rc;\n  if (__rc) __rc.reply++;\n'],
    ['ai/runnerReply.ts', '  } finally {\n    undoReply();\n  }', '  } finally {\n    undoReply();\n    if (__rc) __rc.reply--;\n  }'],
    [
      'ai/runnerReply.ts',
      '      let runnerTurn = false;\n',
      "      let runnerTurn = false;\n      const __seq: string[] | null = __rc?.on ? __rc.sample(`${k}|${end.turnNumber}|${end.activePlayer}|${end.corp.credits}|${end.corp.clicks}|${end.runner.credits}|${end.corp.hq.length}|${end.log.length}|${Object.values(end.corp.servers).map(v => v.ice.length + '/' + v.root.length).join(',')}`) : null;\n",
    ],
    ['ai/runnerReply.ts', '          if (!gr.step()) break;\n', '          if (!gr.step()) break;\n          if (__seq) __seq.push(JSON.stringify(gr.last));\n'],
  );
  // The arm helpers only where an arm calls them: __plainScore copies scoreMain's bonus lines, which the D patches must find once
  if (f.has('OWNER') || f.has('PLAIN')) P.push([R, "const READ_WRITE_SHARE = '36022';", `${HELPERS}\nconst READ_WRITE_SHARE = '36022';`]);
  // ------------------------------------------------------------------------------------------ arms
  if (f.has('OPEN')) P.push([R, '    for (let i = 0; i < 3; i++) {\n      const side = activePrompt(resolved)?.side;', '    for (let i = 0; i < 0; i++) {\n      const side = activePrompt(resolved)?.side;']);
  if (f.has('OWNER')) P.push([R, "    let score = evaluate(resolved, 'runner') - before;", "    let score = __ownerScore(view, action, after, this.synergy) ?? evaluate(resolved, 'runner') - before;"]);
  if (f.has('PLAIN'))
    P.push([R, '    const after = simulate(view, action);\n    if (!after) return -Infinity;\n    const spendsClick', `    const __plain = __plainScore(this, state, action, view, ${f.has('CLICK')});\n    if (__plain !== undefined) return __plain;\n    const after = simulate(view, action);\n    if (!after) return -Infinity;\n    const spendsClick`]);
  if (f.has('DECKROOT'))
    P.push([
      'ai/handValues.ts',
      "  return side === 'corp' && !pricing().pricingRootDeck && pricing().frozen && !!anchor?.root && anchor.side === 'corp' && anchor.root.id === state.id && pricing().side !== null;",
      "  return (side === 'corp' ? anchor?.side === 'corp' : true) && !pricing().pricingRootDeck && pricing().frozen && !!anchor?.root && anchor.root.id === state.id && pricing().side !== null;",
    ]);
  if (f.has('AUDIT'))
    P.push([
      'ai/handValues.ts',
      '  if (rootAvg !== undefined) return rootAvg;\n',
      "  if (rootAvg !== undefined) {\n    const au = (globalThis as any).__rcAudit;\n    if (au?.on && au.n++ % au.every === 0) {\n      const fresh = withPricing({ averaging: true }, () => (deck.length ? deck.reduce((n, c) => n + heldWorth(state, c, side), 0) / deck.length : RATES.drawnCard));\n      au.rec(side, rootAvg, fresh);\n    }\n    return rootAvg;\n  }\n",
    ]);
  if (f.has('HOSTED'))
    P.push([
      'ai/evaluate.ts',
      "  value += hosted.reduce((n, h) => n + heldWorth(state, h, 'runner', freeInstall), 0);",
      "  value += hosted.reduce((n, h) => n + (isIcebreaker(h) ? withPricing({ pricingBreaker: true }, () => heldWorth(state, h, 'runner', freeInstall)) : heldWorth(state, h, 'runner', freeInstall)), 0);",
    ]);
  // D terms
  const off = (at: string, to: string) => P.push([R, at, to]);
  if (f.has('dBigHand')) off('(room || state.runner.clicks >= RUNNER_TERMS.bigHandClicks)) score += RUNNER_TERMS.bigHandDraw;', '(room || state.runner.clicks >= RUNNER_TERMS.bigHandClicks)) void 0;');
  if (f.has('dDigBreakers')) off('state.runner.stack.length > RUNNER_TERMS.digStackFloor && room) score += RUNNER_TERMS.digDraw;', 'state.runner.stack.length > RUNNER_TERMS.digStackFloor && room) void 0;');
  if (f.has('dDigValue')) off("state.runner.handSizeLimit) score += digValue(state, 'runner');", 'state.runner.handSizeLimit) void 0;');
  // Since B3b a rezzed host's worth is the board's own term (counterValues.ts trojanHostWorth, read through evaluate): only
  // the facedown host's flat is left in scoreMain, so dTrojan now takes off that flat alone
  if (f.has('dTrojan')) off('      if (!host?.isRezzed) score += RUNNER_TERMS.facedownTrojanHost;', '      void host;');
  if (f.has('dSaving')) off('    if (this.savingFor) {\n      const gained', '    if (false as boolean) {\n      const gained');
  if (f.has('dFreeCut')) off('    if (!spendsClick && score <= RUNNER_TERMS.freeActionCut) return -Infinity;', '    void spendsClick;');
  if (f.has('dNudge')) off("action.type !== 'END_TURN') score += nudge(state, 'runner', action).bonus;", "action.type !== 'END_TURN') void nudge;");
  if (f.has('dChain')) off(', successBonus: chainReactionBonus(state, action.targetServerId) });', ' });');
  if (f.has('dTagFlat')) off("      case 'REMOVE_TAG':\n        return state.runner.rig.resources.length > 0 ? RUNNER_TERMS.tagRemovalResource : RUNNER_TERMS.tagRemovalNoResource;\n", '');
  if (f.has('dEndFlat')) off("      case 'END_TURN':\n        return RUNNER_TERMS.endTurn;\n", '');
  // ------------------------------------------------------------------------------------------ INSTR
  if (f.has('INSTR')) {
    P.push(
      [R, '        let score = this.scoreMain(state, action, before, view);', '        let score = (globalThis as any).__ri ? (globalThis as any).__ri.cand(state, action, () => this.scoreMain(state, action, before, view)) : this.scoreMain(state, action, before, view);'],
      [R, '    return [...legal, ...makeRoomInstalls(state)]', "    return [...legal, ...__RIT('makeRoomList', () => makeRoomInstalls(state))]"],
      [R, "action.type !== 'END_TURN') score += nudge(state, 'runner', action).bonus;", "action.type !== 'END_TURN') score += __RIT('nudge', () => nudge(state, 'runner', action).bonus);"],
      [R, "const READ_WRITE_SHARE = '36022';", `${RIT}\nconst READ_WRITE_SHARE = '36022';`],
      wrapFn('ai/prompts.ts', 'export function simulate(state: GameState, action: GameAction): GameState | null {', 'simulate'),
      wrapFn('ai/prompts.ts', 'export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false, at?: ChainAt): GameAction {', 'answerPrompt'),
      ['ai/prompts.ts', '  for (const action of options) {\n    const after = simulated?.get(JSON.stringify(action)) ?? simulate(state, action);', "  for (const action of options) {\n    (globalThis as any).__ri?.c('options');\n    const after = simulated?.get(JSON.stringify(action)) ?? simulate(state, action);"],
      ['ai/prompts.ts', '/** Applies an action, or returns null if the engine rejects it. */', `${RIT}\n/** Applies an action, or returns null if the engine rejects it. */`],
      wrapFn('ai/evaluate.ts', 'export function evaluate(state: GameState, side: SideCode): number {', 'evaluate'),
      ['ai/evaluate.ts', "import { CARDS } from './cards';", `import { CARDS } from './cards';\n${RIT}`],
      wrapFn('ai/runs.ts', 'export function runScore(state: GameState, serverId: string, options: RunOptions = {}): number {', 'runScore'),
      ['ai/runs.ts', '/**\n * Credits the Runner is short of getting past', `${RIT}\n/**\n * Credits the Runner is short of getting past`],
      wrapFn('ai/handValues.ts', 'export function drawWorth(state: GameState, side: SideCode, when: DrawWhen): number {', 'drawWorth'),
      ['ai/handValues.ts', '/** Worth of a card once played, less its cost and click (credits), before the wait. */', `${RIT}\n/** Worth of a card once played, less its cost and click (credits), before the wait. */`],
    );
  }
  return P;
}

/** Copies this checkout's src into root/<arm>/src with the arm's patches; each patch must match exactly once. */
export function makeTrees(root: string, arms: readonly string[], from = 'src'): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of arms) {
    const dir = join(root, arm.replace(/[^A-Za-z0-9]/g, '_'));
    mkdirSync(dir, { recursive: true });
    cpSync(from, join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of patches(arm)) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`tree ${arm}: a patch does not match once in ${f}: ${at.slice(0, 90)}`);
      writeFileSync(path, text.replace(at, () => to));
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
  hv: any;
  runs: any;
  evaluate: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/runs.ts', 'ai/evaluate.ts']) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, runs, evaluate] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    hv,
    runs,
    evaluate,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
