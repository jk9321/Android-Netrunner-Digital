/**
 * R-B B2 log of "decided twice", brief rev 1, part "the pins on three scratch trees" (pins only, no pool): the boards of the
 * #59 pin (tests/runnerDecidedTwice.test.ts, T7, T8, T10, remote-1) and the #66a pin (tests/runnerIssues64to66.test.ts,
 * T15, T16, remote-3), each played as its pin plays it, on four scratch trees:
 *   control  src with only the click field beside the self-break price (value-neutral, as decided-twice-trees.ts EVAL)
 *   a        the price bounds P (the clicks the chosen prices plan) by the clicks left: while the run's prices plan more
 *            clicks than there are, the clicked ice whose next-cheapest way costs least more takes it; none: barred
 *   b        the in-run decision keeps the clicks the prices plan for the rezzed ice further in before it clicks an
 *            outer bioroid's subroutine that does not end the run
 *   c        a and b
 * Per tree and board: does the pin's assertion hold (no run on the server that spends bioroid clicks and then jacks out),
 * and what the Runner does instead. A measurement of which half each pin needs, not a fix; nothing here is merged.
 *
 *   npx vite-node scripts/runner-rework/decided-twice-pins.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { Patch } from './decided-twice-trees';

const CLICK_FIELD: Patch = ['ai/runs.ts', `  return { credits: 0, value: clicks * 1.5 };\n}`, `  return { credits: 0, value: clicks * 1.5, __clicks: clicks } as IcePrice;\n}`];

/** (a) price-only: P bounded by the clicks left, in runPrices (as the tank damage is bounded there). */
export const PRICE_BOUND: Patch[] = [
  [
    'ai/runs.ts',
    `function selfBreakPrice(state: GameState, ice: CardInstance, subCount: number): IcePrice {`,
    `const __NOCLICK = new Set<string>();\nfunction selfBreakPrice(state: GameState, ice: CardInstance, subCount: number): IcePrice {\n  if (__NOCLICK.has(ice.instanceId)) return BLOCKED;`,
  ],
  [
    'ai/runs.ts',
    `    if (options.length === 0) return null;\n    prices.set(options[0].ice.instanceId, options[0].alt);\n  }\n  return prices;\n}`,
    `    if (options.length === 0) return null;\n    prices.set(options[0].ice.instanceId, options[0].alt);\n  }\n  const left = state.activePlayer === 'runner' ? (state.activeRun ? state.runner.clicks : state.runner.clicks - 1) : Infinity;\n  const clicksOf = () => ices.reduce((n, ice) => n + ((prices.get(ice.instanceId) as { __clicks?: number }).__clicks ?? 0), 0);\n  while (clicksOf() > left) {\n    const alts = ices\n      .filter(ice => (prices.get(ice.instanceId) as { __clicks?: number }).__clicks)\n      .map(ice => {\n        __NOCLICK.add(ice.instanceId);\n        try {\n          const alt = icePrice(state, ice);\n          return { ice, alt, extra: total(alt) - total(prices.get(ice.instanceId)!) };\n        } finally {\n          __NOCLICK.delete(ice.instanceId);\n        }\n      })\n      .filter(o => total(o.alt) < BLOCK)\n      .sort((a, b) => a.extra - b.extra);\n    if (alts.length === 0) return null;\n    prices.set(alts[0].ice.instanceId, alts[0].alt);\n  }\n  return prices;\n}`,
  ],
];

/** (b) in-run only: keep the clicks the prices plan for the rezzed ice further in before clicking a subroutine that does not end the run. */
export const RUN_RESERVE: Patch[] = [
  // R-C1 Part 0, R-26: the in-run decision is runner/run.ts since B1 (ported to beta 0b9d44a)
  ['ai/runner/run.ts', `import { MANEGARM, bestBreakPlan,`, `import { icePrice as __icePrice, MANEGARM, bestBreakPlan,`],
  [
    'ai/runner/run.ts',
    `    if (click && (worst.cost === Infinity || state.runner.clicks - (own?.clicks ?? 1) >= approachClickReserve(state))) return click;`,
    `    if (click && (worst.cost === Infinity || state.runner.clicks - (own?.clicks ?? 1) >= approachClickReserve(state) + __aheadClicks(state))) return click;`,
  ],
  [
    'ai/runner/run.ts',
    `export function approachClickReserve(state: GameState): number {`,
    `/** The clicks the prices of the rezzed ice further in plan (their click self-breaks). */\nfunction __aheadClicks(state: GameState): number {\n  const run = state.activeRun;\n  const server = run ? state.corp.servers[run.server] : undefined;\n  if (!run || !server || run.icePosition === null) return 0;\n  return server.ice.slice(0, run.icePosition).filter(c => c.isRezzed).reduce((n, c) => n + ((__icePrice(state, c) as { __clicks?: number }).__clicks ?? 0), 0);\n}\n\nexport function approachClickReserve(state: GameState): number {`,
  ],
];

export const TREES: Record<string, Patch[]> = { control: [CLICK_FIELD], a: [CLICK_FIELD, ...PRICE_BOUND], b: [CLICK_FIELD, ...RUN_RESERVE], c: [CLICK_FIELD, ...PRICE_BOUND, ...RUN_RESERVE] };

function makeTree(root: string, name: string, patches: Patch[]): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  cpSync('src', join(dir, 'src'), { recursive: true });
  for (const [f, at, to] of patches) {
    const path = join(dir, 'src', f);
    const text = readFileSync(path, 'utf8');
    if (text.split(at).length !== 2) throw new Error(`${name}: a patch does not match once in ${f}: ${at.slice(0, 90)}`);
    writeFileSync(
      path,
      text.replace(at, () => to)
    );
  }
  return dir;
}

type Pin = { name: string; file: string; turns: number[]; server: string; observeAtBoard: boolean };
const PINS: Pin[] = [
  { name: '#59', file: 'tests/fixtures/runner-facts/issues/issue-59.json', turns: [7, 8, 10], server: 'remote-1', observeAtBoard: false },
  { name: '#66a', file: 'tests/fixtures/runner-issues/issue-66.json', turns: [15, 16], server: 'remote-3', observeAtBoard: true },
];

async function main() {
  const root = resolve('node_modules/.cache/decided-twice-pins');
  rmSync(root, { recursive: true, force: true });
  const out: any[] = [];
  for (const [name, patches] of Object.entries(TREES)) {
    const dir = makeTree(root, name, patches);
    const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
    const ai = await m('ai/index.ts');
    const po = await m('ai/playout.ts');
    const core = await m('core/index.ts');
    const decks = await m('data/decks.ts');
    for (const pin of PINS) {
      const r = JSON.parse(readFileSync(pin.file, 'utf8'));
      for (const turn of pin.turns) {
        // The pin's board: the saved game at the Runner's first run of the turn, a Normal Runner that watched every board
        let s: GameState = core.createInitialGameState(decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
        const runner = ai.createAgent('runner', 'normal');
        for (const move of r.moves as GameAction[]) {
          if (s.turnNumber === turn && s.activePlayer === 'runner' && move.type === 'INITIATE_RUN') break;
          runner.observe?.(s);
          s = core.executeAction(s, move);
        }
        if (pin.observeAtBoard) runner.observe?.(s);
        const g = new po.GameRunner(structuredClone(s), { runner, corp: ai.createAgent('corp', 'normal') });
        const runs: { server: string; breaks: number; ended: string }[] = [];
        const did: string[] = [];
        let open: (typeof runs)[number] | null = null;
        for (let k = 0; k < 4000 && g.state.turnNumber <= turn && !g.state.winner; k++) {
          const before = g.state;
          g.step();
          const a = g.last;
          const after = g.state;
          if (a?.player !== 'runner') continue;
          if (!before.activeRun && !core.activePrompt(before) && before.activePlayer === 'runner') did.push(a.type === 'INITIATE_RUN' ? `run ${a.targetServerId}` : a.type);
          if (a.type === 'INITIATE_RUN' || (!before.activeRun && after.activeRun)) {
            open = after.activeRun ? { server: after.activeRun.server, breaks: 0, ended: 'other' } : null;
            if (open) runs.push(open);
          }
          if (!open) continue;
          if (a.type === 'BIOROID_BREAK') open.breaks++;
          if (a.type === 'JACK_OUT') open.ended = 'jackedOut';
          if (!after.activeRun && after.runsThisTurn.some((x: any) => x.server === open!.server && x.successful)) open.ended = open.ended === 'jackedOut' ? 'jackedOut' : 'successful';
          if (!after.activeRun) open = null;
        }
        const onServer = runs.filter(x => x.server === pin.server);
        const holds = onServer.filter(x => x.breaks > 0 && x.ended === 'jackedOut').length === 0;
        const rec = { kind: 'pin', tree: name, pin: pin.name, T: turn, holds, runsOnServer: onServer, did };
        out.push(rec);
        console.log(JSON.stringify(rec));
      }
    }
  }
  console.log('\n| pin | turn | control | a (price bound) | b (in-run reserve) | c (both) |\n|---|---|---|---|---|---|');
  for (const pin of PINS)
    for (const turn of pin.turns) {
      const cell = (t: string) => {
        const x = out.find(o => o.tree === t && o.pin === pin.name && o.T === turn);
        return `${x.holds ? 'holds' : 'FAILS'}: ${x.runsOnServer.map((y: any) => `${y.breaks} clicks, ${y.ended}`).join('; ') || 'no run on it'}`;
      };
      console.log(`| ${pin.name} | T${turn} | ${['control', 'a', 'b', 'c'].map(cell).join(' | ')} |`);
    }
}

// patch-check.ts imports TREES only
if (!process.env.PATCH_CHECK)
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
