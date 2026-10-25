/**
 * How the Corp AI loses: plays the shipped AI against itself on every deck
 * pairing and records, for each game, how it ended and where each Runner
 * point came from (which server, how much ice, how advanced the agenda was).
 *
 *   npx vite-node scripts/corp-losses.ts -- [games per pairing] [normal|hard]
 *
 * SHARD=i/n plays every n-th deal starting at i. scripts/corp-losses.sh runs
 * four shards and scripts/corp-losses-sum.mjs prints the breakdown.
 */
import { createInitialGameState, GameState } from '../src/core';
import { cardDef } from '../src/core/cards';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { createAgent, GameRunner } from '../src/ai';

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);

export interface Steal {
  turn: number;
  points: number;
  /** hq, rd, archives, remote, or other (points not from a run) */
  from: string;
  ice: number;
  rezzedIce: number;
  /** Advancement counters on the agenda (remote steals) */
  advanced: number;
  /** The agenda could have been scored already (remote steals) */
  scoreable: boolean;
  corpCredits: number;
  /** Agendas in HQ just before the steal (HQ steals) */
  hqAgendas: number;
  hqSize: number;
  title: string;
}

export interface GameRecord {
  corpDeck: string;
  runnerDeck: string;
  winner: string;
  reason: string;
  turns: number;
  corpScore: number;
  runnerScore: number;
  steals: Steal[];
  /** Agendas still in R&D / HQ when the game ended */
  agendasInRD: number;
  agendasInHQ: number;
  /** Turns the Corp spent with an agenda in hand and no remote holding one */
  idleAgendaTurns: number;
}

const isAgenda = (c: { cardCode: string }) => cardDef(c as never).type_code === 'agenda';

function reasonOf(state: GameState): string {
  const r = state.winReason ?? '';
  if (!state.winner) return 'unfinished';
  if (/flatline/i.test(r)) return 'flatline';
  if (/decked/i.test(r)) return 'corp decked';
  if (/conceded/i.test(r)) return 'conceded';
  return state.winner === 'corp' ? 'corp points' : 'runner points';
}

const corpDecks = DECKS.filter(d => d.side === 'corp');
const runnerDecks = DECKS.filter(d => d.side === 'runner');
const records: GameRecord[] = [];
let seed = 1000;
let deal = 0;
for (const c of corpDecks) {
  for (const r of runnerDecks) {
    for (let g = 0; g < games; g++) {
      seed++;
      if (deal++ % shards !== shard) continue;
      const agent = (side: 'corp' | 'runner') =>
        createAgent(side, level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {});
      const runner = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: agent('corp'), runner: agent('runner') });
      const steals: Steal[] = [];
      let idleAgendaTurns = 0;
      let lastTurn = -1;
      try {
        for (let steps = 0; steps < 4000 && runner.state.turnNumber <= 80; steps++) {
          const before = runner.state;
          if (before.turnNumber !== lastTurn && before.activePlayer === 'corp') {
            lastTurn = before.turnNumber;
            const remoteAgenda = Object.entries(before.corp.servers).some(([id, s]) => id.startsWith('remote') && s.root.some(isAgenda));
            if (!remoteAgenda && before.corp.hq.some(isAgenda)) idleAgendaTurns++;
          }
          if (!runner.step()) break;
          const after = runner.state;
          const gained = after.runner.score - before.runner.score;
          if (gained <= 0) continue;
          const serverId = before.activeRun?.server ?? after.activeRun?.server ?? null;
          const server = serverId ? before.corp.servers[serverId] : undefined;
          const stolen = after.runner.scoreArea.filter(a => !before.runner.scoreArea.some(b => b.instanceId === a.instanceId));
          const agenda = stolen[0] ? (server?.root.find(x => x.instanceId === stolen[0].instanceId) ?? null) : null;
          const def = agenda ? cardDef(agenda) : null;
          steals.push({
            turn: before.turnNumber,
            points: gained,
            from: !serverId ? 'other' : serverId.startsWith('remote') ? 'remote' : serverId,
            ice: server?.ice.length ?? 0,
            rezzedIce: server?.ice.filter(i => i.isRezzed).length ?? 0,
            advanced: agenda?.advancementCounters ?? 0,
            scoreable: !!agenda && !!def && (agenda.advancementCounters ?? 0) >= (def.advancement_cost ?? 99),
            corpCredits: before.corp.credits,
            hqAgendas: before.corp.hq.filter(isAgenda).length,
            hqSize: before.corp.hq.length,
            title: stolen[0] ? cardDef(stolen[0]).title : '?',
          });
        }
      } catch (err) {
        console.error(`deal ${seed} ${c.name} vs ${r.name}: ${err}`);
      }
      const s = runner.state;
      records.push({
        corpDeck: c.name,
        runnerDeck: r.name,
        winner: s.winner ?? 'draw',
        reason: reasonOf(s),
        turns: s.turnNumber,
        corpScore: s.corp.score,
        runnerScore: s.runner.score,
        steals,
        agendasInRD: s.corp.rd.filter(isAgenda).length,
        agendasInHQ: s.corp.hq.filter(isAgenda).length,
        idleAgendaTurns,
      });
    }
  }
}
console.log(JSON.stringify(records));
