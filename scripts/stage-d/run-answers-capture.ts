/**
 * Follow-up 3 pins: writes the boards of the pinned decisions as test fixtures (tests/fixtures/run-answers/), each the
 * state at a Corp prompt during a run in a local deal played by the Normal agents of BETA (the play the counts read).
 * WANT: deal:turn:cardCode[:n] (n-th such prompt in that turn, default 0), comma list.
 *   ARGS="BETA=<sha>" WANT=1601:12:30062,2873:8:30062 npx vite-node scripts/stage-d/run-answers-capture.ts
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import type { Agent } from '../../src/ai/agent';

const ARGS = `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`;
const sha = /BETA=([0-9a-f]{40})/.exec(ARGS)![1];
const dir = resolve('.ra-tree', sha);
if (!existsSync(join(dir, 'src'))) {
  mkdirSync(dir, { recursive: true });
  execSync(`git archive ${sha} src | tar -x -C ${dir}`);
}
const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
const core = await m('core/index.ts');
const ai = await m('ai/index.ts');
const playout = await m('ai/playout.ts');
const hv = await m('ai/handValues.ts');
const ev = await m('ai/effectValues.ts');
const vm = await m('ai/valueModel.ts');
const d = await m('data/decks.ts');
const nsg = await m('data/testDecks/nsgSamples.ts');
const ALL = [...d.STARTER_DECKS, ...nsg.NSG_SAMPLE_DECKS];
const clear = () => {
  hv.clearHandCaches();
  ev.clearDamageThreats();
};
const wants = (process.env.WANT ?? '').split(',').filter(Boolean).map(w => w.split(':'));
for (const seed of [...new Set(wants.map(w => Number(w[0])))]) {
  vm.valueLoops.clear();
  const corpDecks = ALL.filter((x: { side: string }) => x.side === 'corp');
  const runnerDecks = ALL.filter((x: { side: string }) => x.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  const start: GameState = core.createInitialGameState(d.deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length]));
  const seen = new Map<string, number>();
  const corpIn = ai.createAgent('corp', 'normal') as Agent;
  const runnerIn = ai.createAgent('runner', 'normal') as Agent;
  const corp = {
    side: 'corp',
    chooseAction(s: GameState) {
      clear();
      const pr = core.activePrompt(s);
      if (pr && pr.side === 'corp' && s.activeRun && 'source' in pr) {
        const k = `${s.turnNumber}:${pr.source.cardCode}`;
        const n = seen.get(k) ?? 0;
        seen.set(k, n + 1);
        for (const w of wants) {
          if (Number(w[0]) === seed && `${w[1]}:${w[2]}` === k && Number(w[3] ?? 0) === n) {
            const out = `tests/fixtures/run-answers/deal-${seed}-t${w[1]}-${w[2]}${w[3] ? '-' + w[3] : ''}.json`;
            writeFileSync(out, JSON.stringify(s));
            console.log(`${out}: ${pr.source.step} options ${JSON.stringify((pr as { options?: { id: string }[] }).options?.map(o => o.id))}`);
          }
        }
      }
      return corpIn.chooseAction(s);
    },
    chooseRez(s: GameState, cards: unknown) {
      clear();
      return corpIn.chooseRez?.(s, cards as never) ?? null;
    },
  } as Agent;
  const runner = {
    side: 'runner',
    chooseAction(s: GameState) {
      clear();
      return runnerIn.chooseAction(s);
    },
    chooseOffTurn(s: GameState) {
      clear();
      return runnerIn.chooseOffTurn?.(s) ?? null;
    },
  } as Agent;
  const game = new playout.GameRunner(start, { corp, runner });
  for (let k = 0; k < 4000 && game.step(); k++) if (game.state.turnNumber > Math.max(...wants.filter(w => Number(w[0]) === seed).map(w => Number(w[1])))) break;
}
