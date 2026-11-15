/**
 * Stage C8 (AI Coordinator 2026-11-15 20:12Z): why remote steals fell and HQ/R&D steals rose on the landing g3.
 * Replays the g3 batch's deals (games 0 to 2 of every pairing, corp-losses.ts seeds) with the Normal AI on both sides
 * and prints one JSON line per game: steals and points by server, accesses by server, agendas installed / scored,
 * advances, click draws, the board (lossLog averages), ice on HQ and R&D and agendas in HQ at turns 6 and 12.
 * Agents are wrapped as observers only (the same calls, the same answers), so play is the batch's own.
 *
 *   SHARD=k/n npx vite-node scripts/stage-c/steal-shift.ts -- [games per pairing, default 3]
 *   node scripts/stage-c/steal-shift-sum.mjs <branch dir> <base dir>
 */
import { cardDef, createInitialGameState, GameAction, GameState } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { ALL_DECKS } from '../nsg-sample-decks';
import { createAgent } from '../../src/ai';
import type { Agent } from '../../src/ai/agent';
import { playLogged } from '../lossLog';
import { valueLoops } from '../../src/ai/valueModel';

const games = Number(process.argv.slice(2).filter(a => a !== '--')[0] ?? 3);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const stride = Math.max(10, games);
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');

const agendasInHand = (s: GameState) => s.corp.hq.filter(c => cardDef(c).type_code === 'agenda').length;

let pairing = 0;
let deal = 0;
for (const c of corpDecks) {
  for (const r of runnerDecks) {
    pairing++;
    for (let g = 0; g < games; g++) {
      const seed = 1000 + (pairing - 1) * stride + g + 1;
      if (deal++ % shards !== shard) continue;
      valueLoops.clear();
      const counts = { draws: 0, advances: 0, scores: 0, agendaInstalls: 0 };
      const at: Record<number, { hqIce: number; rdIce: number; hqAgendas: number; remotesIced: number }> = {};
      let last: GameState | undefined;
      const see = (s: GameState) => {
        last = s;
        for (const t of [6, 12]) {
          if (!at[t] && s.turnNumber >= t) {
            const remotes = Object.values(s.corp.servers).filter(v => v.isRemote);
            at[t] = { hqIce: s.corp.servers.hq.ice.length, rdIce: s.corp.servers.rd.ice.length, hqAgendas: agendasInHand(s), remotesIced: remotes.filter(v => v.ice.length > 0).length };
          }
        }
      };
      const wrap = (a: Agent): Agent => {
        const w = Object.create(a) as Agent & { chooseAction: (s: GameState) => GameAction };
        w.chooseAction = (s: GameState) => {
          see(s);
          const act = a.chooseAction(s);
          if (a.side === 'corp') {
            const t = (act as { type: string }).type;
            if (t === 'DRAW_CARD') counts.draws++;
            else if (t === 'ADVANCE_CARD') counts.advances++;
            else if (t === 'SCORE_AGENDA') counts.scores++;
            else if (t === 'INSTALL_CARD') {
              const id = (act as { cardInstanceId?: string }).cardInstanceId;
              const card = id ? s.corp.hq.find(x => x.instanceId === id) : undefined;
              if (card && cardDef(card).type_code === 'agenda') counts.agendaInstalls++;
            }
          }
          return act;
        };
        if (a.chooseRez) w.chooseRez = (s, cards) => (see(s), a.chooseRez!(s, cards));
        if (a.chooseOffTurn) w.chooseOffTurn = s => (see(s), a.chooseOffTurn!(s));
        return w;
      };
      try {
        const agents = { corp: wrap(createAgent('corp', 'normal', {})), runner: wrap(createAgent('runner', 'normal', {})) };
        const rec = playLogged(createInitialGameState(deckGameSetup(seed, c, r)), agents, { corp: c.name, runner: r.name });
        // Accesses by server: each "Run successful on X" line opens a breach; each access line after it counts for X
        const access: Record<string, number> = {};
        const breaches: Record<string, number> = {};
        let server = 'other';
        for (const e of last?.log ?? []) {
          const m = /^Run successful on (.+)! Accessing cards\.$/.exec(e.message);
          if (m) {
            server = m[1] === 'HQ' ? 'hq' : m[1] === 'R&D' ? 'rd' : m[1] === 'Archives' ? 'archives' : 'remote';
            breaches[server] = (breaches[server] ?? 0) + 1;
          } else if (e.event === 'access') access[server] = (access[server] ?? 0) + 1;
        }
        const steals: Record<string, { n: number; points: number }> = {};
        for (const st of rec.steals) {
          const k = steals[st.from] ?? (steals[st.from] = { n: 0, points: 0 });
          k.n++;
          k.points += st.points;
        }
        console.log(JSON.stringify({
          seed, corpDeck: c.name, runnerDeck: r.name, winner: rec.winner, reason: rec.reason, turns: rec.turns,
          corpScore: rec.corpScore, runnerScore: rec.runnerScore, steals, access, breaches, ...counts,
          remoteAgendaInstalls: rec.agendaInstalls.length, agendasInHQ: rec.agendasInHQ, agendasInRD: rec.agendasInRD,
          idleAgendaTurns: rec.idleAgendaTurns, board: rec.board, at, creditClicks: rec.money.creditClicks,
          stuck: rec.alarms.filter(a => a.kind === 'agenda stuck in HQ').length,
        }));
      } catch (err) {
        console.log(JSON.stringify({ seed, crashed: `${err}`.slice(0, 200) }));
      }
    }
  }
}
