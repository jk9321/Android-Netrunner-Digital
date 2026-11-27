/**
 * F117 departures (#72 T8 Karunā, tests/runnerIssues69to72.test.ts): the saved game to move 113 (T8) as the pin builds it,
 * then the Runner's turn played by each tree (BASE: before departures; this checkout: with them). Prints each tree's
 * Runner actions; at every Runner prompt during a run, both trees' score of each answer on the same board.
 *   ARGS="BASE=88b9f75faddea95254e57a79380e37a573509026" npx vite-node scripts/f117/karuna.ts
 * Other R-B pins' boards: ISSUE=64 TURN=4 (the saved game at the Runner's first run of turn 4, as runnerIssues64to66's
 * boardAtRun builds it) in place of AT.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadTree } from '../runner-rework/facts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '88b9f75faddea95254e57a79380e37a573509026';
const AT = Number(process.env.AT ?? 113);
const TURN = process.env.TURN ? Number(process.env.TURN) : undefined;
const ISSUE = process.env.ISSUE ?? '72';
const root = resolve('node_modules/.cache/f117-karuna');
const r2 = (x: number) => Math.round(x * 100) / 100;
const saved = JSON.parse(readFileSync(`tests/fixtures/runner-issues/issue-${ISSUE}.json`, 'utf8'));

async function main() {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'base'), { recursive: true });
  execSync(`git archive ${BASE} src | tar -x -C ${join(root, 'base')}`);
  const base: any = await loadTree('base', join(root, 'base'));
  base.prompts = await import(/* @vite-ignore */ join(root, 'base', 'src', 'ai/prompts.ts'));
  const branch: any = await loadTree('branch', resolve('.'));
  branch.prompts = await import('../../src/ai/prompts');
  const C = branch.core;
  const name = (s: any, id?: string) => (id && C.findCardAnywhere(s, id) ? C.cardDef(C.findCardAnywhere(s, id)).title : '');
  const label = (s: any, a: any) => `${a.type}${a.targetServerId ? ` ${a.targetServerId}` : ''}${a.cardInstanceId ? ` ${name(s, a.cardInstanceId)}` : ''}${a.choice ? ` ${JSON.stringify(a.choice)}` : ''}`;

  const boards: Record<string, any[]> = {};
  for (const T of [base, branch]) {
    let s = T.core.createInitialGameState(T.decks.deckGameSetup(saved.config.seed, saved.config.corpDeck, saved.config.runnerDeck));
    if (saved.startStops) s = { ...s, stops: saved.startStops };
    const runner: any = T.createAgent('runner', 'normal');
    for (let i = 0; TURN === undefined ? i < AT : !(s.turnNumber === TURN && s.activePlayer === 'runner' && saved.moves[i].type === 'INITIATE_RUN'); i++) {
      runner.observe?.(s);
      s = T.core.executeAction(s, saved.moves[i]);
    }
    runner.observe?.(s);
    const g = new T.GameRunner(structuredClone(s), { runner, corp: T.createAgent('corp', 'normal') });
    const turn = g.state.turnNumber;
    boards[T.name] = [];
    console.log(`\n== ${T.name}: T${turn}, grip ${g.state.runner.grip.map((c: any) => name(g.state, c.instanceId)).join(', ')}; credits ${g.state.runner.credits}`);
    for (let k = 0; k < 3000 && g.state.turnNumber === turn && !g.state.winner; k++) {
      const before = g.state;
      runner.observe?.(before);
      if (!g.step()) break;
      if (g.last?.player === 'runner') {
        boards[T.name].push({ before, action: g.last, memory: runner });
        const p0 = T.core.activePrompt(before);
        if (process.env.VIEW && p0?.source?.cardCode === process.env.VIEW) {
          // The deciding Runner's own path: its honest view of the prompt, its memory, each answer scored there
          const rp: any = await import(/* @vite-ignore */ T.name === 'base' ? join(root, 'base', 'src', 'ai/runner/prompt.ts') : resolve('src/ai/runner/prompt.ts'));
          const rr: any = await import(/* @vite-ignore */ T.name === 'base' ? join(root, 'base', 'src', 'ai/runnerReply.ts') : resolve('src/ai/runnerReply.ts'));
          const mem = runner.memory;
          const view0 = runner.ownView(before);
          const { view } = rp.honestPromptView(before, { view: view0, slots: (x: any) => rr.runnerUnknownSlots(x, mem), memory: mem, synergy: false, answer: (x: any) => T.prompts.answerPrompt(x, 'runner', mem, false) });
          T.handValues.inDecision(view, 'runner', () => {
            for (const a of T.core.getLegalActions(view, 'runner').filter((x: any) => x.type === 'RESOLVE_PROMPT')) {
              const after = T.prompts.simulate(view, a);
              const sc = T.prompts.withChainWork(view, (at: any) => T.prompts.scoreAnswer(view, T.core.activePrompt(view), a, after, 'runner', mem, false, at));
              console.log(`    [${T.name} own view] ${label(view, a)}: ${r2(sc)} (grip after ${after.runner.grip.map((c: any) => name(after, c.instanceId)).join(', ')})`);
            }
            // The same view under other RNG states (which grip cards the damage takes), each answer
            for (const a of T.core.getLegalActions(view, 'runner').filter((x: any) => x.type === 'RESOLVE_PROMPT')) {
              const xs: number[] = [];
              for (let k = 0; k < Number(process.env.SEEDS ?? 0); k++) {
                const v = structuredClone(view);
                v.rng.state = (view.rng.state + k) >>> 0;
                if (process.env.DECOMP && k < 6) { const af = T.prompts.simulate(v, a); console.log(`      rng+${k} ${label(v, a)}: evaluate ${r2(T.evaluate.evaluate(af, 'runner'))}, runRest ${r2(T.runs.runRestWorth(af, mem, false))}, grip ${af.runner.grip.map((c: any) => name(af, c.instanceId)).join('/')}`); }
                xs.push(T.prompts.withChainWork(v, (at: any) => T.prompts.scoreAnswer(v, T.core.activePrompt(v), a, T.prompts.simulate(v, a), 'runner', mem, false, at)));
              }
              if (xs.length) console.log(`    [${T.name} own view, ${xs.length} rng states] ${label(view, a)}: mean ${r2(xs.reduce((x, y) => x + y, 0) / xs.length)}, min ${r2(Math.min(...xs))}, max ${r2(Math.max(...xs))}`);
            }
          });
        }
        console.log(`  ${label(before, g.last)}${before.activeRun ? ` (run on ${before.activeRun.server})` : ''}; grip ${before.runner.grip.length} -> ${g.state.runner.grip.length}`);
      }
    }
  }
  // Every Runner prompt in a run (either tree's game): both trees' scores of each answer on that board
  for (const [who, list] of Object.entries(boards)) {
    for (const { before, action } of list) {
      const p = C.activePrompt(before);
      if (!p || !before.activeRun || action.type !== 'RESOLVE_PROMPT') continue;
      console.log(`\n-- ${who}'s game, Runner prompt ${p.source?.cardCode}:${p.source?.step} "${p.message}" (run on ${before.activeRun.server}; grip ${before.runner.grip.map((c: any) => name(before, c.instanceId)).join(', ')}); picked ${label(before, action)}`);
      for (const T of [base, branch]) {
        const answers = T.core.getLegalActions(before, 'runner').filter((a: any) => a.type === 'RESOLVE_PROMPT');
        T.handValues.inDecision(before, 'runner', () => {
          for (const a of answers) {
            const after = T.prompts.simulate(before, a);
            if (!after) continue;
            const score = T.prompts.withChainWork(before, (at: any) => T.prompts.scoreAnswer(before, p, a, after, 'runner', undefined, false, at));
            const ev = T.evaluate.evaluate(after, 'runner');
            console.log(`   ${T.name} ${label(before, a)}: score ${r2(score)} (evaluate of the one-step board ${r2(ev)}; grip after ${after.runner.grip.map((c: any) => name(after, c.instanceId)).join(', ')})`);
            const left = before.runner.grip.filter((c: any) => !after.runner.grip.some((d: any) => d.instanceId === c.instanceId));
            if (left.length && T.handValues.ownHandValue) {
              const without = { ...before, runner: { ...before.runner, grip: before.runner.grip.filter((c: any) => !left.includes(c)) } };
              const back = { ...after, runner: { ...after.runner, grip: [...after.runner.grip, ...left] } };
              console.log(`     leaving: ${left.map((c: any) => name(before, c.instanceId)).join(', ')}; owner ${r2(T.handValues.ownHandValue(before, 'runner') - T.handValues.ownHandValue(without, 'runner'))}, count ${r2(T.evaluate.handCount(back, 'runner', 'runner') - T.evaluate.handCount(after, 'runner', 'runner'))}`);
            }
          }
        });
      }
    }
  }
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
