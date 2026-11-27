/**
 * B4a bar 3 aside (the "agenda stuck in HQ" alarm): one line per turn of a batch deal, as the g1 batch plays it: at the
 * Corp's turn start the agendas in HQ (title, turn it came in), the Corp's actions, the Runner's runs (server, got in).
 *   SEEDS=1251,1491 npx vite-node scripts/runner-rework/b4/turns.ts
 */
import { CardInstance, GameState, cardDef, createInitialGameState } from '../../../src/core';
import { deckGameSetup } from '../../../src/data/decks';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { createAgent } from '../../../src/ai';
import { GameRunner } from '../../../src/ai/playout';
import { AlarmTracker } from '../../alarms';
import { valueLoops } from '../../../src/ai/valueModel';

const title = (c: CardInstance) => cardDef(c).title;
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const find = (s: GameState, id?: string) =>
  id ? [...s.corp.hq, ...s.runner.grip, ...Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice])].find(x => x.instanceId === id) : undefined;
for (const seed of seeds) {
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  const g = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const alarms = new AlarmTracker();
  const since = new Map<string, number>();
  let line: string[] = [];
  let head = '';
  let last: GameState | undefined;
  for (let i = 0; i < 6000; i++) {
    const before = g.state;
    const key = `${before.activePlayer}${before.turnNumber}`;
    if (key !== head) {
      if (head.startsWith('runner')) line.push(`runs: ${(last?.runsThisTurn ?? []).map(x => `${x.server}${x.successful ? '+' : '-'}`).join(' ') || '-'}`);
      if (head) console.log(`${seed} ${head}: ${line.join(', ')}`);
      head = key;
      line = [];
      if (before.activePlayer === 'corp') {
        for (const a of before.corp.hq.filter(isAgenda)) if (!since.has(a.instanceId)) since.set(a.instanceId, before.turnNumber);
        const hq = before.corp.hq.filter(isAgenda).map(a => `${title(a)}@T${since.get(a.instanceId)}`);
        line.push(`[${before.corp.credits}c HQ agendas: ${hq.join(' ') || '-'}]`);
      }
    }
    last = before;
    if (!g.step()) break;
    const a = g.last as { type: string; player?: string; cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean } | undefined;
    const n = alarms.alarms.length;
    alarms.step(before, g.state, (a ?? undefined) as never);
    for (const al of alarms.alarms.slice(n)) if (al.kind === 'agenda stuck in HQ') line.push(`ALARM(${al.detail})`);
    if (!a || a.player !== before.activePlayer || before.activeRun || a.type === 'PASS') continue;
    const card = find(before, a.cardInstanceId);
    line.push(`${a.type.replace('_CARD', '').toLowerCase()}${card ? ` ${title(card)}` : ''}${a.targetServerId ? `@${a.targetServerId}` : a.asNewRemote ? '@new' : ''}`);
  }
  if (head) console.log(`${seed} ${head}: ${line.join(', ')}`);
  console.log(`${seed} end: winner ${g.state.winner} T${g.state.turnNumber} score ${g.state.corp.score}-${g.state.runner.score}`);
}
