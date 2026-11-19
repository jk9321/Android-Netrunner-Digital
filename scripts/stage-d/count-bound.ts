/**
 * The count bound item, step 1 (brief: /mnt/project-files/netrunner-ai/stage-d/count-bound/brief.md), parts A, B and C on
 * the 92 sources: every Corp decision of the 56 local deals (scripts/stage-a/harness.ts deals(), played by the `source`
 * tree, never asked or cleared mid-game: found row 71b) and of the 36 human games (recorded moves replayed; report-40b
 * and 40c from their `state`).
 *
 * At every state where GameRunner.step asks the Corp (askAt): a fresh Normal Corp of base, control and arm, each on its
 * own clone, REPS times (default 3) with the order rotated, medians kept (`d` line: ms, whether arm's and control's
 * answers are base's); then once on the instr tree: the split of the decision's time into the hold count's parts
 * (count-bound-lib.ts: gather, key, searchHolds, searchOpen, entries, thisRun, runStands, reach, outside), serverHold
 * asked and searched, the walk nodes. Every question the decision gathered that this process has not seen is searched
 * three ways (beta, arm, brute force) and gets a `q` line (facts, the three answers, B1's violations and their causes;
 * the question's ice facts where a violation is found).
 *
 * Units: each deal whole; each human game in chunks of CHUNK Corp decisions (default 12; the chunk's shard replays the
 * moves up to it). Unit k goes to shard k % shards. Hidden information: the agents see what GameRunner gives them; the
 * searches read the gathered question only.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/count-bound.ts
 *   DEALS=1001 HUMAN=none REPS=1 npx vite-node scripts/stage-d/count-bound.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { Tree, ask, askAt, askInstr, iceFacts, loadTree, makeTrees, median, out, pairCause, r1, searchQuestion } from './count-bound-lib';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const REPS = Number(process.env.REPS ?? 3);
const CHUNK = Number(process.env.CHUNK ?? 12);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const qid = (k: string) => createHash('md5').update(k).digest('hex').slice(0, 16);

async function main() {
  // ARM: the timed arm's tree (`arm` largestFirst, default; `gm` gatherMemo, B3). Q=0: no instr ask, no question searches
  const ARM = process.env.ARM ?? 'arm';
  const NOQ = process.env.Q === '0';
  const names = ['base', 'control', ARM, ...(NOQ ? [] : ['instr']), 'source'] as any[];
  const dirs = makeTrees(join(process.env.TROOT ?? 'node_modules/.cache/cb-src', String(shard)), names);
  const trees: Record<string, Tree> = {};
  for (const t of names) trees[t] = await loadTree(t, dirs[t]);
  trees.arm = trees[ARM];
  const seen = new Set<string>();
  const TIMED = ['base', 'control', 'arm'];

  // Units: a deal whole, a human game per chunk of its Corp decisions (the count of them read from a dry replay)
  type Unit = { kind: 'deal'; seed: number } | { kind: 'human'; file: string; from: number; to: number };
  const units: Unit[] = deals().map(seed => ({ kind: 'deal' as const, seed }));
  const core = trees.base.core;
  const startOf = (report: any): GameState => {
    if (report.startsAt === 'state') return structuredClone(report.state);
    let s = core.createInitialGameState(trees.base.decks.deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    return s;
  };
  const reports = new Map<string, any>();
  for (const file of humanFiles()) {
    const report = JSON.parse(readFileSync(file, 'utf8'));
    if (!report.moves?.length) continue;
    reports.set(file, report);
    let s = startOf(report);
    let n = 0;
    for (const move of report.moves as GameAction[]) {
      if (askAt(trees.base, s)?.side === 'corp') n++;
      try {
        s = core.executeAction(s, move);
      } catch {
        break;
      }
    }
    for (let from = 0; from < n; from += CHUNK) units.push({ kind: 'human', file, from, to: Math.min(n, from + CHUNK) });
  }
  if (shard === 0) out({ kind: 'units', n: units.length, deals: units.filter(u => u.kind === 'deal').length });

  const decide = (src: string, i: number, s: GameState) => {
    const q = askAt(trees.base, s);
    if (!q || q.side !== 'corp') return false;
    const ms: Record<string, number[]> = {};
    const ans: Record<string, string> = {};
    for (let rep = 0; rep < REPS; rep++) {
      const rot = (i + rep) % 3;
      for (const t of [...TIMED.slice(rot), ...TIMED.slice(0, rot)]) {
        const r = ask(trees[t], q);
        (ms[t] ??= []).push(r.ms);
        if (rep === 0) ans[t] = r.a;
        else if (ans[t] !== r.a) ans[t] = `${ans[t]} | rep ${rep}: ${r.a}`;
      }
    }
    if (NOQ) {
      const row: Record<string, unknown> = { kind: 'd', src, i, T: s.turnNumber, fn: q.fn, arm: ARM, ms: Object.fromEntries(TIMED.map(t => [t, r1(median(ms[t]))])), all: Object.fromEntries(TIMED.map(t => [t, ms[t].map(r1)])) };
      if (ans.arm !== ans.base) Object.assign(row, { changed: true, base: ans.base.slice(0, 220), arm: ans.arm.slice(0, 220) });
      if (ans.control !== ans.base) Object.assign(row, { controlDiffers: true, control: ans.control.slice(0, 220) });
      out(row);
      return true;
    }
    const ins = askInstr(trees.instr, q);
    const row: Record<string, unknown> = {
      kind: 'd',
      src,
      i,
      T: s.turnNumber,
      fn: q.fn,
      ms: Object.fromEntries(TIMED.map(t => [t, r1(median(ms[t]))])),
      all: Object.fromEntries(TIMED.map(t => [t, ms[t].map(r1)])),
      instr: r1(ins.ms),
      split: Object.fromEntries(Object.entries(ins.split).map(([k, v]) => [k, r1(v)])),
      asked: ins.asked,
      searched: ins.searched,
      runStands: ins.runStands,
      nodes: ins.searches.reduce((n, x) => n + x.nodes, 0),
      nodesOpen: ins.searches.filter(x => !x.holds).reduce((n, x) => n + x.nodes, 0),
      entriesNodes: ins.entriesNodes,
      walks: ins.searches.reduce((n, x) => n + x.walksOne + x.walksTurn, 0),
      questions: [...ins.questions.keys()].map(qid),
    };
    if (ans.arm !== ans.base) Object.assign(row, { changed: true, base: ans.base.slice(0, 220), arm: ans.arm.slice(0, 220) });
    if (ans.control !== ans.base) Object.assign(row, { controlDiffers: true, control: ans.control.slice(0, 220) });
    if (ins.a !== ans.base) Object.assign(row, { instrDiffers: true, instrA: ins.a.slice(0, 220) });
    out(row);
    for (const [k, qq] of ins.questions) {
      const id = qid(k);
      if (seen.has(id)) continue;
      seen.add(id);
      const sq = searchQuestion(trees.instr, qq);
      const byMask = new Map(sq.rows.map(x => [x.mask, x]));
      const causes: Record<string, number> = {};
      for (const [a, b] of [...sq.v1, ...sq.v2.map(v => [v[0], v[1]] as [number, number])]) for (const c of pairCause(qq, a, b, byMask).causes) causes[c] = (causes[c] ?? 0) + 1;
      // Compact (the sources ask tens of thousands of questions): f = facts [server, ice, unrezzed, sets, affordable,
      // maximal, rig, budget, clicks]; b, a, t = beta, arm, arm with beta's tie fill [holds, mask, need, entries, ms,
      // entriesMs, nodes, entriesNodes, walksOne, walksTurn]; br = brute force [ms, nodes, sets that hold, agrees with beta]
      const ans = (x: any) => [x.holds ? 1 : 0, x.mask, x.need === Infinity ? 'inf' : x.need, x.entries, x.ms, x.entriesMs, x.nodes, x.entriesNodes, x.walks[0], x.walks[1]];
      const f = sq.facts;
      const sameAs = (y: any) => sq.beta.holds === y.holds && (!sq.beta.holds || sq.beta.mask === y.mask) && sq.beta.need === y.need && sq.beta.entries === y.entries;
      out({
        kind: 'q',
        src,
        i,
        qid: id,
        f: [f.server, f.ice, f.unrezzed, f.sets, f.affordable, f.maximal, f.rig, f.budget, f.clicks],
        b: ans(sq.beta),
        a: ans(sq.arm),
        t: ans(sq.armTie),
        br: [sq.brute.ms, sq.brute.nodes, sq.brute.holdsSets, sq.brute.agrees ? 1 : 0],
        same: sameAs(sq.arm) ? 1 : 0,
        tieSame: sameAs(sq.armTie) && sq.beta.mask === sq.armTie.mask ? 1 : 0,
        ...(sq.cls.length ? { cls: sq.cls } : {}),
        ...(sq.v1.length || sq.v2.length ? { v1: sq.v1.length, v2: sq.v2.length, v1pairs: sq.v1.slice(0, 5), v2pairs: sq.v2.slice(0, 5), causes, iceFacts: iceFacts(qq), sets: sq.rows.length <= 64 ? sq.rows.map(r => [r.mask, r.rez, r.need === Infinity ? 'inf' : r.need, r.holds ? 1 : 0]) : undefined } : {}),
      });
    }
    return true;
  };

  for (const [k, u] of units.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    let n = 0;
    if (u.kind === 'deal') {
      const t = trees.source;
      t.clear();
      const g = new t.GameRunner(dealState(u.seed), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
      for (let m = 0; m < 4000 && !g.state.winner; m++) {
        if (decide(`deal:${u.seed}`, n, g.state)) n++;
        if (!g.step()) break;
      }
      out({ kind: 's', src: `deal:${u.seed}`, decisions: n, ms: Math.round(performance.now() - t0) });
    } else {
      const report = reports.get(u.file);
      const name = `human:${u.file.split('/').pop()}`;
      let s = startOf(report);
      let stopped: string | null = null;
      for (const [j, move] of (report.moves as GameAction[]).entries()) {
        if (askAt(trees.base, s)?.side === 'corp') {
          if (n >= u.from && n < u.to) decide(name, n, s);
          n++;
          if (n >= u.to) break;
        }
        try {
          s = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      out({ kind: 's', src: name, from: u.from, to: u.to, stopped, ms: Math.round(performance.now() - t0) });
    }
  }
  out({ kind: 'mem', shard, maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024) });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
