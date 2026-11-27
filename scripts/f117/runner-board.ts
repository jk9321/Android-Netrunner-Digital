/**
 * F117 departures (the Runner rework coordinator's read): a Runner prompt board from the departures count (pool:seed:step),
 * played to that step by PLAYER's tree (the count's branch, 7de6b2e) as count.ts MODE=step0 plays it (fresh agents). On
 * that board: each tree's pick (fresh agents), each answer's score in both trees (scoreAnswer in the Runner's frame,
 * no memory), for a card leaving the grip the owner's price against the count's and its half keep; then the rest of the
 * turn played from that board by each tree's agents.
 *   ARGS="BOARDS=batch:2781:49 PLAYER=7de6b2e2057ed692bade2e8794703c9e46fd0dc3" npx vite-node scripts/f117/runner-board.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { loadTree } from '../runner-rework/facts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '88b9f75faddea95254e57a79380e37a573509026';
const BOARDS = (process.env.BOARDS ?? 'batch:2781:49').split(',').map(b => b.split(':'));
const root = resolve('node_modules/.cache/f117-runner-board');
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
const files: Record<string, string> = { batch: 'scripts/f117/recs/deals-45940481387.json', nrdb: 'scripts/runner-rework/facts-deals-45458221138.json' };
const r2 = (x: number) => Math.round(x * 100) / 100;

async function tree(name: string, sha: string) {
  mkdirSync(join(root, name), { recursive: true });
  execSync(`git archive ${sha} src | tar -x -C ${join(root, name)}`);
  const t: any = await loadTree(name, join(root, name));
  t.prompts = await import(/* @vite-ignore */ join(root, name, 'src', 'ai/prompts.ts'));
  return t;
}

async function main() {
  rmSync(root, { recursive: true, force: true });
  const base = await tree('base', BASE);
  const player = process.env.PLAYER ? await tree('player', process.env.PLAYER) : null;
  const branch: any = await loadTree('branch', resolve('.'));
  branch.prompts = await import('../../src/ai/prompts');
  for (const [pool, seedS, stepS] of BOARDS) {
    const d = (JSON.parse(readFileSync(files[pool], 'utf8')) as any[]).find(x => String(x.seed) === seedS);
    const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck)!;
    const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck)!;
    const P = player ?? branch;
    const g = new P.GameRunner(P.core.createInitialGameState(P.decks.deckGameSetup(d.seed, c, r)), { corp: P.createAgent('corp', 'normal'), runner: P.createAgent('runner', 'normal') });
    for (let i = 0; i < Number(stepS); i++) g.step();
    const s: any = structuredClone(g.state);
    const C = branch.core;
    const name = (st: any, id: string) => (C.findCardAnywhere(st, id) ? C.cardDef(C.findCardAnywhere(st, id)).title : id);
    const label = (st: any, a: any) => (a?.type === 'RESOLVE_PROMPT' ? (a.choice.cardInstanceIds ? (a.choice.cardInstanceIds.length ? `install ${a.choice.cardInstanceIds.map((id: string) => name(st, id)).join(',')}` : 'decline') : JSON.stringify(a.choice)) : `${a?.type} ${a?.cardInstanceId ? name(st, a.cardInstanceId) : a?.targetServerId ?? ''}`);
    const p: any = C.activePrompt(s);
    console.log(`\n== ${pool} ${seedS} step ${stepS} T${s.turnNumber} ${s.activePlayer}: ${p?.source?.cardCode}:${p?.source?.step} "${p?.message}"; grip ${s.runner.grip.map((x: any) => name(s, x.instanceId)).join(', ')}; credits ${s.runner.credits}, clicks ${s.runner.clicks}`);
    console.log(`   picks: base ${label(s, base.createAgent('runner', 'normal').chooseAction(structuredClone(s)))}, branch ${label(s, branch.createAgent('runner', 'normal').chooseAction(structuredClone(s)))}`);
    for (const T of [base, branch]) {
      T.handValues.inDecision(s, 'runner', () => {
        for (const a of T.core.getLegalActions(s, 'runner').filter((x: any) => x.type === 'RESOLVE_PROMPT')) {
          const after = T.prompts.simulate(s, a);
          if (!after) continue;
          const score = T.prompts.withChainWork(s, (at: any) => T.prompts.scoreAnswer(s, p, a, after, 'runner', undefined, false, at));
          const left = s.runner.grip.filter((x: any) => !after.runner.grip.some((y: any) => y.instanceId === x.instanceId));
          let extra = '';
          if (left.length) {
            const without = { ...s, runner: { ...s.runner, grip: s.runner.grip.filter((x: any) => !left.includes(x)) } };
            const back = { ...after, runner: { ...after.runner, grip: [...after.runner.grip, ...left] } };
            const owner = T.handValues.ownHandValue(s, 'runner') - T.handValues.ownHandValue(without, 'runner');
            const count = T.evaluate.handCount(back, 'runner', 'runner') - T.evaluate.handCount(after, 'runner', 'runner');
            const keep = 0.5 * left.reduce((n: number, x: any) => n + T.evaluate.keepValue(s, x), 0);
            extra = `; leaving ${left.map((x: any) => name(s, x.instanceId)).join(',')}: owner ${r2(owner)}, count ${r2(count)}, half keep ${r2(keep)}`;
          }
          console.log(`   ${T.name} ${label(s, a)}: ${r2(score)} (evaluate ${r2(T.evaluate.evaluate(after, 'runner'))}${extra})`);
        }
      });
    }
    // The rest of the turn from this board, each tree's agents
    for (const T of [base, branch]) {
      const h = new T.GameRunner(structuredClone(s), { corp: T.createAgent('corp', 'normal'), runner: T.createAgent('runner', 'normal') });
      const turn = h.state.turnNumber;
      const seen: string[] = [];
      for (let k = 0; k < 400 && h.state.turnNumber === turn && !h.state.winner; k++) {
        const before = h.state;
        if (!h.step()) break;
        if (h.last?.player === 'runner') seen.push(label(before, h.last));
      }
      console.log(`   ${T.name} turn: ${seen.join(' | ')}; ends grip ${h.state.runner.grip.length}, credits ${h.state.runner.credits}, rig ${[...h.state.runner.rig.hardware, ...h.state.runner.rig.resources].map((x: any) => name(h.state, x.instanceId)).join(', ')}`);
    }
  }
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
