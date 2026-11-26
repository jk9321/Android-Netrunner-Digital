/**
 * B3 step 0.3 (brief rev 2, S3 and S5), the boards worked before any src change: #68 moves 50 and 76 (Jeff's saved game,
 * tests/fixtures/runner-issues/issue-68.json) and the D2 Topan fixture (tests/fixtures/runner-pins/deal-1581-t4-topan-host.json),
 * on each arm of trees.ts: per host option, the board's own term (the installed copy's virus counter worth, counterWorth,
 * and the counters' and card's term: the try-each score the fallback gives it), on the real state and on the deciding
 * Runner's dealt view, the pick, and the pick on 12 deals of the same knowledge (guessRunnerView samples 4096..4107).
 * The in-hand worth (the Botulus in the grip, trojanHostWorth's no-host branch) beside it.
 *   npx vite-node scripts/runner-rework/b3/boards.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../../src/core';
import { Tree, loadTree } from '../facts-trees';
import { ARMS, Arm, makeB3Trees } from './trees';

const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/b3-boards');

async function main() {
  const arms = (process.env.ARMS ?? ARMS.join(',')).split(',') as Arm[];
  const dirs = makeB3Trees(root, arms);
  const trees: Record<string, { T: Tree; P: any; CV: any; RR: any; TP: any }> = {};
  for (const arm of arms) {
    const T = await loadTree(arm, dirs[arm]);
    const m = (p: string) => import(/* @vite-ignore */ join(dirs[arm], 'src', p));
    trees[arm] = { T, P: await m('ai/prompts.ts'), CV: await m('ai/counterValues.ts'), RR: await m('ai/runnerReply.ts'), TP: await m('ai/turnPlanner.ts') };
  }
  const T0 = trees[arms[0]].T;
  const issue = JSON.parse(readFileSync('tests/fixtures/runner-issues/issue-68.json', 'utf8'));
  const boards: { label: string; state: GameState; memory: Map<string, string> }[] = [];
  for (const at of [50, 76]) {
    let s = T0.core.createInitialGameState(T0.decks.deckGameSetup(issue.config.seed, issue.config.corpDeck, issue.config.runnerDeck));
    if (issue.startStops) s = { ...s, stops: issue.startStops };
    const w: any = T0.createAgent('runner', 'normal');
    for (let i = 0; i < at; i++) {
      w.observe(s);
      s = T0.core.executeAction(s, issue.moves[i]);
    }
    w.observe(s);
    boards.push({ label: `#68 move ${at} (T${s.turnNumber})`, state: structuredClone(s), memory: new Map(w.memory) });
  }
  const fx = JSON.parse(readFileSync('tests/fixtures/runner-pins/deal-1581-t4-topan-host.json', 'utf8'));
  boards.push({ label: 'D2 Topan deal 1581 T4', state: structuredClone(fx.state), memory: new Map(fx.memory) });

  for (const b of boards) {
    const p: any = T0.core.activePrompt(b.state);
    const ice = Object.values(b.state.corp.servers).flatMap((v: any) => v.ice) as any[];
    const cardId = p.source.data.cardId;
    console.log(`\n== ${b.label}: "${p.message}"; Runner ${b.state.runner.credits} credits; Corp ${b.state.corp.credits}`);
    for (const o of p.options) {
      const h = ice.find(c => c.instanceId === o.id);
      const server = Object.values(b.state.corp.servers).find((v: any) => v.ice.includes(h)) as any;
      const hosted = b.state.runner.rig.programs.filter((c: any) => c.hostedOnId === o.id).map((c: any) => `${T0.core.cardDef(c).title}(${c.tokens?.virus ?? 0})`);
      console.log(`   option ${o.id}: ${server.id}, ${h.isRezzed ? 'rezzed' : 'facedown'}${h.runnerKnows ? ' known' : ''}, hosts ${hosted.join('+') || 'nothing'}, subroutines ${T0.runs.plannedSubroutines(b.state, h).length} (by its real code)`);
    }
    for (const arm of arms) {
      const { T, P, CV, RR, TP } = trees[arm];
      T.clear();
      T.synergy.asSide('runner', () => {
        T.handValues.decisionContext(b.state, 'runner');
        const inHand = b.state.runner.grip.find((c: any) => c.instanceId === cardId);
        const handWorth = inHand ? CV.counterWorth(b.state, inHand, 'virus') : NaN;
        const rows: string[] = [];
        const view: GameState = TP.runnerDecisionView(b.state, b.memory);
        for (const [name, s] of [['real', b.state], ['view', view]] as [string, GameState][]) {
          const scores = new Map<string, number>();
          P.HOSTLOG.on = (id: string, a: any, score: number) => id === p.id && scores.set(a.choice.optionId, score);
          const pick = P.answerPrompt(s, 'runner', b.memory, true);
          P.HOSTLOG.on = undefined;
          const cells = p.options.map((o: any) => {
            const after = P.simulate(s, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'effect_choice', optionId: o.id } });
            const installed = after?.runner.rig.programs.find((c: any) => c.instanceId === cardId);
            const cw = installed ? CV.counterWorth(after, installed, 'virus') : NaN;
            return `${o.id} cw=${r4(cw)} try=${r4(scores.get(o.id) ?? NaN)}`;
          });
          rows.push(`     ${name}: ${cells.join(' | ')}  -> pick ${pick.choice.optionId}`);
        }
        const picks = new Map<string, number>();
        const seed = TP.decisionSeedFor(b.state, 'runner');
        for (let k = 4096; k < 4108; k++) {
          const v = T.pricing.withPricing({ decisionSeed: seed }, () => RR.guessRunnerView(b.state, k, b.memory));
          const a = P.answerPrompt(v, 'runner', b.memory, true);
          picks.set(a.choice.optionId, (picks.get(a.choice.optionId) ?? 0) + 1);
        }
        console.log(`  [${arm}] in hand cw=${r4(handWorth)}; 12 deals: ${[...picks].map(([id, n]) => `${id} x${n}`).join(', ')}`);
        for (const row of rows) console.log(row);
      });
    }
  }
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
