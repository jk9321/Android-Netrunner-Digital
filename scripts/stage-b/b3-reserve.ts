/**
 * Stage B3 log (review R6): the three reserves outside the ranking that now read rez money's keep (corp/placement.ts),
 * against the old reserve each one read, on every Corp main-phase state of the human games (the recorded moves
 * replayed, no AI asked):
 *  - scoringShort's floor and reservedForAgenda's horizon floor: keepFloor (keep, the least over the HQ agendas) against
 *    the old floor (lineFloor, the byServer sum, the least over the HQ agendas). Both floors, and each rule's answer.
 *  - centralIce's gate, for each ice in HQ the pick could install on a remote with HQ or R&D bare: the new gate
 *    (credits - rez cost >= keep) against the old one (credits >= rez cost).
 * Prints the counts and the states where a gate differs.
 *
 *   npx vite-node scripts/stage-b/b3-reserve.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, getLegalActions, rezCostOf } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { lineFloor, rezMoney } from '../../src/ai/corp/rezMoney';
import { centralIce } from '../../src/ai/corp/placement';
import { scoringRemote } from '../../src/ai/corp/lines';
import { serverHold } from '../../src/ai/corp/hold';
import { clearCaches } from '../stage-a/harness';

const dir = 'tests/fixtures/human-games';
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
const n = { states: 0, floorDiffer: 0, shortDiffer: 0, horizonDiffer: 0, keepAboveZero: 0, gateAsked: 0, gateDiffer: 0, newFires: 0, oldFires: 0 };
const gateCases: string[] = [];
for (const f of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
  const r = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  if (!r.moves?.length) continue;
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const [i, m] of (r.moves as GameAction[]).entries()) {
    if (s.activePlayer === 'corp' && !s.activeRun && s.pendingPrompts.length === 0 && s.corp.clicks > 0) {
      const st = s;
      asSide('corp', () => {
        decisionContext(st, 'corp');
        n.states++;
        const agendas = st.corp.hq.filter(isAgenda);
        const oldF = agendas.length ? Math.min(...agendas.map(a => lineFloor(st, a.instanceId))) : lineFloor(st, '');
        const newF = agendas.length ? Math.min(...agendas.map(a => rezMoney(st, { without: [a.instanceId] }).keep)) : rezMoney(st).keep;
        if (oldF !== newF) n.floorDiffer++;
        const scoring = scoringRemote(st);
        if (scoring && oldF !== newF) {
          const end = st.corp.credits + Math.max(0, st.corp.clicks - 1);
          const holds = (floor: number) => serverHold(st, scoring.id, { when: 'runnerTurn', corpCredits: end - floor }).holds;
          if (holds(oldF) !== holds(newF)) n.shortDiffer++;
          // reservedForAgenda's first test with no income: a floor change moves the horizon by the same amount
          if (agendas.length && holds(oldF) !== holds(newF)) n.horizonDiffer++;
        }
        const keep = rezMoney(st).keep;
        if (keep > 0) n.keepAboveZero++;
        const bare = (['hq', 'rd'] as const).filter(id => st.corp.servers[id].ice.length === 0);
        if (!bare.length) return;
        const seen = new Set<string>();
        for (const a of getLegalActions(st, 'corp')) {
          const p = a as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
          if (p.type !== 'INSTALL_CARD' || !(p.asNewRemote || st.corp.servers[p.targetServerId ?? '']?.isRemote)) continue;
          const card = st.corp.hq.find(c => c.instanceId === p.cardInstanceId);
          if (!card || cardDef(card).type_code !== 'ice' || seen.has(card.cardCode)) continue;
          seen.add(card.cardCode);
          n.gateAsked++;
          const rez = rezCostOf(st, card);
          const oldGate = st.corp.credits >= rez;
          const fires = !!centralIce(st, p);
          if (fires) n.newFires++;
          if (oldGate) n.oldFires++;
          if (oldGate !== fires) {
            n.gateDiffer++;
            gateCases.push(`${f} move ${i} T${st.turnNumber}: ${cardDef(card).title} (rez ${rez}), credits ${st.corp.credits}, keep ${keep}${st.corp.credits < keep ? " (more than its credits)" : ""}, bare ${bare.join('+')}, keep by server ${JSON.stringify(rezMoney(st).byServer)}`);
          }
        }
      });
      clearCaches();
    }
    try { s = executeAction(s, m); } catch { break; }
  }
}
console.log(JSON.stringify(n));
for (const c of gateCases) console.log(c);
