/**
 * Stage D rez-set build (brief: /mnt/project-files/netrunner-ai/stage-d/rez-follow/build-brief.md, tests 1, 2 and 4):
 * writes the boards of the counted rez windows as test fixtures (tests/fixtures/rez-set/), each the state at a Corp
 * approach-ice rez window. A local deal is played by this checkout's Normal agents (GameRunner, as rez-follow.ts plays
 * it); a human game is replayed from its recorded moves (as rez-follow.ts replays it). Run on the tree BEFORE the change
 * (the deal's play must be the recorded one).
 * WANT: src:turn:ice[:n], comma list; src `deal:<seed>` or `human:<report file>`; ice an instance id or a card title;
 * n the n-th such window in that turn (default 0).
 *   WANT=deal:1081:16:inst-24,deal:1641:18:inst-42,human:report-28.json:16:Boto npx vite-node scripts/stage-d/rez-follow-capture.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, wantsStop } from '../../src/core';
import { createAgent } from '../../src/ai';
import { GameRunner, rezCandidates } from '../../src/ai/playout';
import { dealState } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';
import { isRezWindow } from './rez-follow-lib';

const OUT = 'tests/fixtures/rez-set';
mkdirSync(OUT, { recursive: true });
const wants = (process.env.WANT ?? '').split(',').filter(Boolean).map(w => {
  const [kind, src, t, ice, n] = w.split(':');
  return { src: `${kind}:${src}`, T: Number(t), ice, n: Number(n ?? 0) };
});
const seen = new Map<string, number>();

function check(src: string, s: GameState) {
  const run = s.activeRun;
  if (!run || run.icePosition === null || run.phase !== 'approach_ice') return;
  const ice: CardInstance | undefined = s.corp.servers[run.server]?.ice[run.icePosition];
  if (!ice || ice.isRezzed) return;
  for (const w of wants) {
    if (w.src !== src || w.T !== s.turnNumber || (w.ice !== ice.instanceId && w.ice !== cardDef(ice).title)) continue;
    const k = `${src}:${w.T}:${w.ice}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    if (n !== w.n) continue;
    const out = `${OUT}/${src.replace(/^deal:/, 'deal-').replace(/^human:/, '').replace(/\.json$/, '')}-t${w.T}-${ice.instanceId}.json`;
    writeFileSync(out, JSON.stringify(s));
    console.log(`${out}: ${cardDef(ice).title} on ${run.server} pos ${run.icePosition}; Corp ${s.corp.credits}, Runner ${s.runner.credits}`);
  }
}

for (const src of [...new Set(wants.map(w => w.src))]) {
  const last = Math.max(...wants.filter(w => w.src === src).map(w => w.T));
  if (src.startsWith('deal:')) {
    // The game's own windows only (the planner's look-ahead asks chooseRez of boards that are not played)
    const game = new GameRunner(dealState(Number(src.slice(5))), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    for (let k = 0; k < 4000 && game.state.turnNumber <= last; k++) {
      const s = game.state;
      if (isRezWindow(s, wantsStop) && rezCandidates(structuredClone(s), s.priority!.step).length) check(src, s);
      if (!game.step()) break;
    }
  } else {
    const report = JSON.parse(readFileSync(`tests/fixtures/human-games/${src.slice(6)}`, 'utf8'));
    let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    for (const move of report.moves as GameAction[]) {
      if (s.turnNumber > last || s.winner) break;
      if (isRezWindow(s, wantsStop) && rezCandidates(structuredClone(s), s.priority!.step).length) check(src, s);
      s = executeAction(s, move);
    }
  }
}
