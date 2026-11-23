/**
 * Diagnosis script for GitHub issues #58 ("Plaza access bug") and #59 ("Runner repeatedly ran Bumi 1.0").
 *
 * Replays both decoded saved games move by move from docs/gemini-prep/issue-games/, verifies every
 * engine action, and logs the Runner AI's option scores, run prices, prompt evaluations, and memory
 * at every bad decision point.
 *
 * Usage:
 *   npx vite-node scripts/runner-rework/issues-58-59.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import {
  GameAction,
  GameState,
  activePrompt,
  cardDef,
  createInitialGameState,
  executeAction,
  findCardAnywhere,
  getLegalActions,
} from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { availableCredits, counters } from '../../src/core/engine/cardEffects';
import { HeuristicRunnerAI } from '../../src/ai/runnerAI';
import {
  creditsAhead,
  iceCost,
  iceCreditNeed,
  runScore,
  serverValue,
  bioroidBreakClicks,
} from '../../src/ai/runs';
import { evaluate, corpBoardValue, runnerRigValue } from '../../src/ai/evaluate';
import { answerPrompt, scoreOutcome, simulate } from '../../src/ai/prompts';
import { sideCreditValue } from '../../src/ai/valueModel';
import { tagCost } from '../../src/ai/runs';

function replayAndObserve(file: string) {
  const fix = JSON.parse(readFileSync(file, 'utf8'));
  const setup = deckGameSetup(fix.config.seed, fix.config.corpDeck, fix.config.runnerDeck);
  let state: GameState = createInitialGameState(setup);
  if (fix.startStops) state = { ...state, stops: fix.startStops };
  const moves: GameAction[] = fix.moves;
  return { fix, start: state, moves };
}

function fmtAction(state: GameState, a: GameAction): string {
  if (a.type === 'INITIATE_RUN') return `RUN(${a.targetServerId})`;
  if (a.type === 'INSTALL_CARD') {
    const c = findCardAnywhere(state, a.cardInstanceId);
    return `INSTALL(${c ? cardDef(c).title : a.cardInstanceId})`;
  }
  if (a.type === 'PLAY_OPERATION_OR_EVENT') {
    const c = findCardAnywhere(state, a.cardInstanceId);
    return `PLAY(${c ? cardDef(c).title : a.cardInstanceId})`;
  }
  if (a.type === 'USE_ABILITY') {
    const c = findCardAnywhere(state, a.cardInstanceId);
    return `ABILITY(${c ? cardDef(c).title : a.cardInstanceId}#${a.abilityIndex})`;
  }
  if (a.type === 'RESOLVE_PROMPT') return `PROMPT(${JSON.stringify(a.choice)})`;
  return a.type;
}

function diagnose58() {
  console.log('====================================================================');
  console.log('ISSUE #58: Plaza access bug (seed 3290689454)');
  console.log('====================================================================');
  const { start, moves } = replayAndObserve('docs/gemini-prep/issue-games/issue-58.json');
  let state = start;
  const ai = new HeuristicRunnerAI(true, true);

  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    const prompt = activePrompt(state);

    // Keep AI memory synced with what the Runner saw (same as runnerAI.chooseAction does)
    if (state.activePlayer === 'runner' || prompt?.side === 'runner') {
      (ai as any).remember(state);
    }

    // 1. Check Runner main-phase decision when it starts a run into the server holding Public Access Plaza
    const nextState = executeAction(state, mv);
    if (!state.activeRun && nextState.activeRun) {
      const targetSv = nextState.activeRun.server;
      const sv = state.corp.servers[targetSv];
      if (sv?.root.some(c => c.cardCode === '35062')) {
        const mem = (ai as any).memory as Map<string, string>;
        const view = (ai as any).ownView(state);
        const ranked = ai.rankMainActions(structuredClone(state));
        const rootDesc = sv.root.map(c => `${cardDef(c).title}(rezzed=${c.isRezzed},known=${c.runnerKnows},mem=${mem.has(c.instanceId)})`).join(', ');
        const iceDesc = sv.ice.map(c => `${cardDef(c).title}(rezzed=${c.isRezzed})`).join(', ');
        console.log(`\n[Move ${i} | Turn ${state.turnNumber}] Runner started run on ${targetSv} via ${fmtAction(state, mv)}`);
        console.log(`  Runner: cr=${state.runner.credits} availCr=${availableCredits(state, 'runner')} clicks=${state.runner.clicks} grip=${state.runner.grip.length} tags=${state.runner.tags} | Corp: cr=${state.corp.credits} sc=${state.corp.score}`);
        console.log(`  ${targetSv}: ice=[${iceDesc}] root=[${rootDesc}]`);
        console.log(`  runScore(real, '${targetSv}'): ${runScore(state, targetSv, mem, {}, true).toFixed(3)} | runScore(view, '${targetSv}'): ${runScore(view, targetSv, mem, {}, true).toFixed(3)}`);
        console.log(`  serverValue(real, '${targetSv}'): ${serverValue(state, targetSv, 0, mem, true).toFixed(3)}`);
        console.log(`  Top ranked main actions:`);
        for (const r of ranked.slice(0, 6)) {
          console.log(`    ${r.score.toFixed(3).padStart(8)}  ${fmtAction(state, r.action)}`);
        }
      }
    }

    // 2. Check every access_trash prompt for Public Access Plaza
    if (prompt && prompt.kind === 'access_trash' && prompt.side === 'runner') {
      const card = findCardAnywhere(state, prompt.cardInstanceId);
      if (card && card.cardCode === '35062') {
        const mem = (ai as any).memory as Map<string, string>;
        const legal = getLegalActions(state, 'runner').filter(a => a.type === 'RESOLVE_PROMPT');
        const trashAct = legal.find(a => a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'access_trash' && a.choice.trash);
        const keepAct = legal.find(a => a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'access_trash' && !a.choice.trash);
        const touchstones = state.runner.rig.hardware.filter(c => cardDef(c).title === 'Touchstone');
        const tsCredits = touchstones.reduce((n, c) => n + counters(c, 'credit'), 0);

        console.log(`\n[Move ${i} | Turn ${state.turnNumber}] access_trash prompt for Public Access Plaza (rezzed=${card.isRezzed}, trashCost=${prompt.trashCost}, actual=${JSON.stringify((mv as any).choice)})`);
        console.log(`  Runner: cr=${state.runner.credits} availCr=${availableCredits(state, 'runner')} TouchstoneCr=${tsCredits} clicks=${state.runner.clicks} tags=${state.runner.tags} | Corp: cr=${state.corp.credits} sc=${state.corp.score} (Threat=${Math.max(state.corp.score, state.runner.score)})`);

        if (trashAct && keepAct) {
          const afterTrash = simulate(structuredClone(state), trashAct)!;
          const afterKeep = simulate(structuredClone(state), keepAct)!;
          const scTrash = scoreOutcome(state, afterTrash, 'runner', mem, true);
          const scKeep = scoreOutcome(state, afterKeep, 'runner', mem, true);
          const evTrash = evaluate(afterTrash, 'runner');
          const evKeep = evaluate(afterKeep, 'runner');
          const cbBefore = corpBoardValue(state);
          const cbTrash = corpBoardValue(afterTrash);
          const cbKeep = corpBoardValue(afterKeep);
          const rigTrash = runnerRigValue(afterTrash);
          const rigKeep = runnerRigValue(afterKeep);
          const crValTrash = sideCreditValue(afterTrash, 'runner');
          const crValKeep = sideCreditValue(afterKeep, 'runner');

          console.log(`  scoreOutcome: trash=${scTrash.toFixed(4)} vs keep=${scKeep.toFixed(4)} (diff=${(scTrash - scKeep).toFixed(4)})`);
          console.log(`  evaluate:     trash=${evTrash.toFixed(4)} vs keep=${evKeep.toFixed(4)} (diff=${(evTrash - evKeep).toFixed(4)})`);
          console.log(`  Parts (trash - keep):`);
          console.log(`    corpBoardValue:  before=${cbBefore.toFixed(4)} trash=${cbTrash.toFixed(4)} keep=${cbKeep.toFixed(4)} (Corp lost=${(cbKeep - cbTrash).toFixed(4)})`);
          console.log(`    runnerCredits:   trash=${afterTrash.runner.credits} keep=${afterKeep.runner.credits} | sideCreditValue diff=${(crValTrash - crValKeep).toFixed(4)}`);
          console.log(`    runnerRigValue:  trash=${rigTrash.toFixed(4)} keep=${rigKeep.toFixed(4)} (diff=${(rigTrash - rigKeep).toFixed(4)})`);
          console.log(`    runnerTags:      trash=${afterTrash.runner.tags} keep=${afterKeep.runner.tags} | tagCost=${tagCost(afterTrash).toFixed(4)}`);
          const aiPick = answerPrompt(structuredClone(state), 'runner', mem, true);
          console.log(`  answerPrompt(real): ${fmtAction(state, aiPick)}`);
          const view = (ai as any).ownView(state);
          const aiViewPick = answerPrompt(structuredClone(view), 'runner', mem, true);
          console.log(`  answerPrompt(view): ${fmtAction(view, aiViewPick)}`);
        } else {
          console.log(`  Legal options: ${legal.map(a => fmtAction(state, a)).join(', ')} (trash NOT legal!)`);
        }
      }
    }

    state = executeAction(state, mv);
  }
  console.log(`\nIssue #58 replay complete: all ${moves.length} moves executed cleanly. Final turn=${state.turnNumber}, score=${state.corp.score}-${state.runner.score}.`);
}

function diagnose59() {
  console.log('\n====================================================================');
  console.log('ISSUE #59: Runner repeatedly ran Bumi 1.0 (seed 2208434514)');
  console.log('====================================================================');
  const { start, moves } = replayAndObserve('docs/gemini-prep/issue-games/issue-59.json');
  let state = start;
  const ai = new HeuristicRunnerAI(true, true);

  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    const prompt = activePrompt(state);

    if (state.activePlayer === 'runner' || prompt?.side === 'runner') {
      (ai as any).remember(state);
    }

    // 1. Runner starts a run on remote-1 (either INITIATE_RUN or via a card/ability)
    const nextState = executeAction(state, mv);
    if (!state.activeRun && nextState.activeRun && nextState.activeRun.server === 'remote-1') {
      const mem = (ai as any).memory as Map<string, string>;
      const view = (ai as any).ownView(state);
      const sv = state.corp.servers['remote-1'];
      const iceDesc = sv.ice.map((c, idx) => {
        const ic = iceCost(state, c);
        const need = iceCreditNeed(state, c);
        const bc = bioroidBreakClicks(state, c);
        return `[${idx}]${cardDef(c).title}(rezzed=${c.isRezzed},known=${c.runnerKnows},mem=${mem.get(c.instanceId) ?? '-'},iceCost=${ic},need=${need},bioClicks=${JSON.stringify(bc)})`;
      });
      const rootDesc = sv.root.map(c => `${cardDef(c).title}(rezzed=${c.isRezzed},adv=${c.advancementCounters},known=${c.runnerKnows},mem=${mem.get(c.instanceId) ?? '-'})`);
      const ranked = ai.rankMainActions(structuredClone(state));
      const rigDesc = state.runner.rig.programs.map(p => cardDef(p).title).join(', ');
      console.log(`\n[Move ${i} | Turn ${state.turnNumber}] Runner started run on remote-1 via ${fmtAction(state, mv)}`);
      console.log(`  Runner: cr=${state.runner.credits} availCr=${availableCredits(state, 'runner')} clicks=${state.runner.clicks} grip=${state.runner.grip.length} rig=[${rigDesc}] | Corp: cr=${state.corp.credits} sc=${state.corp.score}`);
      console.log(`  remote-1 ice (inner->outer): ${iceDesc.join(' | ')}`);
      console.log(`  remote-1 root: ${rootDesc.join(', ')}`);
      console.log(`  runScore(real, 'remote-1'): ${runScore(state, 'remote-1', mem, {}, true).toFixed(3)} | runScore(view, 'remote-1'): ${runScore(view, 'remote-1', mem, {}, true).toFixed(3)}`);
      console.log(`  serverValue(real, 'remote-1'): ${serverValue(state, 'remote-1', 0, mem, true).toFixed(3)}`);
      console.log(`  runsThisTurn: ${JSON.stringify(state.runsThisTurn)}`);
      console.log(`  Top ranked main actions:`);
      for (const r of ranked.slice(0, 6)) {
        console.log(`    ${r.score.toFixed(3).padStart(8)}  ${fmtAction(state, r.action)}`);
      }
    }

    // 2. Runner spends clicks on Bumi 1.0 or jacks out on remote-1
    if (state.activeRun?.server === 'remote-1' && (mv.type === 'BIOROID_BREAK' || mv.type === 'JACK_OUT')) {
      const run = state.activeRun;
      const ahead = creditsAhead(state);
      const avail = availableCredits(state, 'runner');
      const sv = state.corp.servers['remote-1'];
      const pos = run.icePosition;
      const curIce = pos !== null ? sv.ice[pos] : null;
      const innerIce = pos !== null ? sv.ice.slice(0, pos) : [];
      console.log(
        `  [Move ${i} | Turn ${state.turnNumber}] ${mv.type} (phase=${run.phase}, pos=${pos}, curIce=${curIce ? cardDef(curIce).title : 'none'}, clicks=${state.runner.clicks}, availCr=${avail}, creditsAhead=${ahead}, inner=[${innerIce.map(c => `${cardDef(c).title}(rez=${c.isRezzed},need=${iceCreditNeed(state, c)},cost=${iceCost(state, c)})`).join(',')}])`
      );
    }

    state = executeAction(state, mv);
  }
  console.log(`\nIssue #59 replay complete: all ${moves.length} moves executed cleanly. Final turn=${state.turnNumber}, score=${state.corp.score}-${state.runner.score}.`);
}

diagnose58();
diagnose59();
