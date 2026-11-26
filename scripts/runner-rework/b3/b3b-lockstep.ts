/**
 * B3b, bars 4, 6 and 7 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b3-prompt-view.md rev 2; the cap ruled
 * B in runner-rework/b3/b3b-cap-question.md): this checkout's tree (`branch`, B3b: trojanHostWorth's two inputs, the
 * install action's trojanHostValue gone) against BASE (beta), step by step, on the base pools of g1 45716865309 and NRDB
 * g1 45721175528; `control` is BASE again. lockstep.ts's hashing (core-hooks.ts HOOKS, one stream per step), with three
 * reach hooks in every tree in place of commit 0's (lines that read the same on both sides of B3b):
 *   ans    answerPrompt at a Runner host prompt for a trojan (the prompt's effect_choice names the trojan's card id)
 *   inst   scoreMain at a trojan install on a host (the install action's host term: trojanHostValue on the base tree)
 *   owner  trojanHostWorth asked of a hosted trojan (the board's own term; runnerRigValue reaches it from the Corp's leaf)
 * each with its scope (top = the game's own decision; inside = a look-ahead or the reply inside it), read on the branch
 * tree (the trees are equal up to the first difference).
 *
 * Bar 4, the first difference counted apart (the brief's four kinds and the Corp side's condition 7 row):
 *   host     the deciding Runner's answer at a trojan host prompt
 *   install  a deciding-Runner main decision whose pick, on either tree, is a trojan install on a host
 *   held     another Runner decision whose candidates or look-ahead held one (an ans, inst or owner reach at the step)
 *   reply    a Corp decision whose Runner reply held a host answer or a trojan install (ans or inst inside it)
 *   corpLeaf a Corp decision with neither, whose own board score read the owner (owner reach only)
 *   other    anything else: traced by deal, an untraced Corp one is a stop
 *
 * Bar 6: after the first difference (or at the end of an identical deal) base and branch each play their own game to the
 * end; per tree and game: trojan installs by the click action and by a host prompt, the ice that hosted a trojan, second
 * copies (an install onto ice that already hosts the same trojan; `secondEmpty`: while an empty legal host was offered,
 * host prompts only), trojan subroutines broken (virus counters a hosted breaking trojan spent during a run), runs by
 * server kind, the winner and the turns.
 *
 * Bar 7: time per tree by the deciding side and kind over the identical prefix (the same decisions on every tree), the host
 * prompt answers apart; control against base is the spread.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/b3/b3b-lockstep.ts -- BASE=<sha> POOL=batch,nrdb
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../../src/core';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';
import { Tree, loadTree } from '../facts-trees';
import { HOOKS, Patch, applyPatches } from '../core-hooks';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '58ced2b326c0ab3bb1f816ea10c46de3ca118199';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/b3b-lockstep', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 6000);
const PLAYON = process.env.PLAYON !== '0';
const RECORDS = (process.env.RECORDS ?? '45716865309,45721175528').split(',');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => (a === undefined ? 'undefined' : JSON.stringify(a));
const G = globalThis as any;
const NAMES = ['base', 'branch', 'control'] as const;
type Name = (typeof NAMES)[number];

const REACH: Patch[] = [
  [
    'ai/prompts.ts',
    `export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {\n`,
    `export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {\n  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  (globalThis as any).__b3bAns?.(state, side);\n`,
  ],
  [
    'ai/runnerAI.ts',
    `    if (action.type === 'INSTALL_CARD' && action.hostInstanceId && cardCode && isTrojan(cardCode)) {\n`,
    `    if (action.type === 'INSTALL_CARD' && action.hostInstanceId && cardCode && isTrojan(cardCode)) {\n      // eslint-disable-next-line @typescript-eslint/no-explicit-any\n      (globalThis as any).__b3bReach?.('inst');\n`,
  ],
  [
    'ai/counterValues.ts',
    `export function trojanHostWorth(state: GameState, card: CardInstance, worth: (host: CardInstance) => number): number {\n`,
    `export function trojanHostWorth(state: GameState, card: CardInstance, worth: (host: CardInstance) => number): number {\n  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  if (card.hostedOnId) (globalThis as any).__b3bReach?.('owner');\n`,
  ],
];

function makeTrees(): Record<Name, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (let tries = 0; ; tries++) {
    try {
      execSync(`git cat-file -e ${BASE}^{commit}`, { stdio: 'ignore' });
      break;
    } catch {
      try {
        execSync(`git fetch --depth 1 origin ${BASE}`, { stdio: 'ignore' });
      } catch (e) {
        if (tries >= 8) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 + 700 * (shard % 4));
      }
    }
  }
  const dirs = {} as Record<Name, string>;
  const read = (p: string) => readFileSync(p, 'utf8');
  const write = (p: string, t: string) => writeFileSync(p, t);
  for (const name of NAMES) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    if (name === 'branch') cpSync('src', join(dir, 'src'), { recursive: true });
    else execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
    applyPatches(dir, [...HOOKS, ...REACH], `tree ${name}`, read, write);
    dirs[name] = dir;
  }
  return dirs;
}
let T: Record<Name, Tree>;

type Acc = { n: number; h: number };
const fresh = (): Acc => ({ n: 0, h: 0x811c9dc5 });
const fnv = (acc: Acc, x: string) => {
  let h = acc.h;
  for (let i = 0; i < x.length; i++) {
    h ^= x.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= 0x1f;
  acc.h = Math.imul(h, 0x01000193) >>> 0;
  acc.n++;
};
const isTrojan = (t: Tree, code: string) => !!t.cards[code]?.runFacts?.trojan;
const breaks = (t: Tree, code: string) => !!t.cards[code]?.holdFacts?.breaksHostSubroutine;
/** A Runner host prompt for a trojan: its effect_choice carries the card being installed (the host step's data). */
function hostPromptOf(t: Tree, s: GameState): { cardId: string; code: string; options: string[] } | null {
  const p: any = t.core.activePrompt(s);
  if (!p || p.side !== 'runner' || p.kind !== 'effect_choice' || typeof p.source?.data?.cardId !== 'string') return null;
  const code = t.core.findCardAnywhere(s, p.source.data.cardId)?.cardCode ?? '';
  const ice = new Set(Object.values(s.corp.servers).flatMap(v => v.ice.map(c => c.instanceId)));
  if (!isTrojan(t, code) || !p.options.every((o: any) => ice.has(o.id))) return null;
  return { cardId: p.source.data.cardId, code, options: p.options.map((o: any) => o.id) };
}
type Reach = { what: string; scope: string };
/** Every hook writes into one stream, each record labelled with its kind and scope path; reaches go to `reach` (branch only). */
function listen(t: Tree, rec: Acc, reach: Reach[] | null): () => void {
  const scopes: string[] = [];
  const path = () => scopes.join('>');
  const core = t.core;
  const inOut = () => (path() === 'top' ? 'top' : 'inside');
  G.__lkIn = (gr: any) => {
    scopes.push(gr.__lkScope ?? 'top');
    return () => void scopes.pop();
  };
  G.__lk = (_gr: any, kind: string, state: GameState, action: unknown) => fnv(rec, `${path()}|${kind}|${kind === 'act' ? core.actingSide(state) : ''}|${key(action)}`);
  const scoreList = (ranked: { action: unknown; score: number }[]) => JSON.stringify(ranked.map(r => [r.action, Object.is(r.score, -0) ? '-0' : String(r.score)]));
  G.__lkDecRank = (_s: GameState, ranked: any[]) => fnv(rec, `${path()}|drank|${scoreList(ranked)}`);
  G.__lkOffRank = (_s: GameState, ranked: any[]) => fnv(rec, `${path()}|offrank|${scoreList(ranked)}`);
  G.__lkRank = (_s: GameState, ranked: any[]) => fnv(rec, `${path()}|rank|${scoreList(ranked)}`);
  G.__lkAns = (where: string, _s: GameState, action: unknown) => fnv(rec, `${path()}>${where}|ans|${key(action)}`);
  G.__b3bReach = reach ? (what: string) => reach.push({ what, scope: inOut() }) : undefined;
  G.__b3bAns = reach ? (s: GameState, side: string) => side === 'runner' && hostPromptOf(t, s) && reach.push({ what: 'ans', scope: inOut() }) : undefined;
  return () => {
    G.__lkIn = G.__lk = G.__lkRank = G.__lkAns = G.__lkDecRank = G.__lkOffRank = G.__b3bReach = G.__b3bAns = undefined;
  };
}

function decisionOf(core: any, s: GameState): { side: 'corp' | 'runner'; kind: string } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const want = core.wantsStop(s, side, w);
    if (want && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, kind: 'rez' };
    if (want && side === 'runner' && w.step === 'corp_action') return { side, kind: 'off' };
    return null;
  }
  return { side, kind: core.activePrompt(s) ? 'prompt' : s.activeRun ? 'run' : 'main' };
}

type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}

/** Bar 4: the first difference's kind, from the decision and the branch tree's reaches at that step. */
function firstKind(t: Tree, s: GameState, dec: { side: string; kind: string } | null, picks: unknown[], at: Reach[]): string {
  const has = (what: string, scope?: string) => at.some(r => r.what === what && (!scope || r.scope === scope));
  const trojanInstall = (a: any) => a?.type === 'INSTALL_CARD' && a.hostInstanceId && isTrojan(t, s.runner.grip.find(c => c.instanceId === a.cardInstanceId)?.cardCode ?? '');
  if (dec?.side === 'runner') {
    if (dec.kind === 'prompt' && hostPromptOf(t, s)) return 'host';
    if (dec.kind === 'main' && picks.some(trojanInstall)) return 'install';
    if (at.length) return 'held';
    return 'other';
  }
  if (dec?.side === 'corp') {
    if (has('ans') || has('inst')) return 'reply';
    if (has('owner')) return 'corpLeaf';
    return 'other';
  }
  return 'other';
}

/** Bar 6: one tree's game from `g` to its end, counted. Reads only the public board (the trojans are the Runner's own cards). */
function playOut(t: Tree, g: any, prior: { hosts: Set<string> }) {
  const n = { clickInstalls: 0, promptInstalls: 0, second: 0, secondEmpty: 0, broke: 0, runs: {} as Record<string, number>, hostPrompts: 0 };
  const hosts = new Set(prior.hosts);
  const virus = (st: GameState) => new Map(st.runner.rig.programs.filter(c => c.hostedOnId && breaks(t, c.cardCode)).map(c => [c.instanceId, c.tokens?.virus ?? 0] as const));
  const install = (st: GameState, code: string, hostId: string, offered: string[] | null) => {
    const same = st.runner.rig.programs.filter(c => c.hostedOnId === hostId && c.cardCode === code).length;
    if (same > 0) {
      n.second++;
      if (offered && offered.some(id => id !== hostId && !st.runner.rig.programs.some(c => c.hostedOnId === id && isTrojan(t, c.cardCode)))) n.secondEmpty++;
    }
    hosts.add(hostId);
  };
  for (let i = 0; i < MAX_STEPS && !g.state.winner; i++) {
    const before: GameState = g.state;
    const hp = hostPromptOf(t, before);
    const vb = before.activeRun ? virus(before) : null;
    if (!g.step()) break;
    const after: GameState = g.state;
    const a: any = g.last;
    if (a?.type === 'INSTALL_CARD' && a.hostInstanceId) {
      const code = before.runner.grip.find(c => c.instanceId === a.cardInstanceId)?.cardCode ?? '';
      if (isTrojan(t, code)) {
        n.clickInstalls++;
        install(before, code, a.hostInstanceId, null);
      }
    }
    if (hp && a?.type === 'RESOLVE_PROMPT' && a.choice?.kind === 'effect_choice' && hp.options.includes(a.choice.optionId)) {
      n.hostPrompts++;
      n.promptInstalls++;
      install(before, hp.code, a.choice.optionId, hp.options);
    }
    if (vb) {
      const va = virus(after);
      for (const [id, v] of vb) if (va.has(id)) n.broke += Math.max(0, v - va.get(id)!);
    }
    if (!before.activeRun && after.activeRun) {
      const sv = after.activeRun.server;
      const k = sv === 'hq' || sv === 'rd' || sv === 'archives' ? sv : 'remote';
      n.runs[k] = (n.runs[k] ?? 0) + 1;
    }
  }
  return { ...n, hosts: hosts.size, winner: g.state.winner ?? null, turns: g.state.turnNumber };
}

const KINDS = ['main', 'prompt', 'host', 'run', 'off', 'rez'];
type Tm = Record<string, number>;
const zeroTm = (): Tm => Object.fromEntries(['corp', 'runner'].flatMap(sd => KINDS.map(k => [`${sd}.${k}`, 0])));
const ms: Record<Name, Tm> = { base: zeroTm(), branch: zeroTm(), control: zeroTm() };
function deal(pool: string, d: Deal) {
  const g = {} as Record<Name, any>;
  const tms = { base: zeroTm(), branch: zeroTm(), control: zeroTm() } as Record<Name, Tm>;
  for (const n of NAMES) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], d), { corp: T[n].createAgent('corp', 'normal'), runner: T[n].createAgent('runner', 'normal') });
  }
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let diff: Record<string, unknown> | null = null;
  let steps = 0;
  const before: Reach[] = [];
  // Bar 6 counts over the identical prefix too (equal on both trees), so each game is counted whole
  const prefix = { clickInstalls: 0, promptInstalls: 0, second: 0, secondEmpty: 0, broke: 0, runs: {} as Record<string, number>, hostPrompts: 0 };
  const prefixHosts = new Set<string>();
  const t = T.branch;
  const virus = (st: GameState) => new Map(st.runner.rig.programs.filter(c => c.hostedOnId && breaks(t, c.cardCode)).map(c => [c.instanceId, c.tokens?.virus ?? 0] as const));
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.base.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const dec = decisionOf(T.base.core, s);
    const hp = hostPromptOf(t, s);
    const res = {} as Record<Name, Acc>;
    const more = {} as Record<Name, boolean>;
    const at: Reach[] = [];
    const order = NAMES.map((_, k) => NAMES[(k + i) % NAMES.length]);
    const vb = s.activeRun ? virus(s) : null;
    for (const n of order) {
      res[n] = fresh();
      const stop = listen(T[n], res[n], n === 'branch' ? at : null);
      const t0 = performance.now();
      try {
        more[n] = g[n].step();
      } finally {
        stop();
      }
      if (dec) tms[n][`${dec.side}.${dec.kind === 'prompt' && hp ? 'host' : dec.kind}`] += performance.now() - t0;
    }
    steps++;
    const same = (a: Name, b: Name) => res[a].n === res[b].n && res[a].h === res[b].h && more[a] === more[b];
    if (!same('base', 'branch') || !same('base', 'control')) {
      const pick = (n: Name) => key(g[n].last).slice(0, 160);
      const tally: Record<string, number> = {};
      for (const r of at) tally[`${r.what}|${r.scope}`] = (tally[`${r.what}|${r.scope}`] ?? 0) + 1;
      diff = {
        step: i,
        T: s.turnNumber,
        side: dec?.side ?? null,
        kind: dec?.kind ?? null,
        first: firstKind(t, s, dec, [g.base.last, g.branch.last], at),
        branch: !same('base', 'branch'),
        control: !same('base', 'control'),
        reachAt: tally,
        reachBefore: before.length,
        picks: { base: pick('base'), branch: pick('branch') },
      };
      break;
    }
    // the identical step, counted once for both trees
    const a: any = g.base.last;
    const after: GameState = g.base.state;
    if (a?.type === 'INSTALL_CARD' && a.hostInstanceId) {
      const code = s.runner.grip.find(c => c.instanceId === a.cardInstanceId)?.cardCode ?? '';
      if (isTrojan(t, code)) {
        prefix.clickInstalls++;
        if (s.runner.rig.programs.some(c => c.hostedOnId === a.hostInstanceId && c.cardCode === code)) prefix.second++;
        prefixHosts.add(a.hostInstanceId);
      }
    }
    if (hp && a?.type === 'RESOLVE_PROMPT' && a.choice?.kind === 'effect_choice' && hp.options.includes(a.choice.optionId)) {
      prefix.hostPrompts++;
      prefix.promptInstalls++;
      if (s.runner.rig.programs.some(c => c.hostedOnId === a.choice.optionId && c.cardCode === hp.code)) {
        prefix.second++;
        if (hp.options.some(id => id !== a.choice.optionId && !s.runner.rig.programs.some(c => c.hostedOnId === id && isTrojan(t, c.cardCode)))) prefix.secondEmpty++;
      }
      prefixHosts.add(a.choice.optionId);
    }
    if (vb) {
      const va = virus(after);
      for (const [id, v] of vb) if (va.has(id)) prefix.broke += Math.max(0, v - va.get(id)!);
    }
    if (!s.activeRun && after.activeRun) {
      const sv = after.activeRun.server;
      const k = sv === 'hq' || sv === 'rd' || sv === 'archives' ? sv : 'remote';
      prefix.runs[k] = (prefix.runs[k] ?? 0) + 1;
    }
    before.push(...at);
    if (!more.base) break;
  }
  const B = g.base.state;
  const recordSame = !diff ? (B.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc) : null;
  for (const n of NAMES) for (const k of Object.keys(tms[n])) ms[n][k] += tms[n][k];
  const add = (x: ReturnType<typeof playOut>) => {
    const runs = { ...prefix.runs };
    for (const [k, v] of Object.entries(x.runs)) runs[k] = (runs[k] ?? 0) + v;
    return { ...x, clickInstalls: x.clickInstalls + prefix.clickInstalls, promptInstalls: x.promptInstalls + prefix.promptInstalls, second: x.second + prefix.second, secondEmpty: x.secondEmpty + prefix.secondEmpty, broke: x.broke + prefix.broke, hostPrompts: x.hostPrompts + prefix.hostPrompts, runs };
  };
  // After an identical deal both trees are at the game's end: the prefix is the whole game
  const play = (n: 'base' | 'branch') => {
    if (!diff) return add({ clickInstalls: 0, promptInstalls: 0, second: 0, secondEmpty: 0, broke: 0, runs: {}, hostPrompts: 0, hosts: prefixHosts.size, winner: g[n].state.winner ?? null, turns: g[n].state.turnNumber });
    if (!PLAYON) return null;
    const t0 = performance.now();
    const r = add(playOut(T[n], g[n], { hosts: prefixHosts }));
    return { ...r, ms: Math.round(performance.now() - t0) };
  };
  const games = { base: play('base'), branch: play('branch') };
  const r1 = (x: number) => Math.round(x);
  out({ kind: 'deal', pool, seed: d.seed, steps, diff, reachBefore: before.length, recordSame, games, ms: Object.fromEntries(NAMES.map(n => [n, Object.fromEntries(Object.entries(tms[n]).filter(([, v]) => v > 0).map(([k, v]) => [k, r1(v)]))])) });
}

async function main() {
  const dirs = makeTrees();
  T = {} as Record<Name, Tree>;
  for (const n of NAMES) T[n] = await loadTree(n, dirs[n]);
  const batch: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/b3/deals-${RECORDS[0]}.json`, 'utf8'));
  const nrdb: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/b3/deals-${RECORDS[1]}.json`, 'utf8'));
  const sources: { pool: string; d: Deal }[] = [];
  for (const pool of POOLS) (pool === 'batch' ? batch : nrdb).filter(d => !DEALS.length || DEALS.includes(String(d.seed))).slice(0, LIMIT).forEach(d => sources.push({ pool, d }));
  for (let i = shard; i < sources.length; i += shards) {
    try {
      deal(sources[i].pool, sources[i].d);
    } catch (e) {
      out({ kind: 'error', pool: sources[i].pool, seed: sources[i].d.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 'time', ms: Object.fromEntries(NAMES.map(n => [n, Object.fromEntries(Object.entries(ms[n]).map(([k, v]) => [k, Math.round(v)]))])) });
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main();
