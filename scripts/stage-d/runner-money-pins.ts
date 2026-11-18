/**
 * Stage D item 1 follow-up 4, step 1.4 (brief section 2.4): the two exploit pins (tests/exploitPins.test.ts, F1 and F2)
 * asked in beta and in each Runner-money arm's tree (runner-money-trees.ts), the pins' own bodies: F1 the toll rez on HQ
 * (passes when the Corp does not rez the Palisade); F2 the Corp's turn on (passes when no agenda is left in remote-1).
 *
 *   npx vite-node scripts/stage-d/runner-money-pins.ts
 */
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameState, cardDef } from '../../src/core';
import { makeTrees, readArms } from './runner-money-trees';

const file = readArms();
const root = resolve('.rm-pins');
const dirs = { beta: resolve('.'), ...makeTrees(file, root) } as Record<string, string>;
const fixture = (name: string): GameState => JSON.parse(readFileSync(resolve('tests/fixtures/adversarial', `${name}.json`), 'utf8'));

for (const [t, dir] of Object.entries(dirs)) {
  const ai = await import(/* @vite-ignore */ join(dir, 'src', 'ai/index.ts'));
  const po = await import(/* @vite-ignore */ join(dir, 'src', 'ai/playout.ts'));
  const s1 = fixture('stage-c-f1-hq-toll-rez');
  const ice = s1.corp.servers.hq.ice[s1.activeRun!.icePosition!];
  const a = ai.createAgent('corp', 'normal').chooseRez(s1, po.rezCandidates(s1, 'approach_ice'));
  const f1 = !(a?.type === 'REZ_CARD' && a.cardInstanceId === ice.instanceId);
  const s2 = fixture('stage-c-f2-grip-money');
  const g = new po.GameRunner(s2, { corp: ai.createAgent('corp', 'normal'), runner: ai.createAgent('runner', 'normal') });
  const moves: string[] = [];
  for (let i = 0; i < 100 && g.state.activePlayer === 'corp' && !g.state.winner; i++) {
    const before = g.state;
    if (!g.step()) break;
    const last = g.state.log?.[g.state.log.length - 1];
    if (g.state !== before && last) moves.push(String(last.message ?? last).slice(0, 60));
  }
  const rootCards = (g.state.corp.servers['remote-1']?.root ?? []) as GameState['corp']['hq'];
  const f2 = !rootCards.some(c => cardDef(c).type_code === 'agenda');
  console.log(JSON.stringify({ tree: t, F1: f1 ? 'pass' : 'fail', F2: f2 ? 'pass' : 'fail', remote1: rootCards.map(c => cardDef(c).title), corpTurn: moves.slice(0, 8) }));
}
rmSync(root, { recursive: true, force: true });
