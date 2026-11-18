/**
 * ai-make-room (brief: /mnt/project-files/netrunner-ai/stage-d/small-fixes/ai-make-room/brief.md, stops): how far every
 * recorded human game in tests/fixtures/human-games/ replays on this checkout's engine and on BASE's (default
 * origin/beta, a copy of its src/ loaded as its own module graph). A file with `startsAt: 'state'` (report-40b, 40c) is
 * replayed from its `state`, else from its `config`. A file that stops earlier on this engine than on the base is a stop
 * by the brief, unless it is the make-room fault the split removed.
 *
 * Then the files named by HARNESS (prefix match, default report-40) are replayed again through scripts/stage-a/harness.ts
 * replayHuman, the Stage D fire scripts' loader (it asks a fresh Corp at each Corp state, so it is slow): the moves it
 * replays must equal this engine's count.
 *
 *   npx vite-node scripts/stage-d/make-room-replays.ts
 *   HARNESS=none npx vite-node scripts/stage-d/make-room-replays.ts
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { replayHuman } from '../stage-a/harness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE ?? 'origin/beta';
const DIR = 'tests/fixtures/human-games';

function reach(report: any, create: any, setup: any, execute: any): { n: number; error?: string } {
  let s: GameState;
  if (report.startsAt === 'state') s = structuredClone(report.state);
  else {
    s = create(setup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
  }
  const moves = report.moves as GameAction[];
  for (let i = 0; i < moves.length; i++) {
    try {
      s = execute(s, moves[i]);
    } catch (e) {
      return { n: i, error: (e as Error).message };
    }
  }
  return { n: moves.length };
}

async function main() {
  const sha = execSync(`git rev-parse ${BASE}`).toString().trim();
  const root = resolve(process.env.TROOT ?? 'node_modules/.cache/mr-trees', `replays-${sha.slice(0, 12)}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  execSync(`git archive ${sha} src | tar -x -C ${root}`);
  const core = await import(/* @vite-ignore */ join(root, 'src/core/index.ts'));
  const decks = await import(/* @vite-ignore */ join(root, 'src/data/decks.ts'));
  let shorter = 0;
  const mineOf: Record<string, number> = {};
  for (const f of readdirSync(DIR).filter(x => x.endsWith('.json')).sort()) {
    const report = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    if (!report.moves?.length) continue;
    const mine = reach(report, createInitialGameState, deckGameSetup, executeAction);
    mineOf[f] = mine.n;
    const base = reach(report, core.createInitialGameState, decks.deckGameSetup, core.executeAction);
    const flag = mine.n < base.n ? 'SHORTER' : mine.n > base.n ? 'longer' : '';
    if (mine.n < base.n) shorter++;
    console.log(`${f}\t${report.moves.length}\tthis ${mine.n}\tbase ${base.n}\t${flag}${mine.error && mine.n < report.moves.length ? `\tthis: ${mine.error.slice(0, 90)}` : ''}${base.error && base.n < report.moves.length ? `\tbase: ${base.error.slice(0, 90)}` : ''}`);
  }
  console.log(`files that stop earlier on this engine than on ${sha.slice(0, 7)}: ${shorter}`);
  const want = (process.env.HARNESS ?? 'report-40').split(',').filter(w => w && w !== 'none');
  let off = 0;
  for (const f of Object.keys(mineOf).filter(x => want.some(w => x.startsWith(w)))) {
    const n = replayHuman(join(DIR, f), {});
    if (n !== mineOf[f]) off++;
    console.log(`replayHuman ${f}: ${n} moves (this engine ${mineOf[f]})${n === mineOf[f] ? '' : ' DIFFERS'}`);
  }
  if (want.length) console.log(`replayHuman differs from this engine on ${off} files`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
