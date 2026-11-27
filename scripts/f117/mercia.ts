/**
 * F117 step 0 ruling (ruling-redteam.md, "Build step 0, ruled", item 3): Mercia B4LL4RD boards where the branch declines
 * the install base made. Plays the deal with the branch's agents (as count.ts MODE=step0) to the recorded step, then on
 * that board prices both answers: the branch's scoreAnswer (its chain followed to the end board) with the end boards'
 * terms (evaluate's Corp and Runner sides, the Corp's hand, board, credits and the rest), and base's (BASE tree) today's
 * one-step score of each answer, as base's fallback scored them.
 *   ARGS="BOARDS=batch:1731:169,batch:1771:258,batch:1691:79" npx vite-node scripts/f117/mercia.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { loadTree } from '../runner-rework/facts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? 'b4c26a9a0d6ea81f0387e19c4a7bb39228e832e0';
const BOARDS = (process.env.BOARDS ?? 'batch:1731:169').split(',').map(b => b.split(':'));
const root = resolve('node_modules/.cache/f117-mercia');
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
const files: Record<string, string> = { batch: 'scripts/f117/recs/deals-45940481387.json', nrdb: 'scripts/runner-rework/facts-deals-45458221138.json' };
const r2 = (x: number) => Math.round(x * 100) / 100;

async function main() {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'base'), { recursive: true });
  execSync(`git archive ${BASE} src | tar -x -C ${join(root, 'base')}`);
  const base: any = await loadTree('base', join(root, 'base'));
  base.prompts = await import(/* @vite-ignore */ join(root, 'base', 'src', 'ai/prompts.ts'));
  const B: any = {
    core: await import('../../src/core'),
    decks: await import('../../src/data/decks'),
    ai: await import('../../src/ai'),
    po: await import('../../src/ai/playout'),
    prompts: await import('../../src/ai/prompts'),
    ev: await import('../../src/ai/evaluate'),
    hv: await import('../../src/ai/handValues'),
  };
  for (const [pool, seedS, stepS] of BOARDS) {
    const d = (JSON.parse(readFileSync(files[pool], 'utf8')) as any[]).find(x => String(x.seed) === seedS);
    const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck)!;
    const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck)!;
    const g = new B.po.GameRunner(B.core.createInitialGameState(B.decks.deckGameSetup(d.seed, c, r)), { corp: B.ai.createAgent('corp', 'normal'), runner: B.ai.createAgent('runner', 'normal') });
    for (let i = 0; i < Number(stepS); i++) g.step();
    const s: GameState = g.state;
    const p: any = B.core.activePrompt(s);
    if (p?.source?.cardCode !== '35045') {
      console.log(`${pool} ${seedS} step ${stepS}: not a Mercia prompt (${p?.source?.cardCode}:${p?.source?.step})`);
      continue;
    }
    const answers: GameAction[] = B.core.getLegalActions(s, 'corp').filter((a: any) => a.type === 'RESOLVE_PROMPT');
    const name = (id: string) => B.core.cardDef(B.core.findCardAnywhere(s, id)).title;
    const label = (a: any) => (a.choice.cardInstanceIds.length ? `install ${a.choice.cardInstanceIds.map(name).join(',')}` : 'decline');
    const terms = (board: GameState) => {
      const corp = B.ev.sideStrength(board, 'corp', 'corp');
      const hand = B.ev.handAndClicks(board, 'corp', 'corp');
      const cbv = B.ev.corpBoardValue(board, 'corp');
      return { evaluate: r2(B.ev.evaluate(board, 'corp')), corp: r2(corp), hand: r2(hand), board: r2(cbv), creditsEtc: r2(corp - hand - cbv), runner: r2(B.ev.sideStrength(board, 'runner', 'corp')), credits: board.corp.credits };
    };
    console.log(`\n== ${pool} ${seedS} step ${stepS} T${s.turnNumber}: ${p.message}; HQ ${s.corp.hq.length}, credits ${s.corp.credits}; Mercia in ${Object.values(s.corp.servers).find((sv: any) => sv.root.some((x: any) => x.cardCode === '35045'))?.id}`);
    console.log(`   picks: base ${label(base.createAgent('corp', 'normal').chooseAction(structuredClone(s)))}, branch ${label(B.ai.createAgent('corp', 'normal').chooseAction(structuredClone(s)))}`);
    B.hv.inDecision(s, 'corp', () => {
      for (const a of answers) {
        const after = B.prompts.simulate(s, a);
        const score = B.prompts.withChainWork(s, (at: any) => B.prompts.scoreAnswer(s, p, a, after, 'corp', undefined, false, at, (x: number) => x + B.prompts.freeRezSaving(s, after)));
        // The chain's end board, as followChain walks it (the same source's next prompts, answered by the Corp)
        let end = after;
        const steps: string[] = [];
        for (let k = 0; k < 3 && B.core.activePrompt(end)?.source?.instanceId === p.source.instanceId; k++) {
          const next = B.prompts.answerPrompt(end, 'corp');
          steps.push(JSON.stringify(next.choice));
          end = B.prompts.simulate(end, next);
        }
        const where = (a as any).choice.cardInstanceIds.map((id: string) => Object.values(end.corp.servers).find((sv: any) => sv.ice.some((x: any) => x.instanceId === id))?.id ?? 'not installed');
        console.log(`   ${label(a)}: branch score ${r2(score)}; chain ${steps.join(' ') || '-'} -> ice on ${where.join(',') || '-'}; end board ${JSON.stringify(terms(end))}; one-step board ${JSON.stringify(terms(after))}, set aside ${(after.setAside ?? []).length}, HQ ${after.corp.hq.length}`);
      }
    });
    base.hv = await import(/* @vite-ignore */ join(root, 'base', 'src', 'ai/handValues.ts'));
    base.handValues.inDecision(s, 'corp', () => {
      for (const a of answers) {
        const after = base.prompts.simulate(s, a);
        console.log(`   base ${label(a)}: today's one-step score ${r2(base.prompts.scoreOutcome(s, after, 'corp') + base.prompts.freeRezSaving(s, after))} (evaluate ${r2(base.evaluate.evaluate(after, 'corp'))}, next prompt ${base.core.activePrompt(after)?.source?.step ?? '-'})`);
      }
    });
  }
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
