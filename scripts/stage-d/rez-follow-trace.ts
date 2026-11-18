/**
 * Stage D rez-follow, Q1 (brief: /mnt/project-files/netrunner-ai/stage-d/rez-follow/brief.md): one exposure traced as
 * grip-money-rez1081.ts did. The source game is played by this checkout's tree (a local deal: GameRunner, Normal v
 * Normal) or replayed (a human game's recorded moves); every question goes to copies (found row 71b): `beta` (this
 * tree, copied) and each arm of rez-follow-arms.json.
 *  - Corp turn T: each move that installs or advances an agenda in a remote, with the beta copy's 'runnerTurn' hold
 *    after it (the set, its cost, need, budget, the Corp's credits);
 *  - the Runner's turn start: the same hold on that server, the Runner's credits; MEASURING ONLY: the recorded grip;
 *  - each Runner action of that turn, and at each approach-ice rez window on that server: the rule of countedRez that
 *    answers, rezStops with and without further, the 'thisRun' hold with the ice (and the set further in), without it,
 *    for it alone, modelRezGain, the keep, each copy's answer, and what the source game did.
 * PLAY=<copy> (a local deal): also plays that Runner turn from its start with the copy's Corp against the beta copy's
 * Runner, every action of both sides printed (with prompts' choices), and what was stolen.
 *   SRC=deal:1601 T=6 npx vite-node scripts/stage-d/rez-follow-trace.ts
 *   SRC=human:report-33 T=7 SERVER=remote-1 npx vite-node scripts/stage-d/rez-follow-trace.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, wantsStop } from '../../src/core';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { dealState } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';
import { makeTrees, readArms } from './runner-money-trees';
import { Tree, askRez, isRezWindow, loadTree, windowFacts } from './rez-follow-lib';

process.env.ARMS_FILE ||= 'scripts/stage-d/rez-follow-arms.json';
const SRC = process.env.SRC ?? 'deal:1081';
const T = Number(process.env.T ?? 16);
let SERVER = process.env.SERVER ?? '';
const title = (c: CardInstance) => cardDef(c).title;
const iceList = (s: GameState, sv: string) => (s.corp.servers[sv]?.ice ?? []).map((c, i) => `${i}:${title(c)} ${c.instanceId}${c.isRezzed ? '' : '(u)'}`).join(', ');
const holdStr = (h: { holds: boolean; rez: string[] | null; rezCost: number; need: number; budget: number; margin: number }) => JSON.stringify({ holds: h.holds, rez: h.rez, cost: h.rezCost, need: h.need, budget: h.budget, margin: h.margin });

async function main() {
  const file = readArms();
  const root = resolve('.rf-trace');
  const dirs = makeTrees(file, root);
  const trees: Tree[] = [];
  for (const [n, d] of Object.entries(dirs)) if (n !== 'control') trees.push(await loadTree(n, d));
  const beta = trees.find(t => t.name === 'beta')!;
  const runnerHold = (s: GameState, sv: string) => beta.serverHold(beta.corpDecisionView(structuredClone(s)), sv, { when: 'runnerTurn', corpCredits: s.corp.credits });
  let watching = false;
  let done = false;

  const onStep = (before: GameState, a: GameAction | null, after: GameState) => {
    if (!a) return;
    // Corp turn T: agenda moves into remotes
    if (before.turnNumber === T && before.activePlayer === 'corp' && a.player === 'corp' && (a.type === 'INSTALL_CARD' || a.type === 'ADVANCE_CARD')) {
      const id = (a as { cardInstanceId: string }).cardInstanceId;
      const all = [...before.corp.hq, ...Object.values(before.corp.servers).flatMap(v => v.root)];
      const c = all.find(x => x.instanceId === id);
      if (c && cardDef(c).type_code === 'agenda') {
        const sv = Object.values(after.corp.servers).find(v => v.root.some(x => x.instanceId === id))?.id;
        if (sv?.startsWith('remote')) {
          if (!SERVER) SERVER = sv;
          console.log(`COMMIT T${T} ${a.type} ${title(c)} ${id} -> ${sv}: Corp ${after.corp.credits} credits; ice [${iceList(after, sv)}]; hold ${holdStr(runnerHold(after, sv))}`);
        }
      }
    }
    if (before.turnNumber === T && before.activePlayer === 'corp' && after.activePlayer === 'runner' && SERVER) {
      watching = true;
      const sv = after.corp.servers[SERVER];
      console.log(`RUNNER TURN after Corp T${T}: ${SERVER} ice [${iceList(after, SERVER)}] root [${sv?.root.map(title).join(', ')}]; Corp ${after.corp.credits}; Runner ${after.runner.credits} credits ${after.runner.clicks} clicks; MEASURING ONLY grip [${after.runner.grip.map(title).join(', ')}]; hold ${holdStr(runnerHold(after, SERVER))}`);
    }
    if (watching && a.player === 'runner') console.log(`  runner ${JSON.stringify(a).slice(0, 150)} | ${after.runner.credits} credits${after.activeRun ? ` run ${after.activeRun.server} ${after.activeRun.phase} pos ${after.activeRun.icePosition}` : ''}`);
    if (watching && a.player === 'corp' && before.activePlayer === 'runner') console.log(`  corp ${JSON.stringify(a).slice(0, 150)} | Corp ${after.corp.credits} credits`);
    if (before.turnNumber === T && before.activePlayer === 'corp' && after.activePlayer === 'runner' && SERVER && process.env.PLAY) playWith(process.env.PLAY, after);
    if (watching && before.activePlayer === 'runner' && after.activePlayer === 'corp') {
      console.log(`END OF RUNNER TURN: Corp ${after.corp.credits}, Runner score ${after.runner.score}, stolen ${after.runner.scoreArea.map(title).join(', ')}`);
      done = true;
    }
  };
  const promptsOf: Record<string, { pr: any; pools: any }> = {};
  for (const [n, d] of Object.entries(dirs)) promptsOf[n] = { pr: await import(/* @vite-ignore */ join(d, 'src/ai/prompts.ts')), pools: await import(/* @vite-ignore */ join(d, 'src/ai/corp/pools.ts')) };
  const playWith = (name: string, start: GameState) => {
    const t = trees.find(x => x.name === name)!;
    t.clear();
    const g = new t.GameRunner(structuredClone(start), { corp: t.createAgent('corp', 'normal'), runner: beta.createAgent('runner', 'normal') });
    console.log(`PLAY ${name} from the Runner's turn start`);
    for (let k = 0; k < 3000; k++) {
      const b = g.state as GameState;
      const p = b.pendingPrompts[0] as any;
      if (p && p.side === 'corp' && b.activeRun?.server === SERVER && p.options) {
        const { pr, pools } = promptsOf[name];
        const view = t.corpDecisionView(structuredClone(b));
        const facts = t.asSide('corp', () => {
          t.decisionContext(view, 'corp');
          const loss = pools.runLoss(view);
          const outs = p.options.map((o: { id: string }) => {
            const after = pr.simulate(view, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: p.kind, optionId: o.id } });
            const st = after ? pr.settledStand(after, SERVER, true) : null;
            return `${o.id}: ${st ? `${st.key.slice(0, 40)} ${st.verdict()}` : 'no stand'}`;
          });
          return `runLoss ${loss}; ${outs.join('; ')}`;
        });
        console.log(`  CORP PROMPT ${p.source?.cardCode}:${p.source?.step} ${facts}`);
      }
      if (!g.step()) break;
      const a = g.last as GameAction;
      const r = (g.state as GameState).activeRun;
      if (a.type !== 'PASS') console.log(`  ${name} ${a.player} ${JSON.stringify(a).slice(0, 170)} | Corp ${g.state.corp.credits} Runner ${g.state.runner.credits}${r ? ` run ${r.server} ${r.phase} pos ${r.icePosition}` : ''}`);
      if (b.activePlayer === 'runner' && g.state.activePlayer === 'corp') break;
    }
    console.log(`PLAY ${name} end: Runner score ${g.state.runner.score}, stolen ${(g.state as GameState).runner.scoreArea.map(title).join(', ')}`);
  };
  const onWindow = (s: GameState) => {
    if (!watching || s.activeRun?.server !== SERVER || s.priority?.step !== 'approach_ice') return;
    const run = s.activeRun;
    const ice = s.corp.servers[SERVER].ice[run.icePosition ?? -1];
    if (!ice || ice.isRezzed) return;
    const f = windowFacts(beta, s, ice);
    const answers = trees.map(t => `${t.name} ${askRez(t, s).a}`).join('; ');
    console.log(`REZ WINDOW pos ${run.icePosition} ${title(ice)} ${ice.instanceId}: ice [${iceList(s, SERVER)}], Corp ${s.corp.credits}, Runner ${s.runner.credits} credits ${s.runner.clicks} clicks`);
    console.log(`  rule ${f.rule} (countedRez ${f.counted}, derived ${f.derivedOk ? 'same' : 'DIFFERS'}), rezStops further ${f.stopsT} / alone ${f.stopsF}, cost ${f.cost}`);
    console.log(`  thisRun with it ${JSON.stringify(f.withIt)}, without ${JSON.stringify(f.without)}, it alone ${JSON.stringify(f.alone)}`);
    console.log(`  modelRezGain ${f.gain}, keep ${f.keep} (this server ${f.keepHere})`);
    console.log(`  answers: ${answers}`);
  };

  if (SRC.startsWith('deal:')) {
    const play = createAgent('corp', 'normal');
    const inner = play.chooseRez!.bind(play);
    play.chooseRez = (s: GameState, cards: CardInstance[]) => {
      onWindow(s);
      return inner(s, cards);
    };
    const g = new GameRunner(dealState(Number(SRC.slice(5))), { corp: play, runner: createAgent('runner', 'normal') });
    for (let k = 0; k < 6000 && !done; k++) {
      const b = g.state;
      if (!g.step()) break;
      onStep(b, g.last, g.state);
    }
  } else {
    const name = SRC.replace(/^human:/, '').replace(/\.json$/, '');
    const report = JSON.parse(readFileSync(`tests/fixtures/human-games/${name}.json`, 'utf8'));
    let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    console.log(`human ${name}: AI side ${report.config.ai}`);
    for (const move of report.moves as GameAction[]) {
      if (done) break;
      if (isRezWindow(s, wantsStop)) {
        onWindow(s);
        if (watching && s.activeRun?.server === SERVER) console.log(`  recorded: ${JSON.stringify(move).slice(0, 120)}`);
      }
      const b = s;
      try {
        s = executeAction(s, move);
      } catch {
        console.log('replay stops (engine refuses a recorded move)');
        break;
      }
      void actingSide;
      onStep(b, move, s);
    }
  }
  rmSync(root, { recursive: true, force: true });
}
main().catch(e => { console.error(e); process.exit(1); });
