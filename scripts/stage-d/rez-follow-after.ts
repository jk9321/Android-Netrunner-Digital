/**
 * Stage D rez-follow, after the ruling (netrunner-ai/stage-d/rez-follow/design-answer.md section 3): two local traces.
 * The source game is played by this checkout's tree; questions go to copies (rez-follow-after-arms.json): `beta`, and
 * `probe` = followFree with prompts.ts's private answer functions exported (no behaviour change).
 *  (a) Found 2, deal 1601 T6 under followFree: from the Runner's turn start, the probe's Corp against the beta copy's
 *      Runner until the Corp's Ballista prompt on remote-1. There, on the Corp's view: runLoss, and for each answer its
 *      settled stand, runPrice and its parts (evaluate of the chained board, the hand term, freeRezSaving), the score
 *      runAnswer gives it, the program each trash takes, both sides' strength parts (runnerRigValue); runAnswer's and
 *      todayAnswer's picks. Then each answer applied to the real state and the rest of that Runner turn played
 *      (probe Corp, beta Runner, GameRunner): the Runner's actions, what it stole.
 *  (b) Found 6, deal 1081 T16: at each approach-ice window of the Runner's run on remote-2 (beta copy, the Corp's
 *      view): rezMoney's keep and byServer, the staked servers, and for each one serverHold 'runnerTurn' with the
 *      Corp's money unbounded (as holdingRez asks), with nextTurn's clicks and credits and runnerBudget.
 *   PART=a npx vite-node scripts/stage-d/rez-follow-after.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef } from '../../src/core';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { dealState } from '../stage-a/harness';
import { makeTrees, readArms } from './runner-money-trees';
import { loadTree } from './rez-follow-lib';

const PART = process.env.PART ?? 'a,b';
const title = (c: CardInstance | undefined) => (c ? cardDef(c).title : '?');
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The source game to the start of the Runner's turn after Corp turn T, played by this checkout's tree. */
function runnerTurnStart(deal: number, T: number, onWindow?: (s: GameState) => void): GameState | null {
  const corp = createAgent('corp', 'normal');
  if (onWindow) {
    const inner = corp.chooseRez!.bind(corp);
    corp.chooseRez = (s: GameState, cards: CardInstance[]) => (s.turnNumber === T && onWindow(s), inner(s, cards));
  }
  const g = new GameRunner(dealState(deal), { corp, runner: createAgent('runner', 'normal') });
  let start: GameState | null = null;
  for (let k = 0; k < 6000; k++) {
    const b = g.state;
    if (!g.step()) break;
    if (b.turnNumber === T && b.activePlayer === 'corp' && g.state.activePlayer === 'runner') start = structuredClone(g.state);
    if (start && b.activePlayer === 'runner' && g.state.activePlayer === 'corp') break;
  }
  return start;
}

async function main() {
  const file = readArms('scripts/stage-d/rez-follow-after-arms.json');
  const root = resolve('.rf-after');
  const dirs = makeTrees(file, root);
  const beta = await loadTree('beta', dirs.beta);
  const probe = await loadTree('probe', dirs.probe);
  const m = (d: string, p: string) => import(/* @vite-ignore */ join(d, 'src', p));
  const pr: any = await m(dirs.probe, 'ai/prompts.ts');
  const pools: any = await m(dirs.probe, 'ai/corp/pools.ts');
  const ev: any = await m(dirs.probe, 'ai/evaluate.ts');
  const holdB: any = await m(dirs.beta, 'ai/corp/hold.ts');
  const moneyB: any = await m(dirs.beta, 'ai/corp/rezMoney.ts');

  if (PART.includes('a')) {
    const start = runnerTurnStart(1601, 6)!;
    probe.clear();
    beta.clear();
    const g = new probe.GameRunner(structuredClone(start), { corp: probe.createAgent('corp', 'normal'), runner: beta.createAgent('runner', 'normal') });
    let s: GameState | null = null;
    for (let k = 0; k < 3000; k++) {
      const p = (g.state as GameState).pendingPrompts[0] as any;
      if (p && p.side === 'corp' && p.source?.cardCode && cardDef({ cardCode: p.source.cardCode } as CardInstance).title === 'Ballista') {
        s = structuredClone(g.state);
        break;
      }
      if (!g.step()) break;
    }
    if (!s) throw new Error('no Ballista prompt');
    console.log(`(a) deal 1601 T6 under followFree, Ballista prompt: Corp ${s.corp.credits}, Runner ${s.runner.credits} credits ${s.runner.clicks} clicks, score ${s.corp.score}-${s.runner.score}; root [${s.corp.servers['remote-1'].root.map(title).join(', ')}]; Runner programs [${s.runner.rig.programs.map(c => `${c.instanceId} ${title(c)}`).join(', ')}]`);
    const real = s;
    probe.clear();
    probe.asSide('corp', () => {
      const view = probe.corpDecisionView(structuredClone(real)) as GameState;
      probe.decisionContext(view, 'corp');
      const prompt = view.pendingPrompts[0] as any;
      const loss = pools.runLoss(view);
      console.log(`  runLoss ${r2(loss)}; evaluate(now, corp) ${r2(ev.evaluate(view, 'corp'))}; corp strength ${r2(ev.sideStrength(view, 'corp', 'corp'))}, runner strength ${r2(ev.sideStrength(view, 'runner', 'corp'))}, runnerRigValue ${r2(ev.runnerRigValue(view))}`);
      for (const a of pr.answers(view, 'corp', true) as GameAction[]) {
        const after = pr.simulate(view, a) as GameState;
        const id = (a as any).choice?.optionId;
        const stand = pr.settledStand(after, 'remote-1', true);
        const verdict = stand?.verdict();
        const chain = pr.followChain(prompt, after, 'corp', undefined, true) as GameState;
        const score = pr.scoreOutcome(view, chain, 'corp', undefined, true);
        const evalC = ev.evaluate(chain, 'corp');
        const fr = pr.freeRezSaving(view, after);
        const price = pr.runPrice(view, prompt, a, after, undefined, true);
        const prog = view.runner.rig.programs.find(c => c.instanceId === id);
        // The root agenda's worth to the Corp on the chained board: its strength less the same board with the agenda gone
        const sv = chain.corp.servers['remote-1'];
        const noAgenda: GameState = { ...chain, corp: { ...chain.corp, servers: { ...chain.corp.servers, 'remote-1': { ...sv, root: sv.root.filter(c => cardDef(c).type_code !== 'agenda') } } } };
        console.log(`    ${id}: corpBoardValue ${r2(ev.corpBoardValue(chain, 'corp'))}; the root agenda's worth to the Corp on this board ${r2(ev.sideStrength(chain, 'corp', 'corp') - ev.sideStrength(noAgenda, 'corp', 'corp'))}; corp strength without it ${r2(ev.sideStrength(noAgenda, 'corp', 'corp'))}`);
        console.log(`  answer ${id}${prog ? ` (trash ${title(prog)})` : ''}: stand ${verdict}; runPrice ${r2(price)} = scoreOutcome ${r2(score)} (evaluate ${r2(evalC)}, hand term ${r2(score - evalC)}) + freeRezSaving ${r2(fr)}; priced ${r2(price - (verdict === 'in' ? loss : 0))}; chained board: corp strength ${r2(ev.sideStrength(chain, 'corp', 'corp'))}, runner strength ${r2(ev.sideStrength(chain, 'runner', 'corp'))}, runnerRigValue ${r2(ev.runnerRigValue(chain))}, run ${chain.activeRun ? `${chain.activeRun.phase} pos ${chain.activeRun.icePosition}` : 'over'}, root agendas ${chain.corp.servers['remote-1']?.root.filter(c => cardDef(c).type_code === 'agenda').length}`);
      }
      const ra = pr.runAnswer(view, undefined, true);
      console.log(`  runAnswer picks ${JSON.stringify(ra?.map((x: any) => x.choice?.optionId) ?? null)}; todayAnswer ${pr.todayAnswer(view, 'corp', undefined, true).choice?.optionId}; answerPrompt ${pr.answerPrompt(view, 'corp', undefined, true).choice?.optionId}`);
    });
    // Each answer on the real state, the rest of the turn played
    for (const o of (real.pendingPrompts[0] as any).options as { id: string }[]) {
      probe.clear();
      beta.clear();
      const a: GameAction = { type: 'RESOLVE_PROMPT', player: 'corp', promptId: (real.pendingPrompts[0] as any).id, choice: { kind: 'effect_choice', optionId: o.id } } as GameAction;
      const g2 = new probe.GameRunner(structuredClone(real), { corp: probe.createAgent('corp', 'normal'), runner: beta.createAgent('runner', 'normal') });
      g2.apply(a);
      const acts: string[] = [];
      for (let k = 0; k < 3000; k++) {
        const b = g2.state as GameState;
        if (!g2.step()) break;
        const x = g2.last as any;
        if (x.type !== 'PASS' && x.type !== 'CONTINUE_RUN') acts.push(`${x.player[0]}:${x.type}${x.cardInstanceId ? ` ${title(b.runner.grip.find(c => c.instanceId === x.cardInstanceId) ?? [...b.runner.rig.programs, ...b.runner.rig.hardware, ...b.runner.rig.resources].find(c => c.instanceId === x.cardInstanceId))}` : ''}${x.targetServerId ? ` ${x.targetServerId}` : ''}${x.choice?.optionId ? ` ${x.choice.optionId}` : ''}`);
        if (b.activePlayer === 'runner' && g2.state.activePlayer === 'corp') break;
      }
      const st = g2.state as GameState;
      console.log(`  play on after ${o.id}: score ${st.corp.score}-${st.runner.score}, stolen [${st.runner.scoreArea.map(title).join(', ')}], Corp ${st.corp.credits}, Runner ${st.runner.credits}; ${acts.join(', ')}`);
    }
  }

  if (PART.includes('b')) {
    console.log('(b) deal 1081 T16, the run on remote-2');
    runnerTurnStart(1081, 16, s => {
      const run = s.activeRun;
      if (!run || run.server !== 'remote-2' || s.priority?.step !== 'approach_ice') return;
      const ice = s.corp.servers['remote-2'].ice[run.icePosition ?? -1];
      if (!ice || ice.isRezzed) return;
      beta.clear();
      beta.asSide('corp', () => {
        const view = beta.corpDecisionView(structuredClone(s)) as GameState;
        beta.decisionContext(view, 'corp');
        const k = moneyB.rezMoney(view);
        const from = holdB.nextTurn(view);
        console.log(`  window pos ${run.icePosition} ${title(ice)} ${ice.instanceId}: ice [${view.corp.servers['remote-2'].ice.map((c: CardInstance) => `${title(c)}${c.isRezzed ? '' : '(u)'}`).join(', ')}]; Corp ${view.corp.credits}, Runner ${view.runner.credits} credits ${view.runner.clicks} clicks (maxClicks ${view.runner.maxClicks}); rezMoney keep ${k.keep} byServer ${JSON.stringify(k.byServer)} unholdable ${JSON.stringify(k.unholdable)}; nextTurn ${JSON.stringify(from)}, runnerBudget ${r2(holdB.runnerBudget(view, from))}`);
        // Which difference turns it (first window only): the Runner's credits one lower, and Tithe inst-27 rezzed
        if (run.icePosition === 5) {
          const sv = view.corp.servers['remote-2'];
          const poorer: GameState = { ...view, runner: { ...view.runner, credits: view.runner.credits - 1 } };
          const tithe: GameState = { ...view, corp: { ...view.corp, servers: { ...view.corp.servers, 'remote-2': { ...sv, ice: sv.ice.map((c: CardInstance) => (c.instanceId === 'inst-27' ? { ...c, isRezzed: true } : c)) } } } };
          const both: GameState = { ...tithe, runner: poorer.runner };
          for (const [name, b] of [['Runner credits -1', poorer], ['Tithe inst-27 rezzed', tithe], ['both', both]] as const) {
            const h = holdB.serverHold(b, 'remote-2', { when: 'runnerTurn', corpCredits: Infinity });
            console.log(`    variant ${name}: remote-2 ${JSON.stringify({ holds: h.holds, rez: h.rez, cost: h.rezCost, need: h.need, budget: h.budget, entries: h.entries })}; keep ${moneyB.rezMoney(b).keep}`);
          }
        }
        for (const id of moneyB.stakedServers(view)) {
          const h = holdB.serverHold(view, id, { when: 'runnerTurn', corpCredits: Infinity });
          console.log(`    ${id}: runnerTurn hold ${JSON.stringify({ holds: h.holds, rez: h.rez, cost: h.rezCost, need: h.need, budget: h.budget, entries: h.entries })}`);
        }
      });
    });
  }
  rmSync(root, { recursive: true, force: true });
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
