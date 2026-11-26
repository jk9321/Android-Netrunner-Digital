/**
 * Owed counts 5 and 6 (brief /mnt/project-files/netrunner-ai/owed-counts/brief.md items 5 and 6, F109 and F107) on beta
 * 9154f02's tree: reads on the boards of the source games, no arm. The source tree (this checkout's src) plays each deal
 * of both g1 pools; its Corp agent is only watched; the `base` tree (src with no patch) prices the reads, caches
 * cleared before each read.
 *
 * Item 5 (the rez window before the Runner approaches the server, rule 6.9.4e): at every Corp rez decision with the run
 *   at approach_server, not yet approached, each card in the attacked server's root whose rez changes what the access
 *   that follows costs the Runner (WINDOW below, from the card texts), unrezzed: whether its rez is legal and payable,
 *   and the Corp's answer. Then what the run did: success, the card accessed, the Runner's trash answer on it.
 * Item 6 (the worths the old floor hid): at the start of each Corp turn, every installed card of WORTH below: the entry's
 *   worth (corpCardValue, the Corp's view, and the Runner's `left` view the trash price reads) beside the game-state
 *   inputs (turnsLeft, hosted credits, advancement the Corp still needs, agendas in the root, Archives' size). And every
 *   access of one, with the Runner's answer.
 *
 *   SHARD=0/64 npx vite-node scripts/corp-owed/scan.ts -- POOL=batch,nrdb
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardInstance, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree, makeTree, rootOf } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const root = rootOf('scan', shard);
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

/**
 * Root cards whose rez in the window before the approach changes the access (card text; rules 1.8.3a, 9.1.8a: an access
 * condition is active unrezzed, so Urtica Cipher, Byte! and Behold! are not here). Public Access Plaza: its trash gives
 * a tag while rezzed (threat 2). Mahkota Langit Grid: each asset in the root costs 2 more to trash. AMAZE Amusements:
 * 2 tags after a run that stole. Adrian Seis: a Psi Game on success that can stop other accesses. Manegarm Skunkworks
 * and Anoetic Void: on the approach (6.9.4g, after this window) end the run unless paid / at a price. Tucana: an ice
 * searched and installed when an agenda is stolen from the root.
 */
const WINDOW: Record<string, string> = { '35062': 'Public Access Plaza', '35082': 'Mahkota Langit Grid', '30058': 'AMAZE Amusements', '34046': 'Adrian Seis', '30042': 'Manegarm Skunkworks', '30050': 'Anoetic Void', '34064': 'Tucana' };
/** F107's cards (adversarial/2026-11-25-runner-o1a/findings.md 1, 2a, 3) and the hosted-credit econ assets (the builder's note to 1). */
const WORTH: Record<string, string> = { '34120': 'The Holo Man', '35082': 'Mahkota Langit Grid', '30066': 'Malapert Data Vault', '30053': 'Spin Doctor', '30071': 'Regolith Mining License', '30037': 'Nico Campaign', '35072': 'Anthill Excavation Contract', '35040': 'Otto Campaign' };

let S: Tree;
let B: Tree;
function inCtx<X>(s: GameState, viewer: 'corp' | 'runner', f: (st: GameState) => X): X {
  B.clear();
  const st = structuredClone(s);
  return B.pricing.asSide(viewer, () => {
    B.hv.decisionContext(st, viewer);
    return f(st);
  });
}
const installed = (s: GameState): { card: CardInstance; server: string }[] => Object.entries(s.corp.servers).flatMap(([id, v]: [string, any]) => v.root.map((card: CardInstance) => ({ card, server: id })));
const adv = (code: string) => S.core.getCardDefinition(code).advancement_cost ?? 0;
const pts = (code: string) => S.core.getCardDefinition(code).agenda_points ?? 0;

function worthReads(pool: string, src: string, s: GameState, deck: { adv: number; pts: number }) {
  const left = inCtx(s, 'corp', st => B.cp.turnsLeft(st) as number);
  for (const { card, server } of installed(s)) {
    if (!WORTH[card.cardCode]) continue;
    const id = card.instanceId;
    const find = (st: GameState) => S.core.findCardAnywhere(st, id);
    const corp = inCtx(s, 'corp', st => B.ev.corpCardValue(find(st), st, 'corp', false) as number);
    const runnerLeft = inCtx(s, 'runner', st => B.ev.corpCardValue(find(st), st, 'runner', true) as number);
    const rootCards = s.corp.servers[server].root;
    out({
      kind: 'w',
      pool,
      src,
      T: s.turnNumber,
      card: WORTH[card.cardCode],
      server,
      rezzed: card.isRezzed,
      worth: { corp: r3(corp), runnerLeft: r3(runnerLeft) },
      inputs: {
        turnsLeft: left,
        hosted: S.ce.counters(card, 'credit') as number,
        corpScore: s.corp.score,
        runnerScore: s.runner.score,
        corpCredits: s.corp.credits,
        advNeed: r3(((7 - s.corp.score) * deck.adv) / Math.max(1, deck.pts)),
        agendaInRoot: rootCards.some(c => S.core.getCardDefinition(c.cardCode).type_code === 'agenda'),
        advanceableInRoot: rootCards.filter(c => c.instanceId !== id).length,
        assetsInRoot: rootCards.filter(c => S.core.getCardDefinition(c.cardCode).type_code === 'asset').length,
        archives: s.corp.archives.faceUp.length + s.corp.archives.faceDown.length,
        iced: s.corp.servers[server].ice.length,
      },
      trash: S.ce.trashCost?.(s, card) ?? null,
    });
  }
}

type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
const key = (a: unknown) => JSON.stringify(a ?? null);
function deal(pool: string, d: Deal) {
  const t0 = performance.now();
  S.clear();
  const src = `${pool}:${d.seed}`;
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck)!;
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck)!;
  const titles = Object.entries((c as any).cards) as [string, number][];
  const agendas = titles.map(([t, n]) => [S.core.ALL_CARDS?.find?.((x: any) => x.title === t), n] as [any, number]).filter(([x]) => x?.type_code === 'agenda');
  const deck = { adv: agendas.reduce((a, [x, n]) => a + adv(x.code) * n, 0), pts: agendas.reduce((a, [x, n]) => a + pts(x.code) * n, 0) };
  // Item 5: open windows of this run, the cards' ids, to follow the run on
  let open: { T: number; server: string; rows: any[] } | null = null;
  const flush = (s: GameState, why: string) => {
    if (open) out({ kind: 'r', pool, src, T: open.T, server: open.server, corpDeck: d.corpDeck, rows: open.rows, end: why, success: !!s.activeRun?.isSuccessful });
    open = null;
  };
  const corp = S.ai.createAgent('corp', 'normal');
  const watched = new Proxy(corp, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (prop !== 'chooseRez') return v;
      return (s: GameState, cards: CardInstance[]) => {
        const a = v.apply(target, [s, cards]);
        const run = s.activeRun;
        if (run && run.phase === 'approach_server' && !run.serverApproached) {
          const rows = s.corp.servers[run.server].root
            .filter(x => WINDOW[x.cardCode] && !x.isRezzed)
            .map(x => {
              const legal = S.core.isLegalAction?.(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: x.instanceId }) ?? null;
              return { id: x.instanceId, card: WINDOW[x.cardCode], legal, offered: cards.some(k => k.instanceId === x.instanceId), cost: S.core.rezCostOf?.(s, x) ?? null, credits: s.corp.credits, rezzed: !!a && (a as any).cardInstanceId === x.instanceId, answer: a ? (a as any).type : null, agendaInRoot: s.corp.servers[run.server].root.some(k => S.core.getCardDefinition(k.cardCode).type_code === 'agenda'), assetsInRoot: s.corp.servers[run.server].root.filter(k => S.core.getCardDefinition(k.cardCode).type_code === 'asset').length, runnerCredits: s.runner.credits, tags: s.runner.tags, corpScore: s.corp.score, runnerScore: s.runner.score };
            });
          if (rows.length) {
            flush(s, 'next window');
            open = { T: s.turnNumber, server: run.server, rows };
          }
        }
        return a;
      };
    },
  });
  const run = new S.po.GameRunner(S.core.createInitialGameState(S.decks.deckGameSetup(d.seed, c, r)), { corp: watched, runner: S.ai.createAgent('runner', 'normal') });
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  for (let n = 0; n < 6000; n++) {
    const s: GameState = run.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
      worthReads(pool, src, s, deck);
    }
    const p: any = s.pendingPrompts.length ? S.core.activePrompt(s) : null;
    if (!run.step()) break;
    const a: any = run.last;
    // Accesses with a trash answer: item 5's followed card, item 6's cards
    if (p?.kind === 'access_trash' && a?.type === 'RESOLVE_PROMPT') {
      const card = S.core.findCardAnywhere(s, p.cardInstanceId);
      const answer = a.choice?.trash === true ? 'trash' : a.choice?.trash === false ? 'keep' : 'other';
      if (open) for (const row of (open as any).rows) if (row.id === p.cardInstanceId) row.access = { answer, trashCost: p.trashCost, rezzedNow: !!card?.isRezzed, runnerCredits: s.runner.credits, tagsAfter: run.state.runner.tags - s.runner.tags };
      if (card && WORTH[card.cardCode]) out({ kind: 'a', pool, src, T: s.turnNumber, card: WORTH[card.cardCode], rezzed: card.isRezzed, answer, trashCost: p.trashCost, runnerCredits: s.runner.credits });
    }
    if (open && !run.state.activeRun) flush(s, 'run over');
  }
  const matches = (run.state.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc);
  out({ kind: 'g', pool, src, matches, ms: Math.round(performance.now() - t0) });
}

const RUNS: Record<string, string> = { batch: '45830886377', nrdb: '45834898534' };
async function main() {
  S = await loadTree('source', makeTree(join(root, 'source'), {}));
  B = await loadTree('base', makeTree(join(root, 'base'), {}));
  const started = Date.now();
  const sources: { pool: string; d: Deal }[] = [];
  for (const pool of POOLS) for (const d of JSON.parse(readFileSync(`scripts/corp-owed/deals-${RUNS[pool]}.json`, 'utf8')) as Deal[]) if (!DEALS.length || DEALS.includes(String(d.seed))) sources.push({ pool, d });
  for (let i = shard; i < sources.length; i += shards) {
    if (Date.now() - started > MAX_MS) break;
    try {
      deal(sources[i].pool, sources[i].d);
    } catch (e) {
      out({ kind: 'err', pool: sources[i].pool, seed: sources[i].d.seed, error: (e as Error).stack?.slice(0, 500) });
    }
  }
  out({ kind: 's', shard, ms: Date.now() - started });
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
