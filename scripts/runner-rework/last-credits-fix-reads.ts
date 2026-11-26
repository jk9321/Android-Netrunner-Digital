/**
 * R-14h fix, bar 6 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/r14h-last-credits-fix.md, rev 4 item 5):
 * what the Corp side reads, per game, branch beside base, on the g3 batch's deals (corp-losses.ts's pairings of the
 * shipped decks, seeds 1000 + 10 (p - 1) + g + 1, g = 0..2). Each deal is played by a plain GameRunner on one tree per
 * leg (LEGS=base,branch: ARM_BASE's src, this checkout's src; no patch), with its record (winner, cr, sc: read against
 * the g3 batches' deals.json) and its counts:
 *   click draws (DRAW_CARD) by each side, split by that side's credits before the draw (0-2, 3-5, 6+);
 *   the Corp's operations played (by title, and those that drew: HQ larger after than before less the card), credits
 *   gained and spent (every change of the Corp's credits), cards played or installed from HQ by type, assets and
 *   upgrades rezzed;
 *   the Runner's installs of Verbal Plasticity, Knickknack O'Brian and Side Hustle, split by its credits before the
 *   install; its access_trash answers (trash or keep) split by its credits before the answer;
 *   the tripwire (rev 4 item 5): a Runner trash at an access that leaves it at 0 to 2 credits, then its next turn with
 *   no card played (no install, no event); a game that ends before that turn is counted apart.
 * The loss classes (stayed broke, stuck in HQ) are the batches' own alarms (deals.json).
 *
 *   ARGS="LEGS=base,branch ARM_BASE=<base full sha>"   (bar 6, 663 deals on each leg, 64 shards)
 *   ARGS="LEGS=branch DEALS=1001 ARM_BASE=<sha>" npx vite-node scripts/runner-rework/last-credits-fix-reads.ts   (one game)
 *
 * No hidden read: the script reads the game's public record (state changes and the actions taken).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { armSource } from '../tag-owner/trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const LEGS = (process.env.LEGS ?? 'base,branch').split(',').filter(Boolean);
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const GAMES = Number(process.env.GAMES ?? 3);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/last-credits-fix-reads', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
type Tally = Record<string, number>;
const inc = (t: Tally, k: string, n = 1) => void (t[k] = (t[k] ?? 0) + n);
const band = (c: number) => (c <= 2 ? '0-2' : c <= 5 ? '3-5' : '6+');
/** Verbal Plasticity, Knickknack O'Brian, Side Hustle (second pass I) */
const WATCHED: Record<string, string> = { '30034': 'Verbal Plasticity', '35033': 'Knickknack', '35034': 'Side Hustle' };

interface T {
  core: any;
  decks: any;
  createAgent: any;
  GameRunner: any;
  clear: () => void;
}
async function loadTree(dir: string): Promise<T> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const files = ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/threatModel.ts'];
  const mods: any[] = [];
  for (const p of files) mods.push(await m(p)); // one at a time (a circular graph)
  const [ai, po, core, decks, hv, fx, vm, iv, tm] = mods;
  return {
    core,
    decks,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    clear: () => {
      hv.clearHandCaches();
      fx.clearDamageThreats();
      tm.clearThreatCaches?.();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}

type Deal = { seed: number; game: number; corpDeck: string; runnerDeck: string };
function playDeal(t: T, leg: string, d: Deal) {
  const c = ALL_DECKS.find(x => x.side === 'corp' && x.name === d.corpDeck)!;
  const r = ALL_DECKS.find(x => x.side === 'runner' && x.name === d.runnerDeck)!;
  t.clear();
  const g = new t.GameRunner(t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r)), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
  const def = (code?: string) => (code ? t.core.getCardDefinition(code) : undefined);
  const title = (code?: string) => def(code)?.title ?? code ?? 'unknown';
  const codeOf = (s: GameState, id?: string) => (id ? t.core.findCardAnywhere(s, id)?.cardCode : undefined);
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  const draws: Tally = {};
  const corpOps: Tally = {};
  const corpDrawOps: Tally = {};
  const fromHq: Tally = {};
  const rezzed: Tally = {};
  const installs: Tally = {};
  const trashAnswers: Tally = {};
  let gained = 0;
  let spent = 0;
  const lowTrashes: number[] = []; // the turn of each Runner trash that left it at 0 to 2 credits
  const runnerPlayed = new Map<number, boolean>(); // per Runner turn: a card played (install or event)
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    if (s.activePlayer === 'runner' && !runnerPlayed.has(s.turnNumber)) runnerPlayed.set(s.turnNumber, false);
    const p: any = t.core.activePrompt(s);
    if (!g.step()) break;
    const n: GameState = g.state;
    const a: any = g.last;
    const dc = n.corp.credits - s.corp.credits;
    if (dc > 0) gained += dc;
    if (dc < 0) spent -= dc;
    if (!a) continue;
    const side: 'corp' | 'runner' | undefined = a.player;
    if (a.type === 'DRAW_CARD' && side) inc(draws, `${side} ${band(side === 'corp' ? s.corp.credits : s.runner.credits)}`);
    if (side === 'corp' && (a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'INSTALL_CARD') && s.corp.hq.some(x => x.instanceId === a.cardInstanceId)) {
      const code = codeOf(s, a.cardInstanceId);
      inc(fromHq, def(code)?.type_code ?? 'unknown');
      if (a.type === 'PLAY_OPERATION_OR_EVENT') {
        inc(corpOps, title(code));
        const drew = n.corp.hq.length - (s.corp.hq.length - 1);
        if (drew > 0) inc(corpDrawOps, title(code), drew);
      }
    }
    if (side === 'corp' && a.type === 'REZ_CARD') {
      const ty = def(codeOf(s, a.cardInstanceId))?.type_code;
      if (ty === 'asset' || ty === 'upgrade') inc(rezzed, ty);
    }
    if (side === 'runner' && (a.type === 'INSTALL_CARD' || a.type === 'PLAY_OPERATION_OR_EVENT')) {
      runnerPlayed.set(s.turnNumber, true);
      const code = codeOf(s, a.cardInstanceId);
      if (a.type === 'INSTALL_CARD' && code && WATCHED[code]) inc(installs, `${WATCHED[code]} ${band(s.runner.credits)}`);
    }
    if (side === 'runner' && a.type === 'RESOLVE_PROMPT' && a.choice?.kind === 'access_trash' && p?.kind === 'access_trash') {
      inc(trashAnswers, `${a.choice.trash ? 'trash' : 'keep'} ${band(s.runner.credits)}`);
      if (a.choice.trash && n.runner.credits <= 2) lowTrashes.push(s.turnNumber);
    }
  }
  const E: GameState = g.state;
  // the tripwire: each low trash against the Runner's next turn
  const turns = [...runnerPlayed.keys()].sort((x, y) => x - y);
  const trip = { trashes: lowTrashes.length, nextNoCard: 0, nextPlayed: 0, gameOver: 0 };
  for (const at of lowTrashes) {
    const next = turns.find(x => x > at);
    if (next === undefined) trip.gameOver++;
    else if (runnerPlayed.get(next)) trip.nextPlayed++;
    else trip.nextNoCard++;
  }
  out({ kind: 'game', leg, seed: d.seed, game: d.game, corpDeck: d.corpDeck, runnerDeck: d.runnerDeck, winner: E.winner ?? null, cr, sc, T: E.turnNumber, draws, corpOps, corpDrawOps, fromHq, rezzed, gained, spent, installs, trashAnswers, trip });
}

async function main() {
  const started = Date.now();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const armSrc = armSource(root, shard);
  if (armSrc === 'src' && LEGS.includes('base')) throw new Error('ARM_BASE (a full SHA) is required: the base leg is its src');
  const nLegs = LEGS.length;
  const leg = LEGS[shard % nLegs];
  const per = Math.max(1, Math.floor(shards / nLegs));
  const slot = Math.floor(shard / nLegs);
  if (shard >= per * nLegs) return out({ kind: 's', shard, idle: true });
  const dir = join(root, leg);
  mkdirSync(dir, { recursive: true });
  cpSync(leg === 'base' ? armSrc : 'src', join(dir, 'src'), { recursive: true });
  const t = await loadTree(dir);
  const deals: Deal[] = [];
  let pairing = 0;
  for (const c of ALL_DECKS.filter(x => x.side === 'corp'))
    for (const r of ALL_DECKS.filter(x => x.side === 'runner')) {
      pairing++;
      for (let game = 0; game < GAMES; game++) {
        const seed = 1000 + (pairing - 1) * Math.max(10, GAMES) + game + 1;
        if (!DEALS.length || DEALS.includes(String(seed))) deals.push({ seed, game, corpDeck: c.name, runnerDeck: r.name });
      }
    }
  for (const [k, d] of deals.entries()) {
    if (k % per !== slot) continue;
    try {
      playDeal(t, leg, d);
    } catch (e) {
      out({ kind: 'error', leg, seed: d.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 's', shard, leg, ms: Date.now() - started, rss: Math.round(process.memoryUsage().rss / 1e6) });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
