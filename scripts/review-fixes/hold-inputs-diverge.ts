/**
 * Bundle H build (netrunner-ai/review-fixes-1119/hold-inputs/brief.md rev 2, "Judged by", the g1): for each deal whose
 * g1 record differs from the base's, the first decision where the branch plays otherwise, and the commit that first
 * gives the branch's answer there.
 *
 * Trees (each its own module graph, breaker-once-trees' loadTree): this checkout's src with hold.ts, rezMoney.ts and
 * runs.ts from each of TREES (the merge base first; the last is this checkout's src, checked). The deal is played by the
 * first tree and the last in lockstep (two GameRunners, Normal v Normal, as the batch); at the first step whose actions
 * differ, the board and both agents' state before it are asked of every tree (fresh agents, the base game's agent
 * state copied in, hand caches cleared). The commit named is the first tree whose answer is not the base's.
 *
 *   ARGS="DEALS=1001,1002 TREES=<sha0>,...,<shaN>" npx vite-node scripts/review-fixes/hold-inputs-diverge.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { Tree, loadTree } from '../stage-vc/breaker-once-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const SHAS = (process.env.TREES ?? '').split(',').filter(Boolean);
if (SHAS.length < 2 || SHAS.some(s => !/^[0-9a-f]{40}$/.test(s))) throw new Error('TREES=<full sha>,... (the merge base first)');
const SEEDS = (process.env.DEALS ?? '').split(',').filter(Boolean).map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/hold-inputs-diverge');
const FILES = ['ai/corp/hold.ts', 'ai/corp/rezMoney.ts', 'ai/runs.ts'];
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));

type Snap = Record<string, unknown>;
function snapAgent(agent: any): Snap {
  const s: Snap = {};
  for (const [k, v] of Object.entries(agent)) {
    if (typeof v === 'function') continue;
    try {
      s[k] = structuredClone(v);
    } catch {
      /* not cloneable */
    }
  }
  return s;
}
function restore(fresh: any, snap: Snap | undefined) {
  if (!snap) return fresh;
  for (const [k, v] of Object.entries(snap)) {
    const cur = fresh[k];
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && !(cur instanceof Map) && !(cur instanceof Set) && Object.getPrototypeOf(cur) !== Object.prototype) Object.assign(cur, structuredClone(v));
    else fresh[k] = structuredClone(v);
  }
  return fresh;
}

function makeTrees(): Promise<Tree[]> {
  rmSync(root, { recursive: true, force: true });
  const last = SHAS[SHAS.length - 1];
  try {
    execSync(`git diff --quiet ${last} HEAD -- src`, { stdio: 'ignore' });
  } catch {
    throw new Error(`the last of TREES must have this checkout's src (${last})`);
  }
  return (async () => {
    const trees: Tree[] = [];
    for (const [k, sha] of SHAS.entries()) {
      const dir = join(root, String(k));
      mkdirSync(dir, { recursive: true });
      cpSync('src', join(dir, 'src'), { recursive: true });
      for (const f of FILES) writeFileSync(join(dir, 'src', f), execSync(`git show ${sha}:src/${f}`, { maxBuffer: 1 << 26 }));
      trees.push(await loadTree(sha.slice(0, 7), dir));
    }
    return trees;
  })();
}

function label(t: Tree, s: GameState, a: GameAction | null): string {
  if (!a) return 'none';
  const x = a as any;
  const title = (id: string) => {
    const c = t.core.findCardAnywhere(s, id);
    return c ? t.core.cardDef(c).title : id;
  };
  if (a.type === 'RESOLVE_PROMPT') {
    const c = x.choice;
    if (c.kind === 'effect_choice') return `prompt:${c.optionId}`;
    if (c.kind === 'effect_cards') return `prompt:[${c.cardInstanceIds.map(title).join(', ')}]`;
    return `prompt:${c.kind}`;
  }
  const id = x.cardInstanceId;
  return id ? `${a.type} ${title(id)}${x.targetServerId ? `>${x.targetServerId}` : ''}` : `${a.type}${x.server ? `>${x.server}` : ''}`;
}

const trees = await makeTrees();
const [base, head] = [trees[0], trees[trees.length - 1]];
for (const seed of SEEDS) {
  base.clear();
  const agB = { corp: base.createAgent('corp', 'normal'), runner: base.createAgent('runner', 'normal') };
  const gB = new base.GameRunner(dealState(seed), agB);
  head.clear();
  const agH = { corp: head.createAgent('corp', 'normal'), runner: head.createAgent('runner', 'normal') };
  const gH = new head.GameRunner(dealState(seed), agH);
  let found = false;
  for (let n = 0; n < 4000; n++) {
    const s: GameState = structuredClone(gB.state);
    const snaps = { corp: snapAgent(agB.corp), runner: snapAgent(agB.runner) };
    const goB = gB.step();
    const goH = gH.step();
    if (key(gB.last) !== key(gH.last) || goB !== goH) {
      const side = base.core.actingSide(s);
      const answers = trees.map(t => {
        t.clear();
        const g = new t.GameRunner(structuredClone(s), { corp: restore(t.createAgent('corp', 'normal'), snaps.corp), runner: restore(t.createAgent('runner', 'normal'), snaps.runner) });
        try {
          g.step();
          return key(g.last);
        } catch (e) {
          return `error: ${(e as Error).message.slice(0, 80)}`;
        }
      });
      const first = answers.findIndex(a => a !== answers[0]);
      out({
        kind: 'diverge',
        seed,
        step: n,
        T: s.turnNumber,
        active: s.activePlayer,
        side,
        run: s.activeRun ? { server: s.activeRun.server, phase: s.activeRun.phase, pos: s.activeRun.icePosition } : null,
        prompt: base.core.activePrompt(s) ? { kind: base.core.activePrompt(s).kind, code: base.core.activePrompt(s).source?.cardCode ?? null } : null,
        base: label(base, s, gB.last),
        head: label(head, s, gH.last),
        reaskBaseMatches: answers[0] === key(gB.last),
        reaskHeadMatches: answers[answers.length - 1] === key(gH.last),
        commit: first < 0 ? null : trees[first].name,
        perTree: answers.map((a, i) => `${trees[i].name}: ${a === answers[0] ? 'base' : a === answers[answers.length - 1] ? 'head' : 'other'}`),
        corpCredits: s.corp.credits,
        runnerCredits: s.runner.credits,
      });
      found = true;
      break;
    }
    if (!goB) break;
  }
  if (!found) out({ kind: 'same', seed, winner: gB.state.winner ?? null, T: gB.state.turnNumber });
}
rmSync(root, { recursive: true, force: true });
