// Stage D exploit F2 (grip money), count step (brief: /mnt/project-files/netrunner-ai/stage-d/f2-grip-money/brief.md):
// writes scripts/stage-d/grip-money-arms.json, the arms as text patches on a copy of src/ (runner-money-trees.ts
// makeTrees format). Each patch is checked against beta's text here, so a stale patch fails at once.
//   node scripts/stage-d/grip-money-arms.mjs
//
// Arms (all ADD to beta; nothing under src/ changes on this branch):
//  - control: beta unchanged, a copy built the same way (the time base, found row 69a);
//  - f2max, f2odds: the 2026-11-18 arms (runner-money-arms.json) with the same amounts, carried to this beta's
//    runnerBudget signature, and their unseen cards read from the deck list less the public cards;
//  - playable: the largest single money event the Runner could play on the turn and still run, entered in
//    runnerEarnings by clicks (each reader of the hold count sees it);
//  - commit: playable's amount read by the agenda-commit question only (candidates.ts agendaMove); every other reader
//    of the hold count keeps the public budget;
//  - commitLine (not in the brief; this thread's, after the fixture): commit, and the two-turn scoring line's hold too
//    (lines.ts holdingSpend, read by scoreInTwo and lineHolds), the other reader that commits an agenda.
import { readFileSync, writeFileSync } from 'node:fs';

const hold = readFileSync('src/ai/corp/hold.ts', 'utf8');
const cand = readFileSync('src/ai/corp/candidates.ts', 'utf8');
const lines = readFileSync('src/ai/corp/lines.ts', 'utf8');

const LIB = `export const CHECK = { runnerExtra: 0 };

/**
 * ARM grip-money (exploit F2 count step, scripts/stage-d/grip-money-arms.mjs; never built). The money events the Runner
 * may hold, from its deck list less the public cards (10.2.2, 10.2.3; Jeff: the Normal AI may know both deck lists).
 * The deck list is every Runner card the AI's decklist helper counts (valueModel.ts sideCards); the public ones taken
 * off are the heap, the score area, the installed cards and every hosted card. Nothing here reads which hidden zone a
 * card is in or the stack's order; of the grip, only its size.
 *  - cost, gain: the play cost and the credits it gives; clicks: the clicks it takes from earning (Creative Commission
 *    2: it loses the next click when any remain; Overclock and Trick Shot 0: each is the run's own click, its hosted
 *    credits spent on that run); resource: Sell Out's additional cost, an installed resource trashed;
 *  - old: the 2026-11-18 arms' amount (credits over a click for a credit).
 * Wildcat Strike is the Corp's choice and Aircheck locks the pool: not money for a run on a remote.
 */
const GRIP_EVENTS: Record<string, { cost: number; gain: number; clicks: number; resource?: boolean; old: number }> = {
  '30030': { cost: 5, gain: 9, clicks: 1, old: 3 }, // Sure Gamble
  '30020': { cost: 1, gain: 5, clicks: 2, old: 2 }, // Creative Commission
  '34001': { cost: 1, gain: 4, clicks: 1, old: 2 }, // Strike Fund
  '36011': { cost: 1, gain: 4, clicks: 1, resource: true, old: 2 }, // Sell Out
  '30029': { cost: 1, gain: 5, clicks: 0, old: 4 }, // Overclock: 5 hosted, spent during its run
  '34087': { cost: 1, gain: 4, clicks: 0, old: 3 }, // Trick Shot: 4 hosted, its remote run after R&D's
};
/** on: the playable amount is in runnerEarnings; only: the events it may use (the measuring script's per-event ask). */
export const GRIP: { on: boolean; only: string[] | null } = { on: false, only: null };
export const withGrip = <T>(f: () => T): T => {
  const was = GRIP.on;
  GRIP.on = true;
  try {
    return f();
  } finally {
    GRIP.on = was;
  }
};
const unseenMemo = new WeakMap<GameState, Map<string, number>>();
/** The Runner's deck list less its public cards, by code (copies). */
export function unseenRunnerCards(s: GameState): Map<string, number> {
  const known = unseenMemo.get(s);
  if (known) return known;
  const m = new Map<string, number>();
  for (const c of sideCards(s, 'runner')) m.set(c.cardCode, (m.get(c.cardCode) ?? 0) + 1);
  const r = s.runner;
  const installed = [...r.rig.programs, ...r.rig.hardware, ...r.rig.resources];
  const corpInstalled = Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice]);
  const open = [...r.heap, ...r.scoreArea, ...installed, ...[...installed, ...corpInstalled].flatMap(c => c.hostedCards ?? [])];
  for (const c of open) {
    const k = m.get(c.cardCode) ?? 0;
    if (cardDef(c).side_code === 'runner' && k) m.set(c.cardCode, k - 1);
  }
  unseenMemo.set(s, m);
  return m;
}
/** The 2026-11-18 amounts: max, the largest old amount unseen (0 with an empty grip); odds, the expected best one in a grip of g drawn from the unseen cards (hypergeometric). */
export function gripMoney(s: GameState): { max: number; odds: number } {
  const g = s.runner.grip.length;
  const unseen = unseenRunnerCards(s);
  let n = 0;
  for (const k of unseen.values()) n += k;
  const byGain = new Map<number, number>();
  for (const [code, k] of unseen) {
    const e = GRIP_EVENTS[code];
    if (e && k && !(e.resource && !s.runner.rig.resources.length)) byGain.set(e.old, (byGain.get(e.old) ?? 0) + k);
  }
  if (!g || !byGain.size) return { max: 0, odds: 0 };
  const gains = [...byGain.keys()].sort((a, b) => b - a);
  const none = (k: number) => {
    let p = 1;
    for (let i = 0; i < g; i++) p *= Math.max(0, n - k - i) / (n - i);
    return p;
  };
  let odds = 0;
  let k = 0;
  let prev = 1;
  for (const m of gains) {
    k += byGain.get(m)!;
    const p = none(k);
    odds += m * (prev - p);
    prev = p;
  }
  return { max: gains[0], odds };
}
`;

const PLAYABLE = `/**
 * The playable amount by clicks: earn[k] (what k earning clicks make) becomes the best of earn[k] and, for each money
 * event unseen, the event played after the earning that its other clicks make: earn[k - clicks] + gain - cost, when the
 * credits it can reach then (its credits + earn[k - clicks]) pay its cost. One event at most. Sell Out reads the
 * earnings without the resource it trashes (the best one to lose).
 */
function withGripEvent(s: GameState, from: TurnFrom, base: number[]): number[] {
  if (!GRIP.on || !s.runner.grip.length) return base;
  let out = base;
  for (const [code, n] of unseenRunnerCards(s)) {
    const e = GRIP_EVENTS[code];
    if (!e || !n || (GRIP.only && !GRIP.only.includes(code))) continue;
    const r = s.runner;
    const bases = e.resource ? r.rig.resources.map(x => publicEarnings({ ...s, runner: { ...r, rig: { ...r.rig, resources: r.rig.resources.filter(y => y !== x) } } }, from)) : [base];
    for (const b of bases)
      for (let k = e.clicks; k < b.length; k++) {
        const before = b[k - e.clicks];
        if (from.credits + before < e.cost) continue;
        const v = before + e.gain - e.cost;
        if (v > out[k]) {
          if (out === base) out = base.slice();
          out[k] = v;
        }
      }
  }
  return out;
}
`;

const BUDGET = 'export const runnerBudget = (s: GameState, from: TurnFrom = nextTurn(s)): number => from.credits + runnerEarnings(s, from)[Math.max(0, from.clicks - 1)] + CHECK.runnerExtra;';
const EARN = 'export function runnerEarnings(s: GameState, from: TurnFrom = nextTurn(s)): number[] {';
const IMPORT = "import { memo } from '../valueModel';";
const CAND_IMPORT = "import { serverHold } from './hold';";
const CAND_ASK = "  const hold = server ? serverHold(after, server, { when: 'runnerTurn', corpCredits: after.corp.credits }) : null;";

const once = (text, s, where) => {
  if (text.split(s).length !== 2) throw new Error(`not once in ${where}: ${s.slice(0, 70)}`);
  return s;
};
const H = 'ai/corp/hold.ts';
const C = 'ai/corp/candidates.ts';
const L = 'ai/corp/lines.ts';
const LINE_ASK = "  const h = serverHold(state, server, { when: 'runnerTurn', corpCredits: credits });";
const out = {
  lib: [
    [H, once(hold, IMPORT, H), "import { memo, sideCards } from '../valueModel';"],
    [H, once(hold, 'export const CHECK = { runnerExtra: 0 };\n', H), LIB],
  ],
  max: [[H, once(hold, BUDGET, H), BUDGET.replace('+ CHECK.runnerExtra;', '+ CHECK.runnerExtra + gripMoney(s).max;')]],
  odds: [[H, once(hold, BUDGET, H), BUDGET.replace('+ CHECK.runnerExtra;', '+ CHECK.runnerExtra + gripMoney(s).odds;')]],
  earn: [[H, once(hold, EARN, H), `${PLAYABLE}\n${EARN}\n  return withGripEvent(s, from, publicEarnings(s, from));\n}\n\n/** runnerEarnings as beta has it (the public money). */\nfunction publicEarnings(s: GameState, from: TurnFrom = nextTurn(s)): number[] {`]],
  on: [[H, 'export const GRIP: { on: boolean; only: string[] | null } = { on: false, only: null };', 'export const GRIP: { on: boolean; only: string[] | null } = { on: true, only: null };']],
  commitRead: [
    [C, once(cand, CAND_IMPORT, C), "import { serverHold, withGrip } from './hold';"],
    [C, once(cand, CAND_ASK, C), CAND_ASK.replace('serverHold(after, server, {', 'withGrip(() => serverHold(after, server, {').replace('}) : null;', '})) : null;')],
  ],
  // The two-turn scoring line's hold (lines.ts holdingSpend: scoreInTwo and lineHolds), the other agenda-commit reader
  lineRead: [
    [L, once(lines, CAND_IMPORT, L), "import { serverHold, withGrip } from './hold';"],
    [L, once(lines, LINE_ASK, L), LINE_ASK.replace('serverHold(state, server, {', 'withGrip(() => serverHold(state, server, {').replace('});', '}));')],
  ],
  _arms: {
    control: [],
    f2max: ['lib', 'max'],
    f2odds: ['lib', 'odds'],
    playable: ['lib', 'earn', 'on'],
    commit: ['lib', 'earn', 'commitRead'],
    // Not in the brief (added by this thread, found on the fixture): commit plus the two-turn line's reader
    commitLine: ['lib', 'earn', 'commitRead', 'lineRead'],
  },
};
writeFileSync('scripts/stage-d/grip-money-arms.json', JSON.stringify(out, null, 1) + '\n');
console.log('wrote scripts/stage-d/grip-money-arms.json', Object.keys(out._arms).join(', '));
