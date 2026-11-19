/**
 * The count bound item, step 1 (brief: /mnt/project-files/netrunner-ai/stage-d/count-bound/brief.md), part C: how far a
 * legal Runner rig from the test decks pushes the work of one question on a recorded board.
 *
 * The board: a Corp decision of a source (SRC = deal:<seed> or human:<file name>, I = its Corp decision index, as
 * count-bound.ts numbers them; default the heaviest decision of the sources run). On it, the Runner's rig is replaced by
 * each Runner test deck's rig (starters, NSG samples, NRDB lists, identity decks): one copy of each of its programs,
 * hardware and resources, a single console, programs installed breakers first while their memory fits (memoryLimit with
 * the deck's hardware in), so a rig that deck can field (no grip or stack read). The Runner's credits, clicks, tags and
 * grip stay the board's. On each server with ice, serverHold 'runnerTurn' with the Corp's credits as they are and
 * unlimited (rezMoney's ask) is asked on the instr tree, and every question gathered is searched beta's way and the
 * arm's (count-bound-lib.ts searchQuestion): nodes and ms per question, the most per rig. Also: the board's own rig.
 *
 *   SRC=human:report-40.json I=28 npx vite-node scripts/stage-d/count-bound-rig.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import type { GameAction, GameState } from '../../src/core';
import { createInitialGameState, executeAction } from '../../src/core';
import { ALL_CARDS } from '../../src/core/cards';
import { createCardInstance } from '../../src/core/engine/gameState';
import { memoryLimit } from '../../src/core/engine/cardEffects';
import { STARTER_DECKS } from '../../src/data/decks';
import { NSG_SAMPLE_DECKS } from '../../src/data/testDecks/nsgSamples';
import { NRDB_TEST_DECKS } from '../../src/data/testDecks/nrdb';
import { IDENTITY_TEST_DECKS } from '../../src/data/testDecks/identityDecks';
import { GameRunner } from '../../src/ai/playout';
import { createAgent } from '../../src/ai';
import { deckGameSetup } from '../../src/data/decks';
import { dealState, humanFiles } from '../stage-a/harness';
import { askAt, cb, loadTree, makeTrees, out, r1, searchQuestion } from './count-bound-lib';

const SRC = process.env.SRC ?? 'human:report-40.json';
const I = Number(process.env.I ?? 28);
const byTitle = new Map(ALL_CARDS.map(c => [c.title, c]));

async function main() {
  const dirs = makeTrees(process.env.TROOT ?? 'node_modules/.cache/cb-rig', ['instr']);
  const t = await loadTree('instr', dirs.instr);
  // The board: the source replayed (or played) to its Corp decision I
  let board: GameState | null = null;
  let n = 0;
  if (SRC.startsWith('deal:')) {
    const g = new GameRunner(dealState(Number(SRC.slice(5))), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    for (let m = 0; m < 4000 && !g.state.winner; m++) {
      if (askAt(t, g.state)?.side === 'corp') {
        if (n === I) {
          board = structuredClone(g.state);
          break;
        }
        n++;
      }
      if (!g.step()) break;
    }
  } else {
    const file = humanFiles().find(f => f.endsWith(SRC.slice(6)))!;
    const report = JSON.parse(readFileSync(file, 'utf8'));
    let s: GameState = report.startsAt === 'state' ? structuredClone(report.state) : createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startsAt !== 'state' && report.startStops) s = { ...s, stops: report.startStops };
    for (const move of report.moves as GameAction[]) {
      if (askAt(t, s)?.side === 'corp') {
        if (n === I) {
          board = structuredClone(s);
          break;
        }
        n++;
      }
      s = executeAction(s, move);
    }
  }
  if (!board) throw new Error(`no Corp decision ${I} in ${SRC}`);
  const servers = Object.keys(board.corp.servers).filter(id => board!.corp.servers[id].ice.length);
  const ask = (s: GameState, label: string) => {
    let most = { nodes: 0, ms: 0, arm: 0, armMs: 0, server: '', unrezzed: 0, sets: 0 };
    let total = 0;
    let armTotal = 0;
    let questions = 0;
    for (const server of servers)
      for (const corpCredits of [undefined, Infinity]) {
        cb.on = true;
        cb.questions = new Map();
        cb.searches = [];
        cb.split = {};
        cb.stack = [];
        t.clear();
        try {
          t.asSide('corp', () => (t.decisionContext(s, 'corp'), t.hold.serverHold(s, server, { when: 'runnerTurn', ...(corpCredits ? { corpCredits } : {}) })));
        } finally {
          cb.on = false;
        }
        for (const q of cb.questions.values()) {
          const sq = searchQuestion(t, q);
          questions++;
          total += sq.beta.nodes + sq.beta.entriesNodes;
          armTotal += sq.arm.nodes + sq.arm.entriesNodes;
          if (sq.beta.nodes + sq.beta.entriesNodes > most.nodes) most = { nodes: sq.beta.nodes + sq.beta.entriesNodes, ms: r1(sq.beta.ms + sq.beta.entriesMs), arm: sq.arm.nodes + sq.arm.entriesNodes, armMs: r1(sq.arm.ms + sq.arm.entriesMs), server, unrezzed: sq.facts.unrezzed, sets: sq.facts.affordable };
        }
      }
    const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => byTitle.get(ALL_CARDS.find(x => x.code === c.cardCode)?.title ?? '')?.title ?? c.cardCode);
    out({ kind: 'r', label, rig: rig.length, cards: rig, mu: `${s.runner.rig.programs.reduce((m, c) => m + (ALL_CARDS.find(x => x.code === c.cardCode)?.memory_cost ?? 0), 0)}/${memoryLimit(s)}`, questions, nodes: total, armNodes: armTotal, most });
  };
  out({ kind: 'board', src: SRC, i: I, T: board.turnNumber, servers: servers.map(id => `${id}:${board!.corp.servers[id].ice.length}(${board!.corp.servers[id].ice.filter(c => !c.isRezzed).length} unrezzed)`), runner: { credits: board.runner.credits, clicks: board.runner.maxClicks, tags: board.runner.tags, grip: board.runner.grip.length } });
  ask(board, 'the board as recorded');
  for (const deck of [...STARTER_DECKS, ...NSG_SAMPLE_DECKS, ...NRDB_TEST_DECKS, ...IDENTITY_TEST_DECKS].filter(d => d.side === 'runner')) {
    const s = structuredClone(board);
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    const defs = Object.keys(deck.cards).map(title => byTitle.get(title)).filter(Boolean) as any[];
    let console_ = false;
    for (const d of defs.filter(x => x.type_code === 'hardware')) {
      if (/console/i.test(d.keywords ?? '')) {
        if (console_) continue;
        console_ = true;
      }
      const c = createCardInstance(s, d.code);
      c.isRezzed = true;
      s.runner.rig.hardware.push(c);
    }
    for (const d of defs.filter(x => x.type_code === 'resource')) {
      const c = createCardInstance(s, d.code);
      c.isRezzed = true;
      s.runner.rig.resources.push(c);
    }
    const progs = defs.filter(x => x.type_code === 'program').sort((a, b) => Number(/icebreaker/i.test(b.keywords ?? '')) - Number(/icebreaker/i.test(a.keywords ?? '')));
    let used = 0;
    for (const d of progs) {
      if (used + (d.memory_cost ?? 0) > memoryLimit(s)) continue;
      const c = createCardInstance(s, d.code);
      c.isRezzed = true;
      s.runner.rig.programs.push(c);
      used += d.memory_cost ?? 0;
    }
    s.runner.memoryUnitsUsed = used;
    ask(s, `${deck.name} (${deck.identity})`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
