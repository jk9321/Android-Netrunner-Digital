/**
 * Diagnosis script for Runner issues #64, #65, #66 (replay + beta reproduce + AI score breakdowns).
 * Usage: npx vite-node scripts/runner-rework/issues-64-66.ts
 */
import { readFileSync } from 'node:fs';
import {
  GameAction,
  GameState,
  activePrompt,
  cardDef,
  createInitialGameState,
  executeAction,
  getLegalActions,
} from '../../src/core';

import { counters } from '../../src/core/engine/cardEffects';
import { canBreakSubroutinesWith, iceSubroutines } from '../../src/core/engine/ice';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { HeuristicRunnerAI } from '../../src/ai/runnerAI';
import {
  RunnerMemory,
  bestBreakPlan,
  botulusBreaks,
  chainReactionBonus,
  hostedTrojans,
  iceCost,
  iceCreditNeed,
  icePrice,
  runBypasses,
  runScore,
  serverValue,
  spendCost,
  subroutineCost,
  tankDamage,
  BOTULUS,
} from '../../src/ai/runs';
import { corpBoardValue, corpCardValue, evaluate, runnerRigValue } from '../../src/ai/evaluate';
import { answerPrompt, scoreOutcome, simulate } from '../../src/ai/prompts';
import { decisionContext } from '../../src/ai/handValues';
import { asSide, nudge, tuning } from '../../src/ai/synergy';

interface Saved {
  config: { seed: number; corpDeck: never; runnerDeck: never };
  startStops?: GameState['stops'];
  moves: GameAction[];
  state?: GameState;
}

function loadSaved(name: string): Saved {
  return JSON.parse(readFileSync(new URL(`../../tests/fixtures/runner-issues/${name}.json`, import.meta.url), 'utf8'));
}

function replayAll(name: string) {
  const r = loadSaved(name);
  let s = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  const runner = createAgent('runner', 'normal') as HeuristicRunnerAI;
  const states: { idx: number; turn: number; active: string; move: GameAction; before: GameState; mem: RunnerMemory }[] = [];
  for (let i = 0; i < r.moves.length; i++) {
    const move = r.moves[i];
    runner.observe(s);
    states.push({
      idx: i,
      turn: s.turnNumber,
      active: s.activePlayer,
      move,
      before: s,
      mem: new Map(runner.knownCards()),
    });
    s = executeAction(s, move);
  }
  return { r, finalState: s, states };
}

function boardAt(name: string, turn: number, predicate?: (s: GameState, move: GameAction) => boolean): { state: GameState; runner: HeuristicRunnerAI; moveIdx: number; move: GameAction } {
  const r = loadSaved(name);
  let s = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  const runner = createAgent('runner', 'normal') as HeuristicRunnerAI;
  for (let i = 0; i < r.moves.length; i++) {
    const move = r.moves[i];
    const match = predicate
      ? predicate(s, move)
      : s.turnNumber === turn && s.activePlayer === 'runner' && move.type === 'INITIATE_RUN';
    if (match) {
      runner.observe(s);
      return { state: structuredClone(s), runner, moveIdx: i, move };
    }
    runner.observe(s);
    s = executeAction(s, move);
  }
  throw new Error(`${name}: no matching move in turn ${turn}`);
}

function fmtAction(a: GameAction, s: GameState): string {
  if (a.type === 'INITIATE_RUN') return `INITIATE_RUN(${a.targetServerId})`;
  if (a.type === 'PLAY_CARD' || a.type === 'INSTALL_CARD') {
    const c = s.runner.grip.find(x => x.instanceId === a.cardInstanceId) ?? s.corp.hq.find(x => x.instanceId === a.cardInstanceId);
    return `${a.type}(${c ? cardDef(c).title : a.cardInstanceId})`;
  }
  if (a.type === 'RESOLVE_PROMPT') return `RESOLVE_PROMPT(${JSON.stringify(a.choice)})`;
  return a.type + ('serverId' in a ? `(${String(a.serverId)})` : '');
}

function playTurn(state: GameState, runner: Agent, lastTurn: number) {
  const g = new GameRunner(structuredClone(state), { runner, corp: createAgent('corp', 'normal') });
  const trace: string[] = [];
  for (let k = 0; k < 4000 && g.state.turnNumber <= lastTurn && !g.state.winner; k++) {
    const before = g.state;
    const p = activePrompt(before);
    g.step();
    if (g.last) {
      const tag = g.last.player === 'runner' ? 'R' : 'C';
      const pInfo = p ? ` [prompt:${p.kind}:${p.title}]` : '';
      trace.push(`T${before.turnNumber} ${tag}(clk=${before.runner.clicks},cr=${before.runner.credits},grip=${before.runner.grip.length}) ${fmtAction(g.last, before)}${pInfo}`);
    }
  }
  return { finalState: g.state, trace };
}

function describeServers(s: GameState, mem: RunnerMemory) {
  for (const srv of Object.values(s.corp.servers)) {
    if (!srv.isRemote && srv.ice.length === 0 && srv.root.length === 0) continue;
    const iceStr = srv.ice
      .map((c, idx) => {
        const bot = hostedTrojans(s, c, BOTULUS).map(b => `Botulus(${counters(b, 'virus')}v)`);
        // HIDDEN READ (measurement only): cardDef(c).title on unrezzed ice
        const title = cardDef(c).title;
        return `[${idx}] ${title}(${c.instanceId}, ${c.isRezzed ? 'REZZED' : 'unrezzed'}, mem=${mem.has(c.instanceId)}${bot.length ? ', ' + bot.join(',') : ''})`;
      })
      .join(' | ');
    const rootStr = srv.root
      .map(c => {
        // HIDDEN READ (measurement only): cardDef(c).title on unrezzed root card
        const title = cardDef(c).title;
        return `${title}(${c.instanceId}, ${c.isRezzed ? 'REZZED' : 'unrezzed'}, adv=${c.advancementCounters}, cr=${counters(c, 'credit')}, mem=${mem.has(c.instanceId)})`;
      })
      .join(', ');
    console.log(`  ${srv.id}: ice=[${iceStr}] root=[${rootStr}]`);
  }
}

function diagnose64() {
  console.log('====================================================================');
  console.log('ISSUE #64');
  console.log('====================================================================');
  const { finalState, states } = replayAll('issue-64');
  console.log(`Replay complete: ${states.length} moves, final turn=${finalState.turnNumber}, score=${finalState.corp.score}-${finalState.runner.score}`);
  console.log('\n--- Replay log (Turn 3 and Turn 4) ---');
  for (const entry of finalState.log) {
    if (entry.turnNumber === 3 || entry.turnNumber === 4) {
      console.log(`  [T${entry.turnNumber} ${entry.player}] ${entry.message}`);
    }
  }

  const t4Run = boardAt('issue-64', 4);
  const s = t4Run.state;
  const mem = t4Run.runner.knownCards();
  console.log(`\n--- T4 Run Decision Point (move index ${t4Run.moveIdx}, move=${JSON.stringify(t4Run.move)}) ---`);
  console.log(`Runner: clicks=${s.runner.clicks}, credits=${s.runner.credits}, grip=${s.runner.grip.length} [${s.runner.grip.map(c => cardDef(c).title).join(', ')}], tags=${s.runner.tags}`);
  console.log(`Rig programs: ${s.runner.rig.programs.map(c => `${cardDef(c).title}(hostedOn=${c.hostedOnId ?? 'none'}, v=${counters(c, 'virus')})`).join(', ')}`);
  console.log(`Rig hardware: ${s.runner.rig.hardware.map(c => cardDef(c).title).join(', ')}`);
  console.log(`Rig resources: ${s.runner.rig.resources.map(c => cardDef(c).title).join(', ')}`);
  console.log(`Corp: credits=${s.corp.credits}, score=${s.corp.score}, runnerScore=${s.runner.score}`);
  console.log('Servers:');
  describeServers(s, mem);

  decisionContext(s, 'runner');
  const opts = { memory: mem, wary: tuning.wary };
  console.log('\n--- AI Run Pricing on T4 ---');
  for (const srv of Object.values(s.corp.servers)) {
    const sv = serverValue(s, srv.id, 0, mem, tuning.wary);
    const rs = runScore(s, srv.id, opts);
    console.log(`  ${srv.id}: serverValue=${sv.toFixed(3)}, runScore=${rs.toFixed(3)}`);
  }

  const r2 = s.corp.servers['remote-2'];
  if (r2) {
    for (const ice of r2.ice) {
      const subs = iceSubroutines(s, ice);
      const bot = botulusBreaks(s, ice);
      const canBot = canBreakSubroutinesWith(ice, null);
      const ip = icePrice(s, ice);
      const ic = iceCost(s, ice);
      const icn = iceCreditNeed(s, ice);
      const bp = bestBreakPlan(s, ice, subs.length);
      console.log(`  remote-2 ice ${cardDef(ice).title} (${ice.instanceId}):`);
      console.log(`    subs=${JSON.stringify(subs.map(x => x.label))}`);
      console.log(`    subCosts=${JSON.stringify(subs.map(x => subroutineCost(s, x.label)))}`);
      console.log(`    tankDamage=${JSON.stringify(tankDamage(s, subs.map((x, i) => ({ label: x.label, i }))))}`);
      console.log(`    botulusBreaks=${bot}, canBreakSubroutinesWith(ice, null)=${canBot}`);
      console.log(`    bestBreakPlan=${JSON.stringify(bp)}, icePrice=${JSON.stringify(ip)}, iceCost=${ic}, iceCreditNeed=${icn}`);
    }
  }

  console.log('\n--- rankMainActions at T4 ---');
  const ranked = t4Run.runner.rankMainActions(s);
  for (const r of ranked.slice(0, 8)) {
    console.log(`  ${fmtAction(r.action, s)}: ${r.score.toFixed(3)}`);
  }

  // Check Semak-samun prompt in the replay!
  console.log('\n--- Semak-samun Prompt in Replay (T4) ---');
  for (const st of states) {
    if (st.turn === 4 && st.move.type === 'RESOLVE_PROMPT' && st.move.player === 'runner') {
      const p = activePrompt(st.before);
      console.log(`  move ${st.idx}: prompt=${p?.kind} "${p?.message}" options=${JSON.stringify(p && 'options' in p ? p.options : null)}`);
      console.log(`  chosen in saved game: ${JSON.stringify(st.move.choice)}`);
      if (p?.kind === 'effect_choice') {
        const legal = getLegalActions(st.before, 'runner').filter(a => a.type === 'RESOLVE_PROMPT');
        for (const a of legal) {
          const after = simulate(st.before, a);
          if (after) {
            const sc = scoreOutcome(st.before, after, 'runner', st.mem, true);
            const ev = evaluate(after, 'runner');
            console.log(`    option ${JSON.stringify(a.choice)} -> scoreOutcome=${sc.toFixed(3)}, evaluate=${ev.toFixed(3)}, activeRun=${Boolean(after.activeRun)}, grip=${after.runner.grip.length}`);
          }
        }
        const aiPick = answerPrompt(st.before, 'runner', st.mem, true);
        console.log(`  beta answerPrompt pick: ${JSON.stringify(aiPick?.type === 'RESOLVE_PROMPT' ? aiPick.choice : aiPick)}`);
      }
    }
  }

  // Reproduce on beta via GameRunner
  console.log('\n--- Beta Reproduce (GameRunner from T4 run board) ---');
  const rep = playTurn(t4Run.state, t4Run.runner, 4);
  for (const line of rep.trace) console.log('  ' + line);
}

function diagnose65() {
  console.log('\n====================================================================');
  console.log('ISSUE #65 (from issue-66.json)');
  console.log('====================================================================');
  const { finalState, states } = replayAll('issue-66');
  console.log(`Replay complete: ${states.length} moves, final turn=${finalState.turnNumber}, score=${finalState.corp.score}-${finalState.runner.score}`);
  console.log('\n--- Replay log (Turn 4) ---');
  for (const entry of finalState.log) {
    if (entry.turnNumber === 4) {
      console.log(`  [T${entry.turnNumber} ${entry.player}] ${entry.message}`);
    }
  }

  const t4Run = boardAt('issue-66', 4);
  const s = t4Run.state;
  const mem = t4Run.runner.knownCards();
  console.log(`\n--- T4 Run Decision Point (move index ${t4Run.moveIdx}, move=${JSON.stringify(t4Run.move)}) ---`);
  console.log(`Runner: clicks=${s.runner.clicks}, credits=${s.runner.credits}, grip=${s.runner.grip.length} [${s.runner.grip.map(c => cardDef(c).title).join(', ')}], tags=${s.runner.tags}`);
  console.log(`Rig: prog=[${s.runner.rig.programs.map(c => cardDef(c).title).join(', ')}] hw=[${s.runner.rig.hardware.map(c => cardDef(c).title).join(', ')}] res=[${s.runner.rig.resources.map(c => cardDef(c).title).join(', ')}]`);
  console.log(`Corp: credits=${s.corp.credits}, score=${s.corp.score}, runnerScore=${s.runner.score}`);
  console.log('Servers:');
  describeServers(s, mem);

  decisionContext(s, 'runner');
  const opts = { memory: mem, wary: tuning.wary };
  const r2 = s.corp.servers['remote-2'];
  const regolith = r2?.root[0];
  if (regolith) {
    const trash = cardDef(regolith).trash_cost!;
    console.log('\n--- Regolith Mining License Pricing at T4 Run ---');
    console.log(`  trash_cost=${trash}, runner.credits=${s.runner.credits}, corpCardValue(left=true)=${corpCardValue(regolith, s, 'runner', true).toFixed(3)}, corpCardValue(left=false)=${corpCardValue(regolith, s, 'runner', false).toFixed(3)}`);
    console.log(`  spendCost(trash=${trash})=${spendCost(s, trash).toFixed(3)}`);
    console.log(`  serverWorth term = max(0.5, corpCardValue(left) - spendCost) = ${Math.max(0.5, corpCardValue(regolith, s, 'runner', true) - spendCost(s, trash)).toFixed(3)}`);
    console.log(`  serverValue(remote-2)=${serverValue(s, 'remote-2', 0, mem, tuning.wary).toFixed(3)}, runScore(remote-2)=${runScore(s, 'remote-2', opts).toFixed(3)}`);
  }

  console.log('\n--- rankMainActions at T4 ---');
  for (const r of t4Run.runner.rankMainActions(s).slice(0, 8)) {
    console.log(`  ${fmtAction(r.action, s)}: ${r.score.toFixed(3)}`);
  }

  console.log('\n--- Access Trash Prompt in Replay (T4) ---');
  for (const st of states) {
    if (st.turn === 4 && st.move.type === 'RESOLVE_PROMPT' && st.move.player === 'runner') {
      const p = activePrompt(st.before);
      console.log(`  move ${st.idx}: prompt=${p?.kind} "${p?.message}" chosen=${JSON.stringify(st.move.choice)}`);
      if (p?.kind === 'access_trash') {
        const legal = getLegalActions(st.before, 'runner').filter(a => a.type === 'RESOLVE_PROMPT');
        for (const a of legal) {
          const after = simulate(st.before, a);
          if (after) {
            const sc = scoreOutcome(st.before, after, 'runner', st.mem, true);
            const ev = evaluate(after, 'runner');
            const cbv = corpBoardValue(after, 'runner');
            const rrv = runnerRigValue(after);
            console.log(`    choice=${JSON.stringify(a.choice)} -> scoreOutcome=${sc.toFixed(3)}, eval=${ev.toFixed(3)}, corpBoard=${cbv.toFixed(3)}, rRig=${rrv.toFixed(3)}, rCr=${after.runner.credits}`);
          }
        }
        const aiPick = answerPrompt(st.before, 'runner', st.mem, true);
        console.log(`  beta answerPrompt pick: ${JSON.stringify(aiPick?.type === 'RESOLVE_PROMPT' ? aiPick.choice : aiPick)}`);
      }
    }
  }

  console.log('\n--- Beta Reproduce (GameRunner from T4 run board) ---');
  const rep = playTurn(t4Run.state, t4Run.runner, 4);
  for (const line of rep.trace) console.log('  ' + line);
}

function diagnose66() {
  console.log('\n====================================================================');
  console.log('ISSUE #66 (T14, T15, T16)');
  console.log('====================================================================');
  const { finalState } = replayAll('issue-66');
  console.log('\n--- Replay log (Turns 14, 15, 16) ---');
  for (const entry of finalState.log) {
    if (entry.turnNumber >= 14 && entry.turnNumber <= 16) {
      console.log(`  [T${entry.turnNumber} ${entry.player}] ${entry.message}`);
    }
  }

  for (const turn of [14, 15, 16]) {
    const tRun = boardAt('issue-66', turn);
    const s = tRun.state;
    const mem = tRun.runner.knownCards();
    console.log(`\n--- T${turn} Run Decision Point (move index ${tRun.moveIdx}, move=${JSON.stringify(tRun.move)}) ---`);
    console.log(`Runner: clicks=${s.runner.clicks}, credits=${s.runner.credits}, grip=${s.runner.grip.length} [${s.runner.grip.map(c => cardDef(c).title).join(', ')}], tags=${s.runner.tags}`);
    console.log(`Rig programs: ${s.runner.rig.programs.map(c => `${cardDef(c).title}(hostedOn=${c.hostedOnId ?? 'none'}, v=${counters(c, 'virus')})`).join(', ')}`);
    console.log(`Rig hardware: ${s.runner.rig.hardware.map(c => cardDef(c).title).join(', ')}`);
    console.log(`Rig resources: ${s.runner.rig.resources.map(c => `${cardDef(c).title}(cr=${counters(c, 'credit')})`).join(', ')}`);
    console.log(`Corp: credits=${s.corp.credits}, score=${s.corp.score}, runnerScore=${s.runner.score}`);
    console.log('Servers:');
    describeServers(s, mem);

    decisionContext(s, 'runner');
    const opts = { memory: mem, wary: tuning.wary };
    const r3 = s.corp.servers['remote-3'];
    console.log(`remote-3 root.length=${r3?.root.length}`);
    for (const ice of r3?.ice ?? []) {
      const ip = icePrice(s, ice);
      const icn = iceCreditNeed(s, ice);
      // HIDDEN READ (measurement only): cardDef(ice).title on unrezzed ice
      console.log(`  remote-3 ice ${cardDef(ice).title}(${ice.isRezzed ? 'REZZED' : 'unrezzed'}, mem=${mem.has(ice.instanceId)}): icePrice=${JSON.stringify(ip)}, iceCreditNeed=${icn}, botulus=${botulusBreaks(s, ice)}`);
    }
    const sv = serverValue(s, 'remote-3', 0, mem, tuning.wary);
    const rs = runScore(s, 'remote-3', opts);
    const crb = chainReactionBonus(s, 'remote-3');
    const ndg = nudge(s, 'runner', { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-3' });
    const byp = runBypasses(s, 'remote-3', opts);
    console.log(`  remote-3: serverValue=${sv.toFixed(3)}, runScore=${rs.toFixed(3)}, chainReactionBonus=${crb.toFixed(3)}, nudge=${JSON.stringify(ndg)}, bypasses=${JSON.stringify({ ids: [...byp.ids], price: byp.price })}`);
    console.log('  All server scores:');
    for (const srv of Object.values(s.corp.servers)) {
      console.log(`    ${srv.id}: serverValue=${serverValue(s, srv.id, 0, mem, tuning.wary).toFixed(3)}, runScore=${runScore(s, srv.id, opts).toFixed(3)}`);
    }
    console.log('  rankMainActions:');
    for (const r of tRun.runner.rankMainActions(s).slice(0, 10)) {
      console.log(`    ${fmtAction(r.action, s)}: ${r.score.toFixed(3)}`);
    }
    console.log(`  Beta Reproduce (GameRunner from T${turn} run board):`);
    const rep = playTurn(tRun.state, tRun.runner, turn);
    for (const line of rep.trace) console.log('    ' + line);
  }
}

asSide('runner', () => {
  diagnose64();
  diagnose65();
  diagnose66();
});
