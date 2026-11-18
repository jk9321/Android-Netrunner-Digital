/**
 * ai-make-room (brief: /mnt/project-files/netrunner-ai/stage-d/small-fixes/ai-make-room/brief.md, "Split report-40"):
 * splits Jeff's recorded game report-40 at the moves the make-room rules fix (rules 8.5.6c, 3.9.3b; c6c6de4) makes
 * illegal, and checks the split.
 *
 * Twice the human Runner answered Madani's install (moves[162], moves[176]) with Chromatophores over a full memory and no
 * program trashed first (moves[163], moves[177]). The engine of record (beta's src, before c6c6de4) spent Madani and
 * installed nothing; the fixed engine refuses that answer, so every replay of the file stopped at moves[163]. Rules
 * 8.5.6c: "When installing a program, the Runner may first trash any number of programs already installed. They must do
 * so if installing the new program would exceed their memory limit."
 *
 * The cuts are found by replaying on this checkout's engine; any refusal that is not this fault throws (a stop).
 *  - report-40.json keeps moves[0..161] (it ends before the first Madani use). Its other fields are kept (its `state` is
 *    still the original final state); a `note` says why.
 *  - report-40b.json, report-40c.json: the same `config`; `state` = the state after the refused answer as the engine of
 *    record computes it; `moves` = the original moves from there to the next Madani use (or the end); `startsAt: 'state'`
 *    (a reader replays its moves from `state`, not from `config`); `firstMove` = the original index of its moves[0]; a
 *    `note` with the rule and the SHA that computed the state. No trash set is picked for the human and no move is edited.
 *
 * The original file is read from git (ORIG, default the beta commit before the split) and the engine of record is a copy
 * of BASE's src/ (default origin/beta) under TROOT, loaded as its own module graph.
 *
 *   npx vite-node scripts/stage-d/make-room-split.ts            # write the files, then check
 *   CHECK=1 npx vite-node scripts/stage-d/make-room-split.ts    # check only
 *
 * The check (the brief's bar 3): each part replays all its moves on this checkout's engine, and after every move the
 * state on this engine equals the state after the same move of the original file on the engine of record (a stable
 * serialisation: keys sorted; nothing excluded unless EXCLUDE names top-level state keys).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { createInitialGameState as newCreate, executeAction as newExecute } from '../../src/core';
import { deckGameSetup as newSetup } from '../../src/data/decks';

const BASE = process.env.BASE ?? 'origin/beta';
const ORIG = process.env.ORIG ?? '0dd09303bdf734f13dabd447692a8b1d6aa4a06c:tests/fixtures/human-games/report-40.json';
const DIR = 'tests/fixtures/human-games';
const CUT_KEEP = 162; // moves[0..161] stay in report-40 (the first cut; later ones are found by replaying)
const EXCLUDE = new Set((process.env.EXCLUDE ?? '').split(',').filter(Boolean));

/* eslint-disable @typescript-eslint/no-explicit-any */
function stable(x: any): any {
  if (Array.isArray(x)) return x.map(stable);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])]));
  return x;
}
const ser = (s: GameState) => JSON.stringify(stable(Object.fromEntries(Object.entries(s).filter(([k]) => !EXCLUDE.has(k)))));

async function baseEngine() {
  const sha = execSync(`git rev-parse ${BASE}`).toString().trim();
  const root = resolve(process.env.TROOT ?? 'node_modules/.cache/mr-trees', sha.slice(0, 12));
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  execSync(`git archive ${sha} src | tar -x -C ${root}`);
  const core = await import(/* @vite-ignore */ join(root, 'src/core/index.ts'));
  const decks = await import(/* @vite-ignore */ join(root, 'src/data/decks.ts'));
  return { sha, create: core.createInitialGameState, execute: core.executeAction, setup: decks.deckGameSetup };
}

/** The states after each move of `moves` (index i = the state after moves[i]), stopping at the first refused move. */
function replay(start: GameState, moves: GameAction[], execute: (s: GameState, a: GameAction) => GameState): { states: GameState[]; stoppedAt: number | null; error?: string } {
  const states: GameState[] = [];
  let s = start;
  for (let i = 0; i < moves.length; i++) {
    try {
      s = execute(s, moves[i]);
    } catch (e) {
      return { states, stoppedAt: i, error: (e as Error).message };
    }
    states.push(s);
  }
  return { states, stoppedAt: null };
}

async function main() {
  const orig = JSON.parse(execSync(`git show ${ORIG}`, { maxBuffer: 1 << 28 }).toString());
  const base = await baseEngine();
  const moves = orig.moves as GameAction[];
  const start = (create: any, setup: any): GameState => {
    const s = create(setup(orig.config.seed, orig.config.corpDeck, orig.config.runnerDeck));
    return orig.startStops ? { ...s, stops: orig.startStops } : s;
  };
  // The engine of record plays the whole original file
  const rec = replay(start(base.create, base.setup), moves, base.execute);
  console.log(`engine of record ${base.sha.slice(0, 7)}: ${rec.states.length} of ${moves.length} moves${rec.stoppedAt === null ? '' : `, refused moves[${rec.stoppedAt}]: ${rec.error}`}`);
  if (rec.stoppedAt !== null) throw new Error('the engine of record does not replay the whole original file');
  // This checkout's engine on the original file: where it stops (expected: moves[163])
  const now = replay(start(newCreate, newSetup), moves, newExecute);
  console.log(`this engine on the original file: ${now.states.length} of ${moves.length} moves${now.stoppedAt === null ? '' : `, refused moves[${now.stoppedAt}]: ${now.error}`}`);
  // Before the cut both engines agree move for move
  let firstDiff = -1;
  for (let i = 0; i < Math.min(CUT_KEEP, now.states.length); i++) {
    if (ser(now.states[i]) !== ser(rec.states[i])) {
      firstDiff = i;
      break;
    }
  }
  console.log(`moves[0..${CUT_KEEP - 1}]: ${firstDiff < 0 ? 'the same state after every move on both engines' : `first different state after moves[${firstDiff}]`}`);

  // Each segment replays on this engine from its start until a refused move. A refused move must be this fault (a
  // Runner's install answer refused by rules 8.5.6c, right after the Madani use it answers); the segment ends before
  // that ability and the next one starts from the engine of record's state after the refused answer
  const segs: { from: number; to: number }[] = [];
  let at = 0;
  let s0: GameState = start(newCreate, newSetup);
  for (;;) {
    const r = replay(structuredClone(s0), moves.slice(at), newExecute);
    if (r.stoppedAt === null) {
      segs.push({ from: at, to: moves.length });
      break;
    }
    const i = at + r.stoppedAt;
    const ability = moves[i - 1];
    if (!/rules 8\.5\.6c/.test(r.error ?? '') || moves[i].type !== 'RESOLVE_PROMPT' || moves[i].player !== 'runner' || ability.type !== 'USE_ABILITY') throw new Error(`STOP: moves[${i}] refused for another reason: ${r.error}`);
    segs.push({ from: at, to: i - 1 });
    console.log(`refused moves[${i}] (${r.error}); moves[${i - 1}] is the ability it answers`);
    at = i + 1;
    s0 = rec.states[i];
  }
  const names = segs.map((_, k) => `report-40${k === 0 ? '' : String.fromCharCode(97 + k)}.json`);
  const cuts = segs.slice(1).map(g => `moves[${g.from - 2}..${g.from - 1}]`).join(' and ');
  const noteFor = (k: number) =>
    k === 0
      ? `Cut before moves[${segs[0].to}] (ai-make-room, scripts/stage-d/make-room-split.ts): ${cuts} (Madani, then Chromatophores installed over a full memory with no program trashed first) are illegal under rules 8.5.6c since c6c6de4; the rest of the game is ${names.slice(1).join(', ')}. 'state' is the original report's final state.`
      : `Part of report-40 (ai-make-room, scripts/stage-d/make-room-split.ts): 'state' is the state after the original file's moves[${segs[k].from - 1}], computed by the engine of record (src at ${base.sha}, before c6c6de4), and 'moves' are the original moves[${segs[k].from}..${segs[k].to - 1}]. moves[${segs[k].from - 2}] used Madani and moves[${segs[k].from - 1}] answered it with Chromatophores over a full memory and no program trashed first; that engine spent Madani and installed nothing. Rules 8.5.6c ("They must do so if installing the new program would exceed their memory limit") makes that answer illegal, so the file is split instead of picking a trash set for the human. Replay 'moves' from 'state' (startsAt), not from 'config'; firstMove is the original index of moves[0].`;
  if (!process.env.CHECK) {
    segs.forEach((g, k) => {
      const out = k === 0 ? { ...orig, moves: moves.slice(g.from, g.to), note: noteFor(0) } : { config: orig.config, startsAt: 'state', firstMove: g.from, note: noteFor(k), state: rec.states[g.from - 1], moves: moves.slice(g.from, g.to) };
      writeFileSync(join(DIR, names[k]), JSON.stringify(out, null, 2) + '\n');
      console.log(`wrote ${names[k]}: original moves[${g.from}..${g.to - 1}] (${g.to - g.from} moves)`);
    });
  }

  // The check, read back from the files
  let ok = firstDiff < 0;
  segs.forEach((g, k) => {
    const f = JSON.parse(readFileSync(join(DIR, names[k]), 'utf8'));
    const sameMoves = JSON.stringify(f.moves) === JSON.stringify(moves.slice(g.from, g.to));
    const from: GameState = k === 0 ? start(newCreate, newSetup) : f.state;
    const startOk = k === 0 || ser(f.state) === ser(rec.states[g.from - 1]);
    const mine = replay(structuredClone(from), f.moves, newExecute);
    let differ = 0;
    let first: number | null = null;
    for (let j = 0; j < mine.states.length; j++) {
      if (ser(mine.states[j]) !== ser(rec.states[g.from + j])) {
        differ++;
        first ??= j;
      }
    }
    console.log(`${names[k]}: recorded moves unchanged ${sameMoves}; start = the engine of record's state ${startOk}; replays ${mine.states.length} of ${f.moves.length} moves on this engine${mine.stoppedAt === null ? '' : `, refused moves[${mine.stoppedAt}]: ${mine.error}`}; the state after each move equals the engine of record's after the same original move: ${mine.states.length - differ} of ${mine.states.length}${first === null ? '' : `, first differs at moves[${first}] (original moves[${g.from + first}])`}`);
    ok &&= sameMoves && startOk && mine.stoppedAt === null && differ === 0;
  });
  console.log(`excluded keys: ${[...EXCLUDE].join(',') || 'none'}`);
  console.log(ok ? 'CHECK OK' : 'CHECK FAILED');
  if (!ok) process.exitCode = 1;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
