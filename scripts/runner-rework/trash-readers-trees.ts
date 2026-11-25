/**
 * R-B O1b, the count of which reader of a trash is right (brief netrunner-ai/runner-rework/briefs/o1b-trash-readers-count.md
 * rev 0, tracker R-14e): the trees the count uses. Text patches on scratch copies of this checkout's src, never the repo's.
 *
 *   play   src unchanged: plays the source games (a plain GameRunner, never asked or cleared by the script).
 *   eval   asked on structuredClones: decided-twice's eval patches (exports and runScore's record, values unchanged) plus
 *          three records of the access decision's parts (scoreOutcome's three terms, sideStrength's terms per side, the
 *          Corp board's term per card). Each record writes a global the script sets; every term is the very value the
 *          line computed before (same calls, same order, same sum), so no value changes.
 *   pairs  src unchanged: plays the two answers on to the end of the game (a tree apart, so the eval tree's asks and the
 *          source game share no cache).
 *
 * Each patch must match exactly once (a stop otherwise).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVAL as DT_EVAL, Patch } from './decided-twice-trees';

const C = `(globalThis as any).__trCap`;

export const PARTS: Patch[] = [
  // scoreOutcome: its three terms (the board score, the hand-keep term, the rest of the run), when the script asks
  [
    'ai/prompts.ts',
    `  let score = evaluate(after, side);\n  // Cards that came from the deck are unknown until drawn: only the cards that left the hand count (plan.blindDraws)\n  const drawn = (c: CardInstance) => !hand(before, side).some(b => b.instanceId === c.instanceId) && fromDeck(before, side, c);\n  score += 0.5 * (sumKeep(after, hand(after, side).filter(c => !drawn(c)), synergy) - sumKeep(before, hand(before, side), synergy));\n  if (side === 'runner' && before.activeRun) {\n    // While ice is still ahead the rest of the run may not happen (0.8); once the breach has begun (the Success Phase,\n    // rules 6.9.5b: the Runner breaches the server, 7.3.1) no ice is left and its accesses are counted in full\n    const breaching = before.activeRun.phase === 'access';\n    score += (breaching ? 1 : 0.8) * runRestWorth(after, memory, synergy && tuning.wary);\n  }\n  return score;`,
    `  const __cap = ${C};\n  if (__cap) __cap.active = true;\n  let score = evaluate(after, side);\n  if (__cap) { __cap.active = false; __cap.evaluate = score; }\n  // Cards that came from the deck are unknown until drawn: only the cards that left the hand count (plan.blindDraws)\n  const drawn = (c: CardInstance) => !hand(before, side).some(b => b.instanceId === c.instanceId) && fromDeck(before, side, c);\n  const __keep = 0.5 * (sumKeep(after, hand(after, side).filter(c => !drawn(c)), synergy) - sumKeep(before, hand(before, side), synergy));\n  if (__cap) __cap.handKeep = __keep;\n  score += __keep;\n  if (side === 'runner' && before.activeRun) {\n    // While ice is still ahead the rest of the run may not happen (0.8); once the breach has begun (the Success Phase,\n    // rules 6.9.5b: the Runner breaches the server, 7.3.1) no ice is left and its accesses are counted in full\n    const breaching = before.activeRun.phase === 'access';\n    const __rest = (breaching ? 1 : 0.8) * runRestWorth(after, memory, synergy && tuning.wary);\n    if (__cap) __cap.runRest = __rest;\n    score += __rest;\n  }\n  if (__cap) __cap.total = score;\n  return score;`,
  ],
  // sideStrength: each term, in the order and the sum of the line it replaces (only while scoreOutcome's evaluate runs, the
  // outermost call: nested calls inside a term find the capture switched off)
  [
    'ai/evaluate.ts',
    `export function sideStrength(state: GameState, side: SideCode, viewer: SideCode = side): number {\n  if (side === 'corp') {\n    const corp = state.corp;\n    return (\n      sideCreditValue(state, 'corp', viewer) +\n      handAndClicks(state, 'corp', viewer) +\n      pointValue(corp.score, viewer === 'corp' ? KNOBS.corpPoints : 1) +\n      corpBoardValue(state, viewer) +\n      tagsWorth(state, viewer) +\n      // Dividends and Next Big Thing counters, AU Co. power counters\n      corp.scoreArea.reduce((n, a) => n + countersWorth(state, a, 'agenda'), 0) +\n      countersWorth(state, corp.identity, 'power')\n    );\n  }\n  const runner = state.runner;\n  return (\n    sideCreditValue(state, 'runner', viewer) +\n    handAndClicks(state, 'runner', viewer) +\n    pointValue(runner.score) -\n    tagsWorth(state, viewer) -\n    coreSlotWorth(state) * runner.coreDamage -\n    // The damage clock: a small grip against the Corp's damage is a step toward a flatline\n    logValue('damage', 'board clock', state, flatlineWorth(state) * flatlineOdds(state, lifeGrip(state), true) + lifeCards(runner.grip.length)) +\n    runnerRigValue(state)\n  );\n}`,
    `export function sideStrength(state: GameState, side: SideCode, viewer: SideCode = side): number {\n  const __cap = ${C};\n  const __on = !!__cap?.active;\n  if (__on) __cap.active = false;\n  if (side === 'corp') {\n    const corp = state.corp;\n    const t0 = sideCreditValue(state, 'corp', viewer);\n    const t1 = handAndClicks(state, 'corp', viewer);\n    const t2 = pointValue(corp.score, viewer === 'corp' ? KNOBS.corpPoints : 1);\n    const __bm = new Map<string, number>();\n    if (__on) (globalThis as any).__trBoard = __bm;\n    const t3 = corpBoardValue(state, viewer);\n    const t4 = tagsWorth(state, viewer);\n    // Dividends and Next Big Thing counters, AU Co. power counters\n    const t5 = corp.scoreArea.reduce((n, a) => n + countersWorth(state, a, 'agenda'), 0);\n    const t6 = countersWorth(state, corp.identity, 'power');\n    if (__on) { __cap.corp = { credits: t0, handClicks: t1, points: t2, board: t3, boardCards: __bm, tags: t4, agendaCounters: t5, idPower: t6 }; (globalThis as any).__trBoard = undefined; __cap.active = true; }\n    return t0 + t1 + t2 + t3 + t4 + t5 + t6;\n  }\n  const runner = state.runner;\n  const r0 = sideCreditValue(state, 'runner', viewer);\n  const r1 = handAndClicks(state, 'runner', viewer);\n  const r2 = pointValue(runner.score);\n  const r3 = tagsWorth(state, viewer);\n  const r4 = coreSlotWorth(state) * runner.coreDamage;\n  // The damage clock: a small grip against the Corp's damage is a step toward a flatline\n  const r5 = logValue('damage', 'board clock', state, flatlineWorth(state) * flatlineOdds(state, lifeGrip(state), true) + lifeCards(runner.grip.length));\n  const r6 = runnerRigValue(state);\n  if (__on) { __cap.runner = { credits: r0, handClicks: r1, points: r2, tags: r3, core: r4, clock: r5, rig: r6 }; __cap.active = true; }\n  return r0 + r1 + r2 - r3 - r4 - r5 + r6;\n}`,
  ],
  // A rig card's own term in runnerRigValue (export only), for the rig term split by card on tag accesses (coordinator 02:37Z)
  ['ai/evaluate.ts', `function addRigCard(state: GameState, card: CardInstance, value: number): number {`, `export function addRigCard(state: GameState, card: CardInstance, value: number): number {`],
  // corpBoardValue: each root card's term (the map the corp side of sideStrength hands it; nested calls see none)
  [
    'ai/evaluate.ts',
    `export function corpBoardValue(state: GameState, viewer: SideCode): number {\n  let value = 0;`,
    `export function corpBoardValue(state: GameState, viewer: SideCode): number {\n  const __m: Map<string, number> | undefined = (globalThis as any).__trBoard;\n  (globalThis as any).__trBoard = undefined;\n  let value = 0;`,
  ],
  [
    'ai/evaluate.ts',
    `      else value += corpCardValue(card, state, viewer);\n    }\n  }\n  return value + archivedAgendasValue(state, viewer);`,
    `      else {\n        const __v = corpCardValue(card, state, viewer);\n        __m?.set(card.instanceId, __v);\n        value += __v;\n      }\n    }\n  }\n  return value + archivedAgendasValue(state, viewer);`,
  ],
];

export function makeTrees(root: string): { play: string; eval: string; pairs: string } {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = { play: join(root, 'play'), eval: join(root, 'eval'), pairs: join(root, 'pairs') };
  for (const [name, dir] of Object.entries(dirs)) {
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    const patches = name === 'eval' ? [...DT_EVAL, ...PARTS] : [];
    for (const [f, at, to] of patches) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`${name} tree: a patch does not match once in ${f}: ${at.slice(0, 90)}`);
      writeFileSync(
        path,
        text.replace(at, () => to)
      );
    }
  }
  return dirs;
}
