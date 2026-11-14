/**
 * Step 4 Stage A report for Jeff: what each owner returns at positions from his games #48 to #53 (the moves the
 * existing pins use). For each position: the board in short, then serverHold for every server, rezMoney, corpPools and
 * the stake of HQ and R&D, and place() for the move's install when the recorded move is one.
 *
 *   npx vite-node scripts/stage-a/examples.ts [report:move ...]   (default: the pinned positions below)
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { serverHold } from '../../src/ai/corp/hold';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { corpPools, stake } from '../../src/ai/corp/pools';
import { place } from '../../src/ai/corp/placement';

const DEFAULT = ['48:2', '49:82', '49:111', '50:15', '51:23', '51:33', '52:2', '53:62', '53:76', '53:191'];
const wanted = process.argv.slice(2).filter(a => a !== '--');

function at(n: number, move: number): { s: GameState; pick: GameAction } {
  const r = JSON.parse(readFileSync(`tests/fixtures/human-games/report-${n}.json`, 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of (r.moves as GameAction[]).slice(0, move)) s = executeAction(s, m);
  return { s, pick: r.moves[move] };
}

const title = (s: GameState, id?: string) => {
  const c = id ? [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice])].find(x => x.instanceId === id) : undefined;
  return c ? cardDef(c).title : id ?? '';
};
const fmt = (x: number) => (Number.isFinite(x) ? String(Math.round(x * 100) / 100) : x > 0 ? 'no way through' : String(x));

for (const key of wanted.length ? wanted : DEFAULT) {
  const [n, m] = key.split(':').map(Number);
  const { s, pick } = at(n, m);
  asSide('corp', () => {
    decisionContext(s, 'corp');
    const ice = (id: string) => s.corp.servers[id].ice.map(c => `${cardDef(c).title}${c.isRezzed ? '' : ' (unrezzed)'}`).join(', ') || 'none';
    const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => cardDef(c).title).join(', ') || 'nothing';
    console.log(`\n### Game #${n}, move ${m}: Corp turn ${s.turnNumber}, Corp ${s.corp.credits} credits ${s.corp.clicks} clicks, Runner ${s.runner.credits} credits, score ${s.corp.score}-${s.runner.score}`);
    console.log(`Rig: ${rig}. HQ agendas: ${s.corp.hq.filter(c => cardDef(c).type_code === 'agenda').map(c => cardDef(c).title).join(', ') || 'none'} (${s.corp.hq.length} cards in HQ).`);
    console.log(`Recorded move: ${pick.type} ${title(s, (pick as { cardInstanceId?: string }).cardInstanceId)} ${(pick as { targetServerId?: string }).targetServerId ?? ((pick as { asNewRemote?: boolean }).asNewRemote ? 'new remote' : '')}`);
    console.log('| Server | Ice | Holds next Runner turn | Rez to hold | Runner needs | Runner budget | Margin | Entries |\n|---|---|---|---|---|---|---|---|');
    for (const v of Object.values(s.corp.servers)) {
      const h = serverHold(s, v.id, { when: 'runnerTurn', corpCredits: s.corp.credits });
      console.log(`| ${v.id} | ${ice(v.id)} | ${h.holds ? 'yes' : 'no'} | ${h.holds ? `${h.rezCost} (${h.rez?.map(id => title(s, id)).join(', ') || 'nothing more'})` : '-'} | ${fmt(h.need)} | ${h.budget} | ${fmt(h.margin)} | ${h.entries} |`);
    }
    const money = rezMoney(s);
    console.log(`Rez money: keep ${money.keep}; by server ${JSON.stringify(money.byServer)}; staked but no rez holds: ${money.unholdable.join(', ') || 'none'}.`);
    const pools = corpPools(s);
    const hq = stake(s, 'hq', { accesses: 1 });
    const rd = stake(s, 'rd', { accesses: 1 });
    console.log(`Pools: HQ ${pools.hq} agendas (${pools.hqPoints} points); R&D: ${pools.unseen} agendas left by the deck list, ${(100 * pools.rdOdds).toFixed(1)}% a card, ${pools.rdPoints.toFixed(2)} points each. Stake of one access: HQ ${hq.points} points at most, ${hq.loss.toFixed(2)} expected on the clock; R&D ${rd.points} at most, ${rd.loss.toFixed(2)} expected.`);
    const card = s.corp.hq.find(c => c.instanceId === (pick as { cardInstanceId?: string }).cardInstanceId);
    if (pick.type === 'INSTALL_CARD' && card) {
      const p = place(s, card, { from: pick, held: null });
      console.log(`place(${cardDef(card).title}, from the recorded install): ${p.map(x => `${x.server}${x.pairWith ? ` with ${title(s, x.pairWith)} in front` : ''} (${x.reason})`).join('; ') || 'none (a counted line takes the click)'}`);
    }
  });
}
