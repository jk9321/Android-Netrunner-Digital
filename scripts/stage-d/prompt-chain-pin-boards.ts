/**
 * Stage D found row 59, the pin step (brief /mnt/project-files/netrunner-ai/stage-d/prompt-chain/brief-pin.md): the 25
 * recorded boards of run 44530910615 where beta's Anoetic Void "yes" sends an agenda from HQ to Archives. Each deal is
 * replayed by a plain GameRunner (this checkout, Normal v Normal, as the batch and prompt-chain.ts), its decisions
 * counted as prompt-chain.ts counts them, to the recorded decision index; the board is checked to be Anoetic Void's
 * approach prompt. The source game then plays on (that is beta's own answer and its continuation): which HQ cards the
 * trash step took, the HQ by card kind before it, the server's root, and whether each trashed agenda is later stolen
 * from Archives (it reaches the Runner's score area). The measuring script reads HQ and root types (what was true).
 *   npx vite-node scripts/stage-d/prompt-chain-pin-boards.ts                       (all 25)
 *   ARGS="BOARDS=2341:94 DUMP=tests/fixtures/anoetic-void-2341-t6.json" npx vite-node scripts/stage-d/prompt-chain-pin-boards.ts
 * DUMP writes { state, answers, line, steal } for one board: the board, beta's two answers, and the moves from the board
 * to the steal from Archives (if any), for the pin in tests/stageDPins.test.ts.
 */
import { writeFileSync } from 'node:fs';
import { GameAction, GameState, activePrompt, actingSide, cardDef, wantsStop } from '../../src/core';
import { createAgent, GameRunner } from '../../src/ai';
import { dealState } from '../stage-a/harness';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
/** The 25 boards (deal seed : decision index : turn), from run 44530910615's continuations (prompt-chain-sum.mjs). */
const ALL = '2341:94:6 2341:137:8 2241:265:14 2041:196:12 2041:278:16 1321:123:9 1331:59:3 2311:65:5 2831:59:4 1681:95:6 1681:382:20 1681:400:21 1741:185:11 2101:108:8 2101:169:11 2101:187:12 2101:266:16 1751:265:14 1751:281:15 1751:299:16 1291:276:17 1291:323:19 1771:437:22 2141:187:12 2141:250:15';
const want = (process.env.BOARDS ?? '').split(',').filter(Boolean);
const boards = ALL.split(' ').map(b => b.split(':').map(Number)).filter(([s, i]) => !want.length || want.includes(`${s}:${i}`));

/** As prompt-chain.ts decisionOf: GameRunner.step asks an agent on this board. */
function asks(s: GameState): boolean {
  const side = actingSide(s);
  if (!side || s.winner) return false;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) return wantsStop(s, side, w) && ((side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) || (side === 'runner' && w.step === 'corp_action'));
  return true;
}
const kinds = (s: GameState, ids: string[]) => ids.map(id => cardDef([...s.corp.hq, ...s.corp.archives.faceUp, ...s.corp.archives.faceDown].find(c => c.instanceId === id)!).type_code);

const rows: Record<string, unknown>[] = [];
for (const [seed, index, turn] of boards) {
  const g = new GameRunner(dealState(seed), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  let n = 0;
  let board: GameState | null = null;
  for (let k = 0; k < 4000 && !board; k++) {
    if (asks(g.state)) {
      if (n === index) board = structuredClone(g.state);
      n++;
    }
    if (!board && !g.step()) break;
  }
  const p = board ? activePrompt(board) : null;
  if (!board || !p || !('source' in p) || p.source.cardCode !== '30050' || p.source.step !== 'approach') {
    rows.push({ seed, index, ok: false, why: board ? `prompt ${p && 'source' in p ? `${p.source.cardCode}:${p.source.step}` : p?.kind}` : 'not reached' });
    continue;
  }
  const hq = board.corp.hq.map(c => ({ id: c.instanceId, kind: cardDef(c).type_code, title: cardDef(c).title }));
  const server = board.activeRun!.server;
  const root = board.corp.servers[server].root.map(c => `${cardDef(c).type_code}:${cardDef(c).title}`);
  // beta's own answers and the continuation: the source game plays on
  const answers: GameAction[] = [];
  const line: GameAction[] = [];
  let trashed: string[] = [];
  g.step();
  answers.push(g.last!);
  if ((g.last as { choice?: { optionId?: string } }).choice?.optionId === 'yes') {
    g.step();
    answers.push(g.last!);
    trashed = ((g.last as { choice?: { cardInstanceIds?: string[] } }).choice?.cardInstanceIds ?? []).slice();
  }
  const agendaIds = trashed.filter(id => cardDef(board!.corp.hq.find(c => c.instanceId === id)!).type_code === 'agenda');
  let steal: { turn: number; id: string; title: string; moves: number } | null = null;
  const stolenIds = () => g.state.runner.scoreArea.map(c => c.instanceId);
  for (let k = 0; k < 5000 && !steal; k++) {
    if (!g.step()) break;
    line.push(g.last!);
    const hit = agendaIds.find(id => stolenIds().includes(id));
    if (hit) steal = { turn: g.state.turnNumber, id: hit, title: cardDef(g.state.runner.scoreArea.find(c => c.instanceId === hit)!).title, moves: line.length };
  }
  for (let k = 0; k < 5000; k++) if (!g.step()) break;
  const row = {
    seed,
    index,
    turn: board.turnNumber,
    expectedTurn: turn,
    ok: board.turnNumber === turn,
    credits: board.corp.credits,
    hq: hq.map(h => `${h.kind}:${h.title}`),
    nonAgendaInHQ: hq.filter(h => h.kind !== 'agenda').length,
    server,
    root,
    answer: (answers[0] as { choice?: { optionId?: string } }).choice?.optionId,
    trashed: kinds(board, trashed),
    stolenFromArchives: steal,
    winner: g.state.winner,
    score: `${g.state.corp.score}-${g.state.runner.score}`,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  if (process.env.DUMP && boards.length === 1) writeFileSync(process.env.DUMP, JSON.stringify({ seed, index, state: board, answers, line: steal ? line.slice(0, steal.moves) : [], steal }));
}
const ok = rows.filter(r => r.ok) as { nonAgendaInHQ: number; stolenFromArchives: unknown }[];
console.log(JSON.stringify({ boards: rows.length, reached: ok.length, twoNonAgenda: ok.filter(r => r.nonAgendaInHQ >= 2).length, stolenFromArchives: ok.filter(r => r.stolenFromArchives).length, notReached: rows.filter(r => !r.ok) }));
