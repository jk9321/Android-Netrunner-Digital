/**
 * Part C table (spec jeff-games-48-50, measurement only): every Corp ice install on a remote made while HQ holds agenda
 * points and HQ does not hold by the count (holdCost on HQ's ice with what the Corp ends the turn on is null: the
 * Runner's budget beats every rez set), by layer (scoreInTwo's install+ice line, iceRedirect, or the planner/ranking
 * pick); then the points stolen from HQ within the next 2 Runner turns against the points scored from that remote within
 * the next 2 Corp turns (and ever). The same for R&D with agenda points unseen there (agenda density from the deck
 * list, rezModel agendasUnseen). Self-play deals (SEEDS) or a report's moves replayed (FIX; layer then 'scoreInTwo' or
 * 'other', since the replay has no agent).
 *   SEEDS=1001,1041 [SHARD=0/4] npx vite-node scripts/remote-ice-table.ts      FIX=report-49.json npx vite-node ...
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, activePrompt, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { asSide } from '../src/ai/pricing';
import { holdCost, iceRedirectStats, isCorpMain, scoreInTwo } from '../src/ai/countedScore';
import { agendasUnseen } from '../src/ai/rezModel';

const type = (c: { cardCode: string }) => cardDef(c as never).type_code;
const pts = (c: { cardCode: string }) => cardDef(c as never).agenda_points ?? 0;
type Event = { turn: number; layer: string; centre: 'hq' | 'rd'; remote: string; hqPts: number; rdDensity: number; stolenHQ2: number; stolenRD2: number; scoredRemote2: number; scoredRemoteEver: number; runnerTurnsSeen: number; corpTurnsSeen: number; stolenIds: Set<string> };

function play(next: () => GameState | null, start: GameState, label: Record<string, unknown>, layerOf: (s: GameState, a: GameAction | null) => string) {
  const events: Event[] = [];
  const remoteOf = new Map<string, string>(); // agenda instance -> the remote it sits in
  let s = start;
  let lastActive = s.activePlayer;
  for (let k = 0; k < 8000; k++) {
    const before = s;
    const hqAgendas = new Set(before.corp.hq.filter(x => type(x) === 'agenda').map(x => x.instanceId));
    const rdIds = new Set(before.corp.rd.map(x => x.instanceId));
    const after = next();
    if (!after) break;
    s = after;
    // New ice on a remote, installed by the Corp
    if (before.activePlayer === 'corp') {
      for (const v of Object.values(s.corp.servers)) {
        if (!v.isRemote) continue;
        const old = before.corp.servers[v.id]?.ice ?? [];
        const added = v.ice.find(c => !old.some(o => o.instanceId === c.instanceId));
        if (!added) continue;
        const end = before.corp.credits + Math.max(0, before.corp.clicks - 1);
        const hqPts = before.corp.hq.filter(x => type(x) === 'agenda').reduce((n, x) => n + pts(x), 0);
        const hqShort = hqPts > 0 && asSide('corp', () => holdCost(before, before.corp.servers.hq.ice, end)) === null;
        const unseen = asSide('corp', () => agendasUnseen(before));
        const rdShort = unseen > 0 && asSide('corp', () => holdCost(before, before.corp.servers.rd.ice, end)) === null;
        const layer = layerOf(before, null);
        for (const centre of [hqShort ? 'hq' : null, rdShort ? 'rd' : null] as const) {
          if (!centre) continue;
          events.push({ turn: before.turnNumber, layer, centre, remote: v.id, hqPts, rdDensity: before.corp.rd.length ? unseen / before.corp.rd.length : 0, stolenHQ2: 0, stolenRD2: 0, scoredRemote2: 0, scoredRemoteEver: 0, runnerTurnsSeen: 0, corpTurnsSeen: 0, stolenIds: new Set() });
        }
      }
    }
    for (const v of Object.values(s.corp.servers)) for (const c of v.root) if (type(c) === 'agenda') remoteOf.set(c.instanceId, v.id);
    // Steals and scores this step
    const stolen = s.runner.scoreArea.filter(c => !before.runner.scoreArea.some(o => o.instanceId === c.instanceId));
    const scored = s.corp.scoreArea.filter(c => !before.corp.scoreArea.some(o => o.instanceId === c.instanceId));
    for (const e of events) {
      for (const c of stolen) {
        if (e.runnerTurnsSeen <= 2 && !e.stolenIds.has(c.instanceId)) {
          if (hqAgendas.has(c.instanceId)) { e.stolenHQ2 += pts(c); e.stolenIds.add(c.instanceId); }
          else if (rdIds.has(c.instanceId)) { e.stolenRD2 += pts(c); e.stolenIds.add(c.instanceId); }
        }
      }
      for (const c of scored) {
        if (remoteOf.get(c.instanceId) !== e.remote) continue;
        e.scoredRemoteEver += pts(c);
        if (e.corpTurnsSeen <= 2) e.scoredRemote2 += pts(c);
      }
    }
    if (s.activePlayer !== lastActive) {
      lastActive = s.activePlayer;
      for (const e of events) {
        if (s.activePlayer === 'runner') e.runnerTurnsSeen++;
        else e.corpTurnsSeen++;
      }
    }
  }
  console.log(JSON.stringify({ ...label, winner: s.winner ?? null, turns: s.turnNumber, events: events.map(({ stolenIds: _, ...e }) => e) }));
}

if (process.env.FIX) {
  const r = JSON.parse(readFileSync(process.env.FIX, 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  let i = 0;
  const moves = r.moves as GameAction[];
  let cur = s;
  play(() => (i < moves.length ? (cur = executeAction(cur, moves[i++])) : null), s, { fix: process.env.FIX }, (b) => {
    const m = moves[i - 1] as GameAction & { cardInstanceId?: string };
    const line = isCorpMain(b) && !activePrompt(b) ? asSide('corp', () => scoreInTwo(b)) : null;
    return line?.form === 'install+ice' && line.iceId === m.cardInstanceId ? 'scoreInTwo' : 'other';
  });
} else {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
  for (const [j, seed] of seeds.entries()) {
    if (j % shards !== shard) continue;
    const p = Math.floor((seed - 1001) / 10);
    const corpDeck = corpDecks[Math.floor(p / runnerDecks.length)];
    valueLoops.clear();
    const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDeck, runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    let fired = 0;
    let line: ReturnType<typeof scoreInTwo> = null;
    try {
      play(() => {
        const b = game.state;
        fired = iceRedirectStats.fired;
        line = b.activePlayer === 'corp' && isCorpMain(b) && !activePrompt(b) ? asSide('corp', () => scoreInTwo(b)) : null;
        const before = b;
        if (!game.step()) return null;
        const added = Object.values(game.state.corp.servers).flatMap(v => v.ice).find(c => !Object.values(before.corp.servers).some(v => v.ice.some(o => o.instanceId === c.instanceId)));
        (globalThis as Record<string, unknown>).__layer = iceRedirectStats.fired > fired ? 'iceRedirect' : line?.form === 'install+ice' && added && line.iceId === added.instanceId ? 'scoreInTwo' : 'planner';
        return game.state;
      }, game.state, { seed, deck: corpDeck.name }, () => String((globalThis as Record<string, unknown>).__layer));
    } catch (err) {
      console.error(`deal ${seed}: ${err}`);
    }
  }
}
