/**
 * The count bound item, step 2 (brief-2.md), Part F: the engine oracle (hold-oracle.ts: the Runner's whole turn in the
 * engine, retries on) on the 17 source questions where a rez set holds and a superset does not (V1, count note B1).
 *
 * The decisions that gathered them (deal 1201 #75, #92 to #94, played by the `source` tree; report-33 #117, #119, #131,
 * replayed) are asked again on the `fq` tree (the instr tree, each gathered question's board and arguments recorded).
 * For each listed question (by its qid, as count-bound.ts names it) and its V1 pair (smaller set, superset), the
 * oracle is asked on the question's own board for each set, with and without jacking out, beside beta's answer of each
 * set (the count's brute force: single-run need, holds). Corp credits: the question's (unlimited = credits plus every
 * rez cost on the server, as corpStart reads it).
 *
 *   npx vite-node scripts/stage-d/count-bound-oracle.ts > oracle.jsonl
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { GameAction, GameState } from '../../src/core';
import { dealState, humanFiles } from '../stage-a/harness';
import { oracle } from './hold-oracle';
import { ask, askAt, cb, loadTree, makeTrees, out, searchQuestion } from './count-bound-lib';

const qid = (k: string) => createHash('md5').update(k).digest('hex').slice(0, 16);
// The 17 questions (count note B1): source, decision, qid, the V1 pair of masks
const Q: [string, number, string, number, number][] = [
  ['deal:1201', 75, 'c9a6d0fb18d51b9a', 0, 8],
  ['deal:1201', 75, '0dde44688dfa32ed', 0, 8],
  ['deal:1201', 92, 'd13e3704fa97fed0', 0, 4],
  ['deal:1201', 92, '0eab3b6e1a1ccc2a', 0, 4],
  ['deal:1201', 92, '82298578479e16c8', 0, 4],
  ['deal:1201', 93, '098221d4c73ee698', 0, 4],
  ['deal:1201', 93, '171c3cd15d25d90c', 0, 4],
  ['deal:1201', 93, '7d584f7a18a5370b', 0, 4],
  ['deal:1201', 94, '7ae09a4413becdbb', 0, 4],
  ['deal:1201', 94, '8c59d5444d7c9f4c', 0, 4],
  ['deal:1201', 94, '0494b85d27674ec4', 0, 4],
  ['human:report-33.json', 117, '3ab41331f7921d72', 2, 6],
  ['human:report-33.json', 117, '96e4b3e9d04838d7', 2, 6],
  ['human:report-33.json', 119, 'f75d63f23beeb63c', 2, 6],
  ['human:report-33.json', 131, '546e7b4aa2f7d50d', 6, 14],
  ['human:report-33.json', 131, '6c07cccf915a4fb0', 6, 14],
  ['human:report-33.json', 131, '55bc5c132c442919', 6, 14],
];
const CAP = Number(process.env.CAP ?? 200000);

async function main() {
  const dirs = makeTrees(process.env.TROOT ?? 'node_modules/.cache/cb-oracle', ['fq', 'source']);
  const fq = await loadTree('fq', dirs.fq);
  const source = await loadTree('source', dirs.source);
  const boards = new WeakMap<object, any>();
  (globalThis as any).__cbq = (q: object, state: GameState, server: string, corpCredits: number, from: any, picked?: string[]) => {
    if (cb.on) boards.set(q, { state: structuredClone(state), server, corpCredits, from, picked });
  };
  const at = new Map<string, [string, number, number][]>();
  for (const [src, i, id, a, b] of Q) (at.get(`${src}#${i}`) ?? at.set(`${src}#${i}`, []).get(`${src}#${i}`)!).push([id, a, b]);
  const found = new Set<string>();

  const decide = (src: string, i: number, s: GameState) => {
    const want = at.get(`${src}#${i}`);
    if (!want) return;
    const q = askAt(fq, s)!;
    cb.on = true;
    cb.questions = new Map();
    cb.split = {};
    cb.stack = [];
    cb.searches = [];
    try {
      ask(fq, q);
    } finally {
      cb.on = false;
    }
    for (const [k, qq] of cb.questions) {
      const id = qid(k);
      const w = want.find(x => x[0] === id);
      if (!w || found.has(id)) continue;
      found.add(id);
      const b = boards.get(qq as object);
      const tq = qq as any;
      const sq = searchQuestion(fq, tq);
      const row = (mask: number) => sq.rows.find(r => r.mask === mask);
      const ids = (mask: number) => tq.ice.filter((_: any, j: number) => mask & (1 << j)).map((c: any) => c.id);
      const st: GameState = b.state;
      // FLOOR=1: the Runner's credits rounded down (the gathered boards can carry a priced, fractional credit count)
      if (process.env.FLOOR === '1') st.runner.credits = Math.floor(st.runner.credits);
      const iceOn = st.corp.servers[b.server]?.ice ?? [];
      const credits = b.corpCredits === undefined ? st.corp.credits : Number.isFinite(b.corpCredits) ? b.corpCredits : st.corp.credits + iceOn.filter(c => !c.isRezzed).reduce((n, c) => n + (fq.core.rezCostOf?.(st, c) ?? 0), 0);
      if (process.env.DUMP === '1') for (const mask of [w[1], w[2]]) for (const jackOut of [false, true]) out({ kind: 'fb', src, i, qid: id, mask, jackOut, server: b.server, rez: ids(mask), credits, state: st });
      if (process.env.DUMP === '1') continue;
      const sets = [w[1], w[2]].map(mask => {
        const r = row(mask);
        const o = (jackOut: boolean) => {
          const x = oracle(st, { when: 'runnerTurn', targets: [b.server], rez: new Set(ids(mask)), corpCredits: credits, cap: CAP, retries: true, jackOut });
          return { reached: x.reached, work: x.work, skipped: x.skipped, moved: x.moved, line: (x as any).line?.slice?.(0, 40) };
        };
        return { mask, ice: ids(mask).map((x: string) => `${x}:${st.corp.servers[b.server]?.ice.find(c => c.instanceId === x)?.cardCode ?? '?'}`), beta: r ? { need: r.need, holds: r.holds } : null, oracle: o(false), oracleJackOut: o(true) };
      });
      out({
        kind: 'f',
        src,
        i,
        qid: id,
        T: st.turnNumber,
        board: { server: b.server, corpCredits: b.corpCredits ?? 'as on the board', corpOnBoard: st.corp.credits, credits, from: b.from, picked: b.picked, runner: { credits: st.runner.credits, clicks: st.runner.clicks, maxClicks: st.runner.maxClicks, rig: [...st.runner.rig.programs, ...st.runner.rig.hardware, ...st.runner.rig.resources].map(c => c.cardCode) }, ice: iceOn.map(c => `${c.instanceId}:${c.cardCode}${c.isRezzed ? '' : '(u)'}`), activePlayer: st.activePlayer, corpClicks: st.corp.clicks },
        budget: tq.budget,
        betaAnswer: { holds: sq.beta.holds, mask: sq.beta.mask, need: sq.beta.need },
        sets,
      });
    }
  };

  // deal 1201, played whole by the source tree (never asked or cleared mid-game)
  source.clear();
  const g = new source.GameRunner(dealState(1201), { corp: source.createAgent('corp', 'normal'), runner: source.createAgent('runner', 'normal') });
  let n = 0;
  for (let m = 0; m < 4000 && !g.state.winner && n <= 94; m++) {
    if (askAt(fq, g.state)?.side === 'corp') decide('deal:1201', n++, g.state);
    if (!g.step()) break;
  }
  if (process.env.ONLY_DEAL === '1') return out({ kind: 'done', found: found.size });
  // report-33, replayed
  const file = humanFiles().find(f => f.endsWith('report-33.json'))!;
  const report = JSON.parse(readFileSync(file, 'utf8'));
  let s: GameState = report.startsAt === 'state' ? structuredClone(report.state) : fq.core.createInitialGameState(fq.decks.deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startsAt !== 'state' && report.startStops) s = { ...s, stops: report.startStops };
  n = 0;
  for (const move of report.moves as GameAction[]) {
    if (askAt(fq, s)?.side === 'corp') decide('human:report-33.json', n++, s);
    if (n > 131) break;
    s = fq.core.executeAction(s, move);
  }
  out({ kind: 'done', found: found.size, missing: Q.filter(x => !found.has(x[2])).map(x => x[2]) });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
