/**
 * F117 / R-93 step 0 (brief netrunner-ai/f117-deck-arrivals/design-brief.md rev 2, section "Step 0"; ruling-redteam.md).
 * Plays the step 0 games (the 221 batch deals and the 110 NRDB deals, as c2a's step 0 and core-lockstep.ts) in one or
 * more trees, each loaded as its own module graph from an absolute path (scripts/corp-owed lesson: resolve() the dirs).
 *
 * MODE=audit (item 14 and bar 9's audit leg): memoAudit (valueModel.ts, test-only) is on in every tree, and each deal
 * reports per tree the audited memo hits by entry name: checked, mismatches, hits served from another frame and from a
 * frame that knew the hands apart (otherKnown), and their mismatches. Trees (TREES=, default nokey,key):
 *   key    this checkout's src (F117 commit 1 or later)
 *   nokey  this checkout's src with the two iceProtects key strings put back as on beta 701f9ee (the audit kept):
 *          beta's own play with the audit added
 *
 *   ARGS="POOL=batch DEALS=1001 MAX_STEPS=200" npx vite-node scripts/f117/count.ts
 *   SHARD=0/64 npx vite-node scripts/f117/count.ts -- POOL=batch,nrdb MODE=audit
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { loadTree, type Tree } from '../runner-rework/facts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/f117-count', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const MODE = process.env.MODE ?? 'audit';
const TREES = (process.env.TREES ?? 'nokey,key').split(',');
const started = Date.now();
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));

type Patch = [file: string, at: string, to: string];
/** The two iceProtects key strings as on beta 701f9ee (F117 commit 1 adds `:${unseenKey(state)}` to each). */
const NOKEY: Patch[] = [
  ['ai/iceValues.ts', 'memo(state, `iceProtects:hand:${ice.cardCode}:${unseenKey(state)}`', 'memo(state, `iceProtects:hand:${ice.cardCode}`'],
  ['ai/iceValues.ts', "memo(state, `iceProtects:${server.id}:${extra?.cardCode ?? ''}:${unseenKey(state)}`", "memo(state, `iceProtects:${server.id}:${extra?.cardCode ?? ''}`"],
];
const TREE_PATCHES: Record<string, Patch[]> = { key: [], nokey: NOKEY };

function makeTree(name: string): string {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync('src', join(dir, 'src'), { recursive: true });
  const patches = TREE_PATCHES[name];
  if (!patches) throw new Error(`no tree ${name} (${Object.keys(TREE_PATCHES).join(', ')})`);
  for (const [f, at, to] of patches) {
    const path = join(dir, 'src', f);
    const text = readFileSync(path, 'utf8');
    if (text.split(at).length !== 2) throw new Error(`tree ${name}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
    writeFileSync(path, text.replace(at, () => to));
  }
  return dir;
}

type Deal = { seed: number; corpDeck: string; runnerDeck: string };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealState(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found (${d.corpDeck} v ${d.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}

type Loaded = Tree & { vm: any };

function auditDeal(pool: string, d: Deal, trees: Record<string, Loaded>) {
  for (const [name, t] of Object.entries(trees)) {
    t.clear();
    t.vm.resetMemoAudit();
    t.vm.memoAudit.on = true;
    const g = new t.GameRunner(dealState(t, d), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
    const t0 = performance.now();
    let steps = 0;
    let error: string | null = null;
    try {
      while (steps < MAX_STEPS && g.step()) steps++;
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    } finally {
      t.vm.memoAudit.on = false;
    }
    const a = t.vm.memoAudit;
    out({
      kind: 'deal',
      pool,
      seed: d.seed,
      tree: name,
      steps,
      T: g.state.turnNumber,
      winner: g.state.winner ?? null,
      ms: Math.round(performance.now() - t0),
      error,
      audit: { checked: a.checked, mismatches: a.mismatches, otherFrame: a.otherFrame, otherFrameMismatches: a.otherFrameMismatches, otherKnown: a.otherKnown, otherKnownMismatches: a.otherKnownMismatches },
      byName: Object.fromEntries(a.byName),
      errors: a.errors.slice(0, 20),
    });
  }
}

async function main() {
  const trees: Record<string, Loaded> = {};
  for (const name of TREES) {
    const dir = makeTree(name);
    const t = (await loadTree(name, dir)) as Loaded;
    t.vm = await import(/* @vite-ignore */ join(dir, 'src', 'ai/valueModel.ts'));
    trees[name] = t;
  }
  const recs = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Deal[];
  const pools: Record<string, string> = {
    batch: process.env.RECORDS_BATCH ?? 'scripts/f117/recs/deals-45940481387.json',
    nrdb: process.env.RECORDS_NRDB ?? 'scripts/runner-rework/facts-deals-45458221138.json',
  };
  const sources: { pool: string; d: Deal }[] = [];
  for (const pool of POOLS) {
    if (!pools[pool]) throw new Error(`unknown pool ${pool}`);
    for (const d of recs(pools[pool])) if (!DEALS.length || DEALS.includes(String(d.seed))) sources.push({ pool, d });
  }
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (MODE === 'audit') auditDeal(src.pool, src.d, trees);
      else throw new Error(`unknown MODE ${MODE}`);
    } catch (e) {
      out({ kind: 'error', pool: src.pool, seed: src.d.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 'done', shard, ms: Date.now() - started });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
