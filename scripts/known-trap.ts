/**
 * Part D0 (spec-jeff-games-48-50.md): Corp spending on a server whose only root cards are traps the Runner has accessed
 * (card.runnerKnows, 10.2.2b; public to the Corp, 7.1.2). Per game: advances on such a trap, ice installed there, ice
 * rezzed there; clicks and credits. Self-play deals (SEEDS) or report-format replays (FIX=a.json,b.json).
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction, rezCostOf } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { isTrap } from '../src/ai/runs';

type A = GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
type T = { advances: number; ice: number; rezzes: number; clicks: number; credits: number; examples: string[] };
const knownTrapServer = (s: GameState, id: string | undefined) => {
  const v = id ? s.corp.servers[id] : undefined;
  return !!v && v.isRemote && v.root.length > 0 && v.root.every(c => c.runnerKnows && isTrap(c.cardCode)) ? v : null;
};
function look(s: GameState, a: A, t: T, tag: string) {
  if (a.type === 'ADVANCE_CARD') {
    const v = Object.values(s.corp.servers).find(x => x.root.some(c => c.instanceId === a.cardInstanceId));
    if (v && knownTrapServer(s, v.id)) { t.advances++; t.clicks++; t.credits++; t.examples.push(`${tag} T${s.turnNumber} advance ${v.id} ${v.root.map(c => cardDef(c).title).join("+")}`); }
  } else if (a.type === 'INSTALL_CARD' && a.targetServerId && knownTrapServer(s, a.targetServerId)) {
    const c = s.corp.hq.find(x => x.instanceId === a.cardInstanceId);
    if (c && cardDef(c).type_code === 'ice') { const v = s.corp.servers[a.targetServerId]; t.ice++; t.clicks++; t.credits += v.ice.length; t.examples.push(`${tag} T${s.turnNumber} ice ${cardDef(c).title} ${v.id}`); }
  } else if (a.type === 'REZ_CARD') {
    const v = Object.values(s.corp.servers).find(x => x.ice.some(c => c.instanceId === a.cardInstanceId));
    if (v && knownTrapServer(s, v.id)) { const c = v.ice.find(x => x.instanceId === a.cardInstanceId)!; t.rezzes++; t.credits += rezCostOf(s, c); t.examples.push(`${tag} T${s.turnNumber} rez ${cardDef(c).title} ${v.id}`); }
  }
}
const fresh = (): T => ({ advances: 0, ice: 0, rezzes: 0, clicks: 0, credits: 0, examples: [] });
if (process.env.FIX) {
  for (const f of process.env.FIX.split(',')) {
    const r = JSON.parse(readFileSync(f, 'utf8'));
    let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    if (r.startStops) s = { ...s, stops: r.startStops };
    const t = fresh();
    let stop = '';
    try {
      for (const [i, m] of (r.moves as A[]).entries()) {
        if (m.player === 'corp' && r.config.ai === 'corp') look(s, m, t, `#${i}`);
        s = executeAction(s, m);
      }
    } catch (err) {
      stop = String(err).slice(0, 80);
    }
    console.log(JSON.stringify({ fix: f.split('/').pop(), ai: r.config.ai, stop, ...t }));
  }
} else {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  for (const [k, seed] of (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number).entries()) {
    if (k % shards !== shard) continue;
    const p = Math.floor((seed - 1001) / 10);
    valueLoops.clear();
    const t = fresh();
    const corp = createAgent('corp', 'normal');
    const choose = corp.chooseAction.bind(corp);
    corp.chooseAction = (st: GameState) => { const a = choose(st) as A; look(st, a, t, `${seed}`); return a; };
    const rez = corp.chooseRez?.bind(corp);
    if (rez) corp.chooseRez = (st, cards) => { const a = rez(st, cards) as A | null; if (a) look(st, a, t, `${seed}`); return a; };
    const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp, runner: createAgent('runner', 'normal') });
    let accessedTraps = 0;
    try {
      for (let i = 0; i < 8000 && !game.state.winner; i++) if (!game.step()) break;
      accessedTraps = Object.values(game.state.corp.servers).flatMap(v => v.root).filter(c => c.runnerKnows && isTrap(c.cardCode)).length;
    } catch (err) {
      console.error(`deal ${seed}: ${err}`);
    }
    console.log(JSON.stringify({ seed, deck: corpDecks[Math.floor(p / runnerDecks.length)].name, knownTrapsAtEnd: accessedTraps, ...t }));
  }
}
