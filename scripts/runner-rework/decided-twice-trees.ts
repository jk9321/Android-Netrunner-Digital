/**
 * R-B B2 log of "decided twice" (brief netrunner-ai/runner-rework/briefs/b2-decided-twice-log.md rev 0, tracker R-14a):
 * the two trees the log uses. Text patches on scratch copies of this checkout's src, never on the repo's src.
 *
 *   hooked  plays the source games (a plain GameRunner, its agents never asked by the script, its caches never cleared).
 *           Every patch only CALLS a global the measuring script sets (`__dt`), with values the patched code has already
 *           computed or computes in the same order; unset, the line does what it did. Step 0 point 2 checks the tree's
 *           games against a plain copy of src, action for action, and against the batch's deals.json records.
 *   eval    asked by the script on structuredClones: exports, and runScore's parts and its reason when it returns minus
 *           infinity (a record written into a global; the value returned is unchanged).
 *
 * Each patch must match exactly once (a stop otherwise, as the earlier counts' trees).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Patch = [file: string, at: string, to: string];
const G = `(globalThis as any).__dt`;

// R-83 (B4d): the in-run hooks sit in src/ai/runner/run.ts since B2 (free functions: the agent they report is the one
// whose decision is under way, `__dtAgent`, set around runnerDecide by the last patch), the run-event price reads B1's
// RUNNER_TERMS.runCard, and Alarm Clock's run is its card entry's (cards/liberation.ts); O1b's wrapper
// (trash-owner-decided.ts) that moved them at load is folded in here
const A = `(globalThis as any).__dtAgent`;

export const HOOKED: Patch[] = [
  // S0: the ranking's price of each run it scores (the view it priced on, the options it used, the score)
  [
    'ai/runnerAI.ts',
    `        return runScore(view, action.targetServerId, { memory: this.memory, wary: this.synergy && tuning.wary, successBonus: chainReactionBonus(view, action.targetServerId) });`,
    `        {\n          const __o = { memory: this.memory, wary: this.synergy && tuning.wary, successBonus: chainReactionBonus(view, action.targetServerId) };\n          const __s = runScore(view, action.targetServerId, __o);\n          ${G}?.price(this, state, action, action.targetServerId, view, __o, __s);\n          return __s;\n        }`,
  ],
  [
    'ai/runnerAI.ts',
    `      const best = Math.max(...prompt.options.map(o => runScore(view, o.id, options)));`,
    `      const best = Math.max(\n        ...prompt.options.map(o => {\n          const __s = runScore(view, o.id, options);\n          ${G}?.price(this, state, action, o.id, view, options, __s);\n          return __s;\n        })\n      );`,
  ],
  [
    'ai/runnerAI.ts',
    `        const best = Math.max(...ask.options.map(o => runScore({ ...ready, runner: { ...ready.runner, clicks: state.runner.clicks } }, o.id, options)));`,
    `        const best = Math.max(\n          ...ask.options.map(o => {\n            const __b = { ...ready, runner: { ...ready.runner, clicks: state.runner.clicks } };\n            const __s = runScore(__b, o.id, options);\n            ${G}?.price(this, state, action, o.id, __b, options, __s);\n            return __s;\n          })\n        );`,
  ],
  [
    'ai/runnerAI.ts',
    `      return runScore(view, after.activeRun.server, { ...runEventOptions(cardCode ?? '', state), memory: this.memory, wary: this.synergy && tuning.wary }) - spendCost(state, paid) + RUNNER_TERMS.runCard;`,
    `      const __o = { ...runEventOptions(cardCode ?? '', state), memory: this.memory, wary: this.synergy && tuning.wary };\n      const __s = runScore(view, after.activeRun.server, __o);\n      ${G}?.price(this, state, action, after.activeRun.server, view, __o, __s);\n      return __s - spendCost(state, paid) + RUNNER_TERMS.runCard;`,
  ],
  // During the run: the jack-out test in movement (creditsAhead against the credits)
  [
    'ai/runner/run.ts',
    `    if (creditsAhead(state) > credits && find('JACK_OUT')) return find('JACK_OUT');`,
    `    const __ahead = creditsAhead(state);\n    ${G}?.move(${A}, state, __ahead, credits);\n    if (__ahead > credits && find('JACK_OUT')) return find('JACK_OUT');`,
  ],
  // During the run: each place encounterAction gives no break, and which test said so
  [
    'ai/runner/run.ts',
    `  const mustBreak = unbroken.filter(s => s.cost >= 1);\n  if (mustBreak.length === 0) return undefined;`,
    `  const mustBreak = unbroken.filter(s => s.cost >= 1);\n  if (mustBreak.length === 0) {\n    ${G}?.enc(${A}, state, 'nothingWorth', { unbroken: unbroken.map(s => [s.i, s.cost]) });\n    return undefined;\n  }`,
  ],
  [
    'ai/runner/run.ts',
    `    if (click && (worst.cost === Infinity || state.runner.clicks - (own?.clicks ?? 1) >= approachClickReserve(state))) return click;`,
    `    if (click && (worst.cost === Infinity || state.runner.clicks - (own?.clicks ?? 1) >= approachClickReserve(state))) return click;\n    ${G}?.enc(${A}, state, click ? 'clickReserve' : 'noClickBreak', { clicks: state.runner.clicks });`,
  ],
  [
    'ai/runner/run.ts',
    `    if (credits < iceCreditNeed(state, ice, encounter.broken) && before < 2 && !survive()) return undefined;`,
    `    const __need = iceCreditNeed(state, ice, encounter.broken);\n    if (credits < __need && before < 2 && !survive()) {\n      ${G}?.enc(${A}, state, 'cannotGetThrough', { credits, need: __need, ahead, before });\n      return undefined;\n    }`,
  ],
  [
    'ai/runner/run.ts',
    `  if (breakPlan && planCost(breakPlan) <= tank + 0.5) {\n    const action = tryBreaking(mustBreak);\n    if (action) return action;\n  }`,
    `  if (breakPlan && planCost(breakPlan) <= tank + 0.5) {\n    const action = tryBreaking(mustBreak);\n    if (action) return action;\n  }\n  ${G}?.enc(${A}, state, !breakPlan ? 'noPlanAll' : planCost(breakPlan) <= tank + 0.5 ? 'cannotPayAll' : 'dearerThanTank', { credits, ahead, tank, plan: breakPlan ? [breakPlan.credits, breakPlan.value] : null });`,
  ],
  [
    'ai/runner/run.ts',
    `      if (bioroid) return bioroid;\n    }\n  }\n  return undefined;\n}`,
    `      if (bioroid) return bioroid;\n    }\n  }\n  ${G}?.enc(${A}, state, blocking.length > 0 ? 'cannotBreakBlocking' : 'tankRest', { credits, ahead, blocking: blocking.length, clicks: state.runner.clicks });\n  return undefined;\n}`,
  ],
  // A run a prompt answer decides: Alarm Clock's turn-start HQ run (its card entry), called in the same order as before
  [
    'ai/cards/liberation.ts',
    `      const go = runScore(state, 'hq', { alarmClock: true, memory, wary: synergy && tuning.wary }) + runClick(state) > 0;`,
    `      const __o = { alarmClock: true, memory, wary: synergy && tuning.wary };\n      const __s = runScore(state, 'hq', __o);\n      ${G}?.pprice(memory, state, 'hq', __o, __s);\n      const go = __s + runClick(state) > 0;`,
  ],
  // The agent whose decision is under way, for the in-run hooks (a look-ahead's or a reply's agent reports itself); runAction
  // is reached only through runnerDecide (runner/core.ts); the Hard Runner (search.ts) is not in these games
  [
    'ai/runnerAI.ts',
    `    return runnerDecide(state, this.runnerContext());`,
    `    const __p = ${A};\n    ${A} = this;\n    try {\n      return runnerDecide(state, this.runnerContext());\n    } finally {\n      ${A} = __p;\n    }`,
  ],
];

const RS = `(globalThis as any).__dtRs`;
export const EVAL: Patch[] = [
  // P (rev 1): the click self-break's clicks, as a field beside the price (read by the log, by nothing in src)
  ['ai/runs.ts', `  return { credits: 0, value: clicks * 1.5 };\n}`, `  return { credits: 0, value: clicks * 1.5, __clicks: clicks } as IcePrice;\n}`],
  [
    'ai/runs.ts',
    `const CHAIN_REACTION = '36001';`,
    `export { runPrices as __runPrices, selfBreakPrice as __selfBreakPrice, plainIcePrice as __plainIcePrice };\nconst CHAIN_REACTION = '36001';`,
  ],
  // runScore: its parts and the reason of each minus infinity, into a global the script reads (the value is unchanged)
  [
    'ai/runs.ts',
    `export function runScore(state: GameState, serverId: string, options: RunOptions = {}): number {\n  const server = state.corp.servers[serverId];\n  if (!server) return -Infinity;`,
    `export function runScore(state: GameState, serverId: string, options: RunOptions = {}): number {\n  const __r: any = {};\n  ${RS} = __r;\n  const server = state.corp.servers[serverId];\n  if (!server) return ((__r.reason = 'noServer'), -Infinity);`,
  ],
  ['ai/runs.ts', `  if (!prices) return -Infinity;\n  const iceDamage`, `  __r.bypassed = [...bypassed.ids];\n  __r.prices = prices;\n  if (!prices) return ((__r.reason = 'noSurvivablePrices'), -Infinity);\n  const iceDamage`],
  ['ai/runs.ts', `  if (value <= 0) return -Infinity;\n  let known = 0;`, `  __r.iceDamage = iceDamage;\n  __r.value = value;\n  if (value <= 0) return ((__r.reason = 'value<=0'), -Infinity);\n  let known = 0;`],
  ['ai/runs.ts', `    if (total(price) === BLOCK) return -Infinity;`, `    if (total(price) === BLOCK) return ((__r.reason = 'BLOCK'), (__r.blockIce = ice.instanceId), -Infinity);`],
  ['ai/runs.ts', `  if (known > budget) return -Infinity;`, `  __r.known = known;\n  __r.expected = expected;\n  __r.budget = budget;\n  __r.lost = lost;\n  __r.waste = waste;\n  if (known > budget) return ((__r.reason = 'known>budget'), -Infinity);`],
  [
    'ai/runs.ts',
    `  if (!approach) return -Infinity;\n  const paid`,
    `  __r.approach = approach;\n  if (!approach) return ((__r.reason = 'noApproach'), -Infinity);\n  __r.reason = null;\n  const paid`,
  ],
];

export function makeTrees(root: string): { plain: string; hooked: string; eval: string } {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = { plain: join(root, 'plain'), hooked: join(root, 'hooked'), eval: join(root, 'eval') };
  for (const [name, dir] of Object.entries(dirs)) {
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    // The hooked tree also carries runScore's record (a global written, the value unchanged), so S0's parts are the ones
    // the ranking itself read (the eval tree's re-ask can differ a little: the hooked tree's caches carry over a game)
    const patches = name === 'hooked' ? [...HOOKED, ...EVAL] : name === 'eval' ? EVAL : [];
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
