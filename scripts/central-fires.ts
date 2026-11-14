/**
 * Central ice (countedScore.ts centralIce, spec-central-ice.md): fire count and what follows, one JSON line per deal.
 * Plays the deal as PLAN_OFF gives. The fires are the top-level Corp's ice installs on a bare central that centralIce gives for
 * the same ice sent to a new remote (centralIce called on the state; a planner pick of the same install counts too). For each fire: Runner
 * points stolen from that central within the next 2 Runner turns, and Corp points scored from any remote within the
 * next 2 Corp turns (turns counted by the active player changing).
 * Per fire also: Runner runs on that central within 2 Runner turns, and the fate of the agendas in HQ at the fire after
 * 2 Corp turns (still in HQ, installed, scored, stolen).
 * Per game also (bars/central-ice-bare.md (a), (c)): the Corp turn of its first remote install and of its first agenda
 * scored; and after a fire on the Corp's first turn, the Corp's other actions that turn and where its next ice went.
 *   SEEDS=1001,1041 [PLAN_OFF=...] npx vite-node scripts/central-fires.ts > out.jsonl
 */
import { GameAction, GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { centralIce } from '../src/ai/corp/placement';
import { isCorpMain } from '../src/ai/corp/lines';
import { installDiagnostics } from '../src/ai/diagnostics';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

applyPlanOff(process.env.PLAN_OFF ?? '');
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const agendaIds = (s: GameState) => new Map(Object.values(s.corp.servers).flatMap(v => v.root.filter(c => cardDef(c).type_code === 'agenda').map(c => [c.instanceId, v.id] as const)));
for (const [k, seed] of seeds.entries()) {
  if (k % shards !== shard) continue;
  const p = Math.floor((seed - 1001) / 10);
  const corpDeck = corpDecks[Math.floor(p / runnerDecks.length)];
  valueLoops.clear();
  const centralIceStats = { hq: 0, rd: 0 };
  installDiagnostics();
  const corpAgent = createAgent('corp', 'normal');
  // (c): the Corp's main-phase actions, by Corp turn (its click actions and what they install where)
  const acts: { corpTurn: number; what: string }[] = [];
  let corpTurn = 0;
  const choose = corpAgent.chooseAction.bind(corpAgent);
  corpAgent.chooseAction = (st: GameState) => {
    const a = choose(st) as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
    const to = a.type === 'INSTALL_CARD' && isCorpMain(st) && (a.targetServerId === 'hq' || a.targetServerId === 'rd') && st.corp.servers[a.targetServerId].ice.length === 0 ? a.targetServerId : undefined;
    if (to) {
      const would = asSide('corp', () => (decisionContext(st, 'corp'), centralIce(st, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: a.cardInstanceId, asNewRemote: true } as GameAction))) as { targetServerId?: string } | null;
      if (would?.targetServerId === to) centralIceStats[to]++;
    }
    if (isCorpMain(st) && a.type !== 'START_TURN') {
      const c = a.cardInstanceId ? [...st.corp.hq, ...Object.values(st.corp.servers).flatMap(v => [...v.ice, ...v.root])].find(x => x.instanceId === a.cardInstanceId) : undefined;
      acts.push({ corpTurn, what: `${a.type}${c ? ' ' + cardDef(c).title + ' (' + cardDef(c).type_code + ')' : ''}${a.targetServerId ? ' ' + a.targetServerId : a.asNewRemote ? ' new' : ''}` });
    }
    return a;
  };
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDeck, runnerDecks[p % runnerDecks.length])), { corp: corpAgent, runner: createAgent('runner', 'normal') });
  if (game.state.activePlayer === 'corp') corpTurn = 1;
  let firstRemote: number | null = null, firstScore: number | null = null;
  const remoteCards = (x: GameState) => Object.values(x.corp.servers).filter(v => v.isRemote).reduce((n, v) => n + v.ice.length + v.root.length, 0);
  const fires: { at?: number; corpTurn?: number; turn: number; central: string; corpTurns: number; runnerTurns: number; stolen: number; scored: number; runs: number; agendas: string[]; fate?: Record<string, number> }[] = [];
  const hqAgendaIds = (x: GameState) => x.corp.hq.filter(c => cardDef(c).type_code === 'agenda').map(c => c.instanceId);
  let half = 0;
  const t0 = performance.now();
  try {
    for (let i = 0; i < 8000; i++) {
      const s: GameState = game.state;
      const firedHq = centralIceStats.hq, fired = centralIceStats.hq + centralIceStats.rd;
      const runOn = s.activeRun?.server;
      const roots = agendaIds(s);
      const rs = s.runner.score, cs = s.corp.score;
      const before = s.activePlayer;
      if (!game.step()) break;
      const t = game.state;
      if (t.activePlayer !== before && t.activePlayer === 'corp') corpTurn++;
      if (firstRemote === null && remoteCards(t) > remoteCards(s)) firstRemote = corpTurn;
      if (firstScore === null && t.corp.score > s.corp.score) firstScore = corpTurn;
      if (t.activePlayer !== before) {
        half++;
        for (const f of fires) if (t.activePlayer === 'corp') f.runnerTurns++; else f.corpTurns++;
      }
      const live = fires.filter(f => f.runnerTurns <= 2 && f.corpTurns <= 2);
      if (t.activeRun && !s.activeRun) for (const f of live) if (f.central === t.activeRun.server && f.runnerTurns <= 2) f.runs++;
      for (const f of fires) if (!f.fate && f.corpTurns >= 2 && t.activePlayer === 'runner') {
        const where = (id: string) => t.corp.hq.some(c => c.instanceId === id) ? 'inHq' : t.corp.scoreArea.some(c => c.instanceId === id) ? 'scored' : t.runner.scoreArea.some(c => c.instanceId === id) ? 'stolen' : Object.values(t.corp.servers).some(v => v.root.some(c => c.instanceId === id)) ? 'installed' : 'other';
        f.fate = {};
        for (const id of f.agendas) f.fate[where(id)] = (f.fate[where(id)] ?? 0) + 1;
      }
      if (t.runner.score > rs && runOn) for (const f of live) if (f.central === runOn && f.runnerTurns <= 2) f.stolen += t.runner.score - rs;
      if (t.corp.score > cs) {
        const after = agendaIds(t);
        const fromRemote = [...roots].some(([id, sv]) => !after.has(id) && sv.startsWith('remote'));
        if (fromRemote) for (const f of live) if (f.corpTurns <= 2) f.scored += t.corp.score - cs;
      }
      if (centralIceStats.hq + centralIceStats.rd > fired) fires.push({ at: acts.length, corpTurn, turn: half, central: centralIceStats.hq > firedHq ? 'hq' : 'rd', corpTurns: 0, runnerTurns: 0, stolen: 0, scored: 0, runs: 0, agendas: hqAgendaIds(s) });
    }
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  const sum = (f: (x: (typeof fires)[number]) => number) => fires.reduce((n, x) => n + f(x), 0);
  console.log(JSON.stringify({ seed, deck: corpDeck.name, firstRemote, firstScore, winner: game.state.winner ?? null, turns: game.state.turnNumber, score: [game.state.corp.score, game.state.runner.score], ms: Math.round(performance.now() - t0), stats: { ...centralIceStats }, fires: fires.length, stolen: sum(x => x.stolen), scored: sum(x => x.scored), runs: sum(x => x.runs), fate: fires.reduce((m, f) => { for (const [k, v] of Object.entries(f.fate ?? {})) m[k] = (m[k] ?? 0) + v; return m; }, {} as Record<string, number>), detail: fires.map(f => ({ corpTurn: f.corpTurn, rest: f.corpTurn === 1 ? acts.slice(f.at!).filter(x => x.corpTurn === 1).map(x => x.what) : undefined, nextIce: f.corpTurn === 1 ? acts.slice(f.at!).find(x => x.what.startsWith('INSTALL_CARD') && x.what.includes('(ice)'))?.what : undefined, turn: f.turn, central: f.central, runs: f.runs, stolen: f.stolen, scored: f.scored, fate: f.fate })) }));
}
