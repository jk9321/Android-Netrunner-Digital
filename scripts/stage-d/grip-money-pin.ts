/**
 * Stage D exploit F2 (grip money), brief Q2 last item and Q5: the red team's line on the F2 fixture
 * (tests/fixtures/adversarial/stage-c-f2-grip-money.json; findings 2026-11-15-stage-c, finding 2), in beta and in each
 * arm of grip-money-arms.json. The tree's Normal Corp plays its turn against beta's Normal Runner (as the pin does);
 * then the line: Creative Commission, a credit while more than one click is left, a run on remote-1 (and, where the
 * Corp put the agenda elsewhere, the same line on that server, from the same board), the run played out by the
 * GameRunner (the tree's Corp rezzing, beta's Runner breaking). Reports the Corp's turn, where each agenda is, the pin's
 * own answer (no agenda in remote-1) and whether the line steals.
 *
 *   npx vite-node scripts/stage-d/grip-money-pin.ts
 */
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameAction, GameState, cardDef, executeAction, getLegalActions } from '../../src/core';
import { makeTrees, readArms } from './runner-money-trees';

process.env.ARMS_FILE ||= 'scripts/stage-d/grip-money-arms.json';
const file = readArms();
const root = resolve('.gm-pin');
const dirs = { beta: resolve('.'), ...makeTrees(file, root) } as Record<string, string>;
const fixture = (): GameState => JSON.parse(readFileSync(resolve('tests/fixtures/adversarial/stage-c-f2-grip-money.json'), 'utf8'));
const betaAi = await import(/* @vite-ignore */ join(dirs.beta, 'src', 'ai/index.ts'));

const where = (s: GameState, id: string) =>
  Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id))?.id ?? (s.corp.hq.some(c => c.instanceId === id) ? 'hq' : s.corp.scoreArea.some(c => c.instanceId === id) ? 'scored' : s.runner.scoreArea.some(c => c.instanceId === id) ? 'stolen' : 'other');

for (const [t, dir] of Object.entries(dirs)) {
  const ai = await import(/* @vite-ignore */ join(dir, 'src', 'ai/index.ts'));
  const po = await import(/* @vite-ignore */ join(dir, 'src', 'ai/playout.ts'));
  const s0 = fixture();
  const agendas = s0.corp.hq.filter(c => cardDef(c).type_code === 'agenda').map(c => c.instanceId);
  const g = new po.GameRunner(s0, { corp: ai.createAgent('corp', 'normal'), runner: betaAi.createAgent('runner', 'normal') });
  const moves: string[] = [];
  for (let i = 0; i < 100 && g.state.activePlayer === 'corp' && !g.state.winner; i++) {
    const before = g.state;
    if (!g.step()) break;
    const last = g.state.log?.[g.state.log.length - 1];
    if (g.state !== before && last) moves.push(String((last as { message?: string }).message ?? last).slice(0, 70));
  }
  const board: GameState = g.state;
  const remote1 = board.corp.servers['remote-1'];
  const pin = !(remote1?.root ?? []).some(c => cardDef(c).type_code === 'agenda');
  const placed = Object.fromEntries(agendas.map(id => [`${cardDef(s0.corp.hq.find(c => c.instanceId === id)!).title} (${id})`, where(board, id)]));
  // The line, on each server that holds an agenda after the Corp's turn, and on remote-1
  const targets = [...new Set(['remote-1', ...agendas.map(id => where(board, id)).filter(x => x.startsWith('remote'))])];
  const lines: Record<string, unknown> = {};
  for (const server of targets) {
    let s = board;
    const act = (want: (a: GameAction) => boolean, label: string) => {
      const a = getLegalActions(s, 'runner').find(want);
      if (!a) throw new Error(`no legal ${label}`);
      s = executeAction(s, a);
    };
    try {
      const startTurn = getLegalActions(s, 'runner').find(a => a.type === 'START_TURN');
      if (startTurn) s = executeAction(s, startTurn);
      const cc = s.runner.grip.find(c => c.cardCode === '30020');
      if (!cc) throw new Error('no Creative Commission in the grip');
      act(a => a.type === 'PLAY_OPERATION_OR_EVENT' && (a as { cardInstanceId?: string }).cardInstanceId === cc.instanceId, 'Creative Commission');
      while (s.runner.clicks > 1) act(a => a.type === 'GAIN_CREDIT', 'credit');
      const credits = s.runner.credits;
      act(a => a.type === 'INITIATE_RUN' && (a as { targetServerId?: string }).targetServerId === server, `run on ${server}`);
      const run = new po.GameRunner(s, { corp: ai.createAgent('corp', 'normal'), runner: betaAi.createAgent('runner', 'normal') });
      for (let i = 0; i < 300 && (run.state.activeRun || run.state.pendingPrompts.length) && !run.state.winner; i++) if (!run.step()) break;
      const end: GameState = run.state;
      lines[server] = {
        credits,
        breached: end.runsThisTurn.some(x => x.server === server && x.successful),
        stolen: agendas.filter(id => where(end, id) === 'stolen').map(id => cardDef(s0.corp.hq.find(c => c.instanceId === id)!).title),
        ice: (board.corp.servers[server]?.ice ?? []).map(c => `${cardDef(c).title}${c.isRezzed ? '' : ' (unrezzed)'}`),
      };
    } catch (e) {
      lines[server] = { error: (e as Error).message };
    }
  }
  console.log(JSON.stringify({ tree: t, pin: pin ? 'pass' : 'fail', corpTurn: moves.slice(0, 10), agendas: placed, corpCredits: board.corp.credits, line: lines }));
}
rmSync(root, { recursive: true, force: true });
