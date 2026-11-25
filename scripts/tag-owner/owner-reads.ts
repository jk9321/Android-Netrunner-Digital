/**
 * F108 build (brief netrunner-ai/tag-owner/brief-build.md rev 1), bar 6: what the Corp side reads, per game, branch beside
 * base, from the g3 batch's deals (corp-losses.ts's pairings of the shipped decks, seeds 1000 + 10 (p - 1) + g + 1,
 * g = 0..2). Each deal is played by a plain GameRunner on one tree per leg (LEGS=base,branch: the merge base's src from
 * ARM_BASE, this checkout's src; no patch), with its record (winner, cr, sc: read against the g3 batches' deals.json) and
 * its counts:
 *   tags the Runner took, by source: ice (an encounter in progress), access (a breach in progress), a Corp card (the
 *   Corp acting), the Runner's own card, a trash (the Runner's access_trash answer); each with the card's title;
 *   tags cleared, by whom (the Runner's basic action, a Runner card, a Corp card by title: Synapse Global, IP Enforcement,
 *   Unleash, Bigger Picture are the Corp's own removals); tags held at the end;
 *   resources trashed by the Corp's basic action (rule 5.2.6g; 10.5.3), by title, and the chances not taken (a Corp main
 *   decision where TRASH_RESOURCE was legal and the Corp did something else);
 *   Corp operations played while the Runner was tagged, by title (the punishers among them); Bigger Picture's take by
 *   mode (its effect_choice answer, the Runner's credits, tags and resources lost over the play);
 *   B-1001s installed and rezzed; Runner runs, and runs in which ice gave a tag.
 * The two loss classes (stayed broke, stuck in HQ) are the batches' own alarms (deals.json).
 *
 *   ARGS="LEGS=base,branch ARM_BASE=<merge base full sha>"   (bar 6, 663 deals on each leg, 64 shards)
 *   ARGS="LEGS=branch DEALS=1001 ARM_BASE=<sha>" npx vite-node scripts/tag-owner/owner-reads.ts   (one game, local)
 *
 * No hidden read: the script reads the game's public record (state changes, the actions taken, the log's card codes).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { armSource } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const LEGS = (process.env.LEGS ?? 'base,branch').split(',').filter(Boolean);
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const GAMES = Number(process.env.GAMES ?? 3);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/tag-owner-reads', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
type Tally = Record<string, number>;
const inc = (t: Tally, k: string, n = 1) => void (t[k] = (t[k] ?? 0) + n);
const B1001 = '34065';

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
  const title = (code?: string) => (code ? (t.core.getCardDefinition(code)?.title ?? code) : 'unknown');
  const codeOf = (s: GameState, id?: string) => (id ? t.core.findCardAnywhere(s, id)?.cardCode : undefined);
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  const took: Tally = {};
  const tookBy: Tally = {};
  const cleared: Tally = {};
  const tagTrash: Tally = {};
  let chances = 0;
  let chancesTaken = 0;
  const opsTagged: Tally = {};
  const bp: any[] = [];
  let bpOpen: any = null;
  let b1001Installed = 0;
  let b1001Rezzed = 0;
  let runs = 0;
  let runsIceTag = 0;
  let runTagged = false;
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const p: any = t.core.activePrompt(s);
    const corpMain = !p && !s.activeRun && s.activePlayer === 'corp' && t.core.actingSide(s) === 'corp' && s.runner.tags > 0 && s.runner.rig.resources.length > 0;
    const canTrash = corpMain && t.core.getLegalActions(structuredClone(s), 'corp').some((a: any) => a.type === 'TRASH_RESOURCE');
    const logLen = s.log.length;
    if (!g.step()) break;
    const n: GameState = g.state;
    const a: any = g.last;
    if (canTrash && a?.player === 'corp') {
      chances++;
      if (a.type === 'TRASH_RESOURCE') chancesTaken++;
    }
    if (a?.player === 'corp' && a.type === 'TRASH_RESOURCE') inc(tagTrash, title(codeOf(s, a.cardInstanceId)));
    if (a?.type === 'PLAY_OPERATION_OR_EVENT' && a.player === 'corp' && s.runner.tags > 0) inc(opsTagged, title(codeOf(s, a.cardInstanceId)));
    if (a?.type === 'INSTALL_CARD' && codeOf(s, a.cardInstanceId) === B1001) b1001Installed++;
    if (a?.type === 'REZ_CARD' && codeOf(s, a.cardInstanceId) === B1001) b1001Rezzed++;
    // The card the step's log names last (the source of what happened in it)
    const fresh = n.log.slice(logLen);
    const named = [...fresh].reverse().find((e: any) => e.cardCode)?.cardCode as string | undefined;
    const dTags = n.runner.tags - s.runner.tags;
    if (dTags > 0) {
      const enc = s.activeRun?.encounter;
      const src = enc
        ? `ice ${title(codeOf(s, enc.iceId))}`
        : a?.type === 'RESOLVE_PROMPT' && a.player === 'runner' && a.choice?.kind === 'access_trash'
          ? `trash ${title(named)}`
          : s.activeRun && (s.activeRun.phase as string).includes('access')
            ? `access ${title(named)}`
            : a?.player === 'corp' || s.activePlayer === 'corp'
              ? `corp ${title(named ?? codeOf(s, a?.cardInstanceId))}`
              : `runner ${title(named ?? codeOf(s, a?.cardInstanceId))}`;
      inc(took, src.split(' ')[0], dTags);
      inc(tookBy, src, dTags);
      if (enc && s.activeRun) runTagged = true;
    }
    if (dTags < 0) {
      const who = a?.type === 'REMOVE_TAG' ? 'runner basic action' : a?.player === 'corp' || s.activePlayer === 'corp' ? `corp ${title(named ?? codeOf(s, a?.cardInstanceId))}` : `runner ${title(named ?? codeOf(s, a?.cardInstanceId))}`;
      inc(cleared, who, -dTags);
    }
    // Runs: count each initiation; a run in which ice gave a tag counts once
    if (n.activeRun && !s.activeRun) {
      runs++;
      runTagged = false;
    }
    if (s.activeRun && !n.activeRun && runTagged) {
      runsIceTag++;
      runTagged = false;
    }
    // Bigger Picture (35065): its mode and what the Runner lost over the play
    if (a?.type === 'PLAY_OPERATION_OR_EVENT' && codeOf(s, a.cardInstanceId) === '35065') bpOpen = { mode: null, credits: s.runner.credits, tags: s.runner.tags, resources: s.runner.rig.resources.length };
    if (bpOpen && a?.player === 'corp' && a.type === 'RESOLVE_PROMPT' && a.choice?.kind === 'effect_choice' && bpOpen.mode === null) bpOpen.mode = a.choice.optionId;
    if (bpOpen && n.pendingPrompts.length === 0) {
      bp.push({ mode: bpOpen.mode, credits: bpOpen.credits - n.runner.credits, tags: bpOpen.tags - n.runner.tags, resources: bpOpen.resources - n.runner.rig.resources.length });
      bpOpen = null;
    }
  }
  const E: GameState = g.state;
  out({ kind: 'game', leg, seed: d.seed, game: d.game, corpDeck: d.corpDeck, runnerDeck: d.runnerDeck, winner: E.winner ?? null, cr, sc, T: E.turnNumber, took, tookBy, cleared, heldAtEnd: E.runner.tags, tagTrash, chances, chancesTaken, opsTagged, bp, b1001Installed, b1001Rezzed, runs, runsIceTag });
}

async function main() {
  const started = Date.now();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const armSrc = armSource(root, shard);
  if (armSrc === 'src') throw new Error('ARM_BASE (the merge base, a full SHA) is required: the base leg is its src');
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
