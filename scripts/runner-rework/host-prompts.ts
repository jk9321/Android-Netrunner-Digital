/**
 * R-27 Part 4 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/i67-i68-pins-count.md): issue #68's count.
 * Measurement only: no src change, nothing fixed, nothing decided.
 *
 * Unit: one EFFECT HOST PROMPT = a Runner `effect_choice` prompt built by installRunnerChoice (src/core/scripts/effects.ts:264):
 * its source data names the card (`cardId`, `discount`) and every option is an installed ice.
 * Per prompt ('hp' line): the card installed and the effect that asked (row 1); each answer's score as the Normal Runner's
 * try-each fallback scores it (the eval tree's HOSTLOG hook; row 2: two or more answers equal at the top to 1e-9); whether the
 * pick puts the card on a host that already hosts the same card while another legal host hosts none (row 3); whether the
 * pick is a facedown host, and whether it differs from the host the install action's owner ranks first (row 4: runnerAI.ts
 * scoreMain's host term, trojanHostValue for a rezzed host and the flat -3 for a facedown one, runnerAI.ts:366-368; no term
 * for a card that is not a trojan); and the step before (row 5): when the effect's card choice picked the card, the install
 * action's own score for that card on its best host at that board.
 *
 * Row 5's board (stated, as built): the board of the card-choice prompt, on a structuredClone, with the pending prompts
 * cleared, at least 1 click, and the card moved to the grip if it was elsewhere (Scrounge, Pantograph); the install
 * action is then scored by a fresh eval-tree Normal Runner (rankMainActions) with the source Runner's memory. The effect's
 * discount is not given (the action path pays the full cost); a card the action path cannot pay is reported as such.
 *
 * Sources (pool, kept apart everywhere; never added together):
 *  batch   the 221 deals of g1 45444888753 (facts-deals-45444888753.json; winner, cr, sc checked: 'g' lines);
 *  nrdb    the 110 deals of NRDB=1 g1 45458221138 (facts-deals-45458221138.json; same check);
 *  human   tests/fixtures/human-games, replayed move by move; `sk` humanRunner (a person ran) or humanCorp;
 *  issues  the saved issue games (tests/fixtures/runner-issues/ #64 #66 #67 #68, tests/fixtures/runner-facts/issues/ #58 #59).
 * The source games are played by the `source` tree (host-prompts-trees.ts: an unchanged copy; a plain GameRunner, never
 * asked or cleared mid-game); every question is asked of the `eval` tree on a structuredClone of the board.
 *
 * HIDDEN-READ (the measuring script only; no agent reads them): the source Runner's memory is read (never asked) and copied
 * into the eval Runner, as the source Runner holds it. Nothing else hidden is read: host ice is told apart by its id, its
 * rez state and what it hosts, all public.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/host-prompts.ts
 *   ARGS="POOL=batch LIMIT=5" npx vite-node scripts/runner-rework/host-prompts.ts   (LIMIT: source games in this shard)
 *   node scripts/runner-rework/host-prompts-sum.mjs <files>
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from './facts-trees';
import { makeHostTrees } from './host-prompts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb,human,issues').split(',');
const LIMIT = Number(process.env.LIMIT ?? 0);
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/host-prompts', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r4 = (x: number | null | undefined) => (x === null || x === undefined ? null : Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x > 0 ? 'Inf' : '-Inf');
const key = (a: unknown) => JSON.stringify(a ?? null);
const EPS = 1e-9;

let T: Tree; // eval tree
let P: any; // eval tree: ai/prompts.ts (HOSTLOG)
let RA: any; // eval tree: ai/runnerAI.ts (trojanHostValue)

const def = (code: string) => T.core.getCardDefinition(code);
const allIce = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.ice);

/** The active prompt if it is an effect host prompt (the unit). */
function hostPrompt(s: GameState): any | null {
  const p: any = T.core.activePrompt(s);
  if (!p || p.side !== 'runner' || p.kind !== 'effect_choice') return null;
  const d = p.source?.data;
  if (!d || typeof d.cardId !== 'string' || !('discount' in d)) return null;
  const ice = new Set(allIce(s).map(c => c.instanceId));
  if (!p.options.length || !p.options.every((o: any) => ice.has(o.id))) return null;
  return p;
}

/** The owner's host term for `code` on `host` (runnerAI.ts:366-368), or null when the action path has none (not a trojan). */
function ownerTerm(s: GameState, code: string, host: any): number | null {
  if (!T.cards[code]?.runFacts?.trojan) return null;
  return host.isRezzed ? RA.trojanHostValue(s, code, host) : -3;
}

/** Row 5: the install action's own score for `cardId` on its best host, at the card-choice board (built as the header says). */
function actionScore(b: GameState, cardId: string, memory: Map<string, string>): Record<string, unknown> {
  if (b.activeRun) return { why: 'during a run' };
  const board: GameState = structuredClone(b);
  board.pendingPrompts = [];
  board.runner.clicks = Math.max(1, board.runner.clicks);
  let moved: string | null = null;
  if (!board.runner.grip.some(c => c.instanceId === cardId)) {
    for (const zone of ['heap', 'stack'] as const) {
      const i = board.runner[zone].findIndex(c => c.instanceId === cardId);
      if (i >= 0) {
        board.runner.grip.push(...board.runner[zone].splice(i, 1));
        moved = zone;
      }
    }
  }
  const agent: any = T.createAgent('runner', 'normal');
  agent.memory = new Map(memory);
  let ranked: { action: GameAction; score: number }[];
  try {
    ranked = T.synergy.asSide('runner', () => agent.rankMainActions(board));
  } catch (e) {
    return { why: `rank threw: ${(e as Error).message.slice(0, 80)}`, moved };
  }
  const installs = ranked.filter(r => r.action.type === 'INSTALL_CARD' && (r.action as any).cardInstanceId === cardId);
  if (!installs.length) return { why: 'not a legal click action', moved, credits: board.runner.credits };
  const best = installs[0];
  const host = allIce(board).find(c => c.instanceId === (best.action as any).hostInstanceId);
  const top = ranked[0];
  return {
    moved,
    score: r4(best.score),
    rank: ranked.indexOf(best) + 1,
    of: ranked.length,
    hostRezzed: host ? host.isRezzed : null,
    top: top ? { type: top.action.type, score: r4(top.score) } : null,
    endTurn: r4(ranked.find(r => r.action.type === 'END_TURN')?.score ?? null),
  };
}

class Watch {
  /** The last board of each source card's card-choice prompt, by the source instance: its state, answer and memory. */
  private choice = new Map<string, { s: GameState; move: GameAction | null; memory: Map<string, string> }>();
  constructor(
    readonly src: string,
    readonly pool: string,
    readonly sk: string
  ) {}

  see(s: GameState, move: GameAction | null, memory: Map<string, string>) {
    const p: any = T.core.activePrompt(s);
    if (p && p.side === 'runner' && p.kind === 'effect_cards' && p.source?.instanceId) this.choice.set(p.source.instanceId, { s, move, memory });
    const hp = hostPrompt(s);
    if (!hp) return;
    const cardId: string = hp.source.data.cardId;
    const card = T.core.findCardAnywhere(s, cardId);
    const code: string = card?.cardCode ?? '?';
    // Each answer's score, as the Normal Runner's try-each fallback scores it, on the board it answers on
    const scores = new Map<string, number>();
    let answer: any = null;
    let err: string | null = null;
    P.HOSTLOG.on = (promptId: string, action: any, score: number) => {
      if (promptId !== hp.id || action?.choice?.kind !== 'effect_choice') return;
      if (scores.has(action.choice.optionId) && action.choice.optionId === hp.options[0].id) scores.clear(); // a second pass (view, then real): keep the last
      scores.set(action.choice.optionId, score);
    };
    try {
      const agent: any = T.createAgent('runner', 'normal');
      agent.memory = new Map(memory);
      answer = agent.chooseAction(structuredClone(s));
    } catch (e) {
      err = (e as Error).message.slice(0, 100);
    } finally {
      P.HOSTLOG.on = undefined;
    }
    const played = move && move.type === 'RESOLVE_PROMPT' && (move as any).choice?.kind === 'effect_choice' ? (move as any).choice.optionId : null;
    const evalPick = answer?.type === 'RESOLVE_PROMPT' ? answer.choice?.optionId ?? null : null;
    const ice = allIce(s);
    const options = hp.options.map((o: any) => {
      const host = ice.find(c => c.instanceId === o.id)!;
      const same = s.runner.rig.programs.filter(c => c.hostedOnId === o.id && c.cardCode === code).length;
      return { id: o.id, rezzed: !!host.isRezzed, same, score: scores.has(o.id) ? r4(scores.get(o.id)!) : null, owner: r4(ownerTerm(s, code, host)) };
    });
    const vals = options.map((o: any) => (typeof o.score === 'number' ? o.score : -Infinity));
    const raw = hp.options.map((o: any) => scores.get(o.id) ?? -Infinity);
    const topRaw = Math.max(...raw);
    const tiedTop = raw.filter((v: number) => Number.isFinite(v) && Math.abs(v - topRaw) <= EPS).length;
    const pick = played ?? evalPick;
    const picked = options.find((o: any) => o.id === pick);
    const ownerVals = options.map((o: any) => o.owner);
    const ownerHas = ownerVals.every((v: any) => typeof v === 'number');
    const ownerTop = ownerHas ? Math.max(...ownerVals) : null;
    const ownerFirst = ownerHas ? options.filter((o: any) => Math.abs(o.owner - ownerTop!) <= EPS).map((o: any) => o.id) : [];
    // Row 5: the effect's card choice one step before (the same source card's effect_cards prompt that chose this card)
    let step: Record<string, unknown> | null = null;
    const before = this.choice.get(hp.source.instanceId);
    if (before && before.move?.type === 'RESOLVE_PROMPT' && (before.move as any).choice?.kind === 'effect_cards' && (before.move as any).choice.cardInstanceIds?.includes(cardId))
      step = actionScore(before.s, cardId, before.memory);
    out({
      kind: 'hp',
      src: this.src,
      pool: this.pool,
      sk: this.sk,
      T: s.turnNumber,
      card: def(code)?.title ?? code,
      code,
      effect: def(hp.source.cardCode)?.title ?? hp.source.cardCode,
      step: hp.source.step,
      n: options.length,
      options,
      tiedTop,
      scored: vals.filter(Number.isFinite).length,
      played,
      evalPick,
      agree: played === null ? null : played === evalPick,
      err,
      second: !!picked && picked.same > 0 && options.some((o: any) => o.id !== picked.id && o.same === 0),
      facedown: picked ? !picked.rezzed : null,
      ownerFirst: ownerHas ? ownerFirst : null,
      differsFromOwner: ownerHas && picked ? !ownerFirst.includes(picked.id) : null,
      before: step,
    });
  }
}

type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(src: Tree, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return src.core.createInitialGameState(src.decks.deckGameSetup(rec.seed, c, r));
}

async function main() {
  const dirs = makeHostTrees(root);
  const source = await loadTree('source', dirs.source);
  T = await loadTree('eval', dirs.eval);
  P = await import(/* @vite-ignore */ join(dirs.eval, 'src', 'ai/prompts.ts'));
  RA = await import(/* @vite-ignore */ join(dirs.eval, 'src', 'ai/runnerAI.ts'));
  if (!P.HOSTLOG) throw new Error('eval tree: HOSTLOG missing');
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch' || pool === 'nrdb') {
      const run = pool === 'batch' ? '45444888753' : '45458221138';
      const recs: Rec[] = JSON.parse(readFileSync(`scripts/runner-rework/facts-deals-${run}.json`, 'utf8'));
      for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, id: r });
    } else {
      const dirsIn = pool === 'human' ? ['tests/fixtures/human-games'] : ['tests/fixtures/runner-issues', 'tests/fixtures/runner-facts/issues'];
      for (const dir of dirsIn)
        for (const f of readdirSync(dir)
          .filter(x => x.endsWith('.json'))
          .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b)))
          sources.push({ pool, id: join(dir, f) });
    }
  }
  let done = 0;
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (LIMIT && done >= LIMIT) break;
    done++;
    const t0 = performance.now();
    T.clear();
    if (src.pool === 'batch' || src.pool === 'nrdb') {
      const rec = src.id as Rec;
      const name = `${src.pool}:${rec.seed}`;
      source.clear();
      const ag = { corp: source.createAgent('corp', 'normal'), runner: source.createAgent('runner', 'normal') };
      const g = new source.GameRunner(dealStateOf(source, rec), ag);
      const w = new Watch(name, src.pool, 'self');
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      for (let n = 0; n < 4000; n++) {
        const s: GameState = g.state;
        if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
          cr.push(s.corp.credits);
          sc.push(s.corp.score);
          lastTurn = s.turnNumber;
        }
        if (!g.step()) break;
        // HIDDEN-READ: the source Runner's memory, read (never asked); the eval Runner gets a copy
        const memory = new Map((ag.runner as any).memory ?? []) as Map<string, string>;
        w.see(s, g.last ?? null, memory);
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ kind: 'g', src: name, pool: src.pool, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, matchesBatch: matches, ...(matches ? {} : { winner: g.state.winner, recWinner: rec.winner }), ms: Math.round(performance.now() - t0) });
    } else {
      const file = src.id as string;
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const sk = src.pool === 'issues' ? 'issue' : r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const name = `${src.pool}:${file.split('/').pop()}`;
      if (!r.moves?.length) continue;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = T.core.createInitialGameState(T.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      // The Runner's memory as the Normal Runner would have kept it, watching every board (observe reads only)
      const watcher: any = T.createAgent('runner', 'normal');
      const w = new Watch(name, src.pool, sk);
      let stopped: string | null = null;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        try {
          watcher.observe?.(s);
        } catch {
          /* observe reads only */
        }
        const memory = new Map(watcher.memory ?? []) as Map<string, string>;
        w.see(s, move, memory);
        try {
          s = T.core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      out({ kind: 'h', src: name, pool: src.pool, sk, moves: r.moves.length, stopped, ms: Math.round(performance.now() - t0) });
    }
  }
  out({ kind: 's', shard, sources: done });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
