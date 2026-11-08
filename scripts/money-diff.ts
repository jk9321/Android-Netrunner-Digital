/**
 * Phase 2 E (AI Coordinator 2026-11-08): which Corp decisions the +1 credit a turn ceiling (oracle.money) changes.
 *
 *   SEEDS=1212,1423 [TURNS=6] npx vite-node scripts/money-diff.ts
 *
 * Plays each deal twice, as corp-losses.ts seeds it (games=3: seed = 1000 + (pairing-1)*10 + g + 1): honest, and with +1
 * credit at the start of every Corp turn (scripts/oracle-money.ts; not a rule, the Corp gains credits only by rules 5.2.6
 * and card abilities: a measurement). Logs the Corp's own-turn actions in its first TURNS turns by kind (click for a credit,
 * draw, install by card type and where, advance, score, operation by money or not, rez on its own turn, trash, other)
 * and in-run rezzes, then prints the per-kind totals both ways, the first turn each agenda was installed, advanced to
 * scoring and scored, and each deal's first Corp action that differs.
 */
import { GameAction, GameState, createInitialGameState } from '../src/core';
import { cardDef } from '../src/core/cards';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { GameRunner, createAgent } from '../src/ai';
import { withOracleMoney } from './oracle-money';
import { creditNeed, moneyGain } from '../src/ai/valueModel';
import { asSide } from '../src/ai/pricing';

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const dealOf = (seed: number) => {
  const pairing = Math.floor((seed - 1001) / 10);
  return { corp: corpDecks[Math.floor(pairing / runnerDecks.length)], runner: runnerDecks[pairing % runnerDecks.length] };
};
const TURNS = Number(process.env.TURNS ?? 6);

interface Act { turn: number; kind: string; title: string }
interface Played {
  winner: string;
  acts: Act[];
  scored: Map<string, number>;
  installed: Map<string, number>;
  /** Credit clicks with the bank already at its credit need (valueModel creditNeed, Corp view); draws with HQ at its hand size or more */
  idleCredit: number;
  fullDraw: number;
  /** Runner turns where the Corp rezzed ice in a run and so started its next turn short of the advancement a remote agenda still needed, which it could have paid without those rezzes */
  rezBlocked: number;
  rezRunnerTurns: number;
}

/** Credits still short on the remote agendas (1 per advancement, rule 5.2.6f). */
const advanceShort = (s: GameState) =>
  Object.values(s.corp.servers).filter(sv => sv.isRemote).flatMap(sv => sv.root).filter(c => cardDef(c).type_code === 'agenda').reduce((n, c) => n + Math.max(0, (cardDef(c).advancement_cost ?? 0) - c.advancementCounters), 0);

const findCard = (s: GameState, id: string) =>
  [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(sv => [...sv.root, ...sv.ice])].find(c => c.instanceId === id);

function kindOf(before: GameState, after: GameState, a: GameAction): { kind: string; title: string } {
  const id = (a as { cardInstanceId?: string }).cardInstanceId;
  const card = id ? findCard(before, id) : undefined;
  const title = card ? cardDef(card).title : '';
  switch (a.type) {
    case 'GAIN_CREDIT': return { kind: 'click for credit', title };
    case 'DRAW_CARD': return { kind: 'draw', title };
    case 'ADVANCE_CARD': return { kind: card && cardDef(card).type_code === 'agenda' ? 'advance agenda' : 'advance other', title };
    case 'SCORE_AGENDA': return { kind: 'score', title };
    case 'PLAY_OPERATION_OR_EVENT': return { kind: card && moneyGain(card) > 0 ? 'money operation' : 'other operation', title };
    case 'INSTALL_CARD': {
      const type = card ? cardDef(card).type_code : '?';
      const where = type === 'ice' ? (a.asNewRemote || /remote/.test(a.targetServerId ?? '') ? ' (remote)' : ' (central)') : '';
      return { kind: `install ${type}${where}`, title };
    }
    case 'REZ_CARD': return { kind: `rez ${card ? cardDef(card).type_code : '?'} own turn`, title };
    case 'END_TURN': return { kind: 'end turn', title };
    default:
      if (after.corp.clicks < before.corp.clicks) return { kind: `other click (${a.type})`, title };
      return { kind: '', title };
  }
}

function play(seed: number, money: boolean): Played {
  const { corp, runner } = dealOf(seed);
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corp, runner)), { corp: createAgent('corp', 'normal', {}), runner: createAgent('runner', 'normal', {}) });
  const acts: Act[] = [];
  const scored = new Map<string, number>();
  const installed = new Map<string, number>();
  let told = -1;
  let idleCredit = 0, fullDraw = 0, rezBlocked = 0, rezRunnerTurns = 0;
  let runnerTurn = -1, rezSpent = 0;
  for (let steps = 0; steps < 4000 && game.state.turnNumber <= 80; steps++) {
    if (money && game.state.activePlayer === 'corp' && game.state.turnNumber !== told) {
      told = game.state.turnNumber;
      game.state = withOracleMoney(game.state);
    }
    const before = game.state;
    // A Corp turn begins: did this Runner turn's in-run rezzes leave it short of the advancement it needs?
    if (before.activePlayer === 'corp' && runnerTurn >= 0 && before.turnNumber !== runnerTurn) {
      if (rezSpent > 0 && before.turnNumber <= TURNS + 1) {
        rezRunnerTurns++;
        const short = advanceShort(before);
        if (short > 0 && before.corp.credits < short && before.corp.credits + rezSpent >= short) rezBlocked++;
      }
      runnerTurn = -1;
      rezSpent = 0;
    }
    if (before.activePlayer === 'runner') runnerTurn = before.turnNumber;
    if (!game.step()) break;
    const after = game.state;
    const a = game.last;
    const turn = before.turnNumber;
    // agendas installed / scored (by instance)
    for (const sv of Object.values(after.corp.servers)) for (const c of sv.root) if (cardDef(c).type_code === 'agenda' && !installed.has(c.instanceId)) installed.set(c.instanceId, turn);
    for (const c of after.corp.scoreArea) if (!scored.has(c.instanceId)) scored.set(c.instanceId, turn);
    if (turn > TURNS || !a) continue;
    if (before.activePlayer === 'corp' && !before.activeRun && a.player === 'corp') {
      if (a.type === 'GAIN_CREDIT' && before.corp.credits >= asSide('corp', () => creditNeed(before, 'corp'))) idleCredit++;
      if (a.type === 'DRAW_CARD' && before.corp.hq.length >= before.corp.handSizeLimit) fullDraw++;
      const k = kindOf(before, after, a);
      if (k.kind) acts.push({ turn, ...k });
    }
    // in-run rezzes of ice by the Corp
    if (before.activeRun) {
      const rezzed = Object.values(before.corp.servers).flatMap(sv => sv.ice).filter(i => !i.isRezzed && Object.values(after.corp.servers).some(sv => sv.ice.some(x => x.instanceId === i.instanceId && x.isRezzed)));
      for (const i of rezzed) acts.push({ turn, kind: 'rez ice in a run', title: cardDef(i).title });
      if (rezzed.length && before.activePlayer === 'runner') rezSpent += Math.max(0, before.corp.credits - after.corp.credits);
    }
  }
  return { winner: game.state.winner ?? 'draw', acts, scored, installed, idleCredit, fullDraw, rezBlocked, rezRunnerTurns };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const totals = new Map<string, [number, number]>();
const timing = { honestScoreTurn: [] as number[], moneyScoreTurn: [] as number[], honestInstallTurn: [] as number[], moneyInstallTurn: [] as number[] };
const firstDiffs: string[] = [];
const counts = { honest: { idleCredit: 0, fullDraw: 0, rezBlocked: 0, rezRunnerTurns: 0 }, money: { idleCredit: 0, fullDraw: 0, rezBlocked: 0, rezRunnerTurns: 0 } };
for (const seed of seeds) {
  const h = play(seed, false);
  const m = play(seed, true);
  for (const [i, p] of [h, m].entries()) for (const a of p.acts) {
    const t = totals.get(a.kind) ?? [0, 0];
    t[i]++;
    totals.set(a.kind, t);
  }
  for (const [k, p] of [['honest', h], ['money', m]] as const) for (const key of Object.keys(counts[k]) as (keyof typeof counts.honest)[]) counts[k][key] += p[key];
  const first = (map: Map<string, number>) => (map.size ? Math.min(...map.values()) : NaN);
  timing.honestScoreTurn.push(first(h.scored));
  timing.moneyScoreTurn.push(first(m.scored));
  timing.honestInstallTurn.push(first(h.installed));
  timing.moneyInstallTurn.push(first(m.installed));
  const i = h.acts.findIndex((a, k) => !m.acts[k] || m.acts[k].kind !== a.kind || m.acts[k].title !== a.title || m.acts[k].turn !== a.turn);
  const diff = i < 0 ? 'same through turn ' + TURNS : `turn ${h.acts[i]?.turn ?? m.acts[i]?.turn}: honest ${h.acts[i] ? `${h.acts[i].kind} ${h.acts[i].title}` : '-'} -> money ${m.acts[i] ? `${m.acts[i].kind} ${m.acts[i].title}` : '-'}`;
  firstDiffs.push(`${seed} ${h.winner}->${m.winner}: ${diff}`);
  console.log(JSON.stringify({ seed, honest: h.winner, money: m.winner, firstScore: [first(h.scored), first(m.scored)], firstAgendaInstall: [first(h.installed), first(m.installed)], diff }));
}
const avg = (l: number[]) => { const v = l.filter(x => !Number.isNaN(x)); return `${(v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1)).toFixed(1)} (${v.length})`; };
console.log(`\nCorp actions in its first ${TURNS} turns over ${seeds.length} deals (honest / +1 a turn):`);
for (const [k, [a, b]] of [...totals].sort((x, y) => y[1][0] + y[1][1] - x[1][0] - x[1][1])) if (k !== 'end turn') console.log(`  ${k}: ${a} / ${b}`);
console.log(`first agenda installed in a remote, turn: ${avg(timing.honestInstallTurn)} / ${avg(timing.moneyInstallTurn)}`);
console.log(`first agenda scored, turn: ${avg(timing.honestScoreTurn)} / ${avg(timing.moneyScoreTurn)}`);
console.log(`credit clicks with the bank at its need: ${counts.honest.idleCredit} / ${counts.money.idleCredit}; draws with a full hand: ${counts.honest.fullDraw} / ${counts.money.fullDraw}`);
console.log(`Runner turns with in-run ice rezzes: ${counts.honest.rezRunnerTurns} / ${counts.money.rezRunnerTurns}; of those, the next Corp turn began short of a remote agenda's advancement it could have paid without the rezzes: ${counts.honest.rezBlocked} / ${counts.money.rezBlocked}`);
console.log('\nFirst differing Corp action:');
for (const d of firstDiffs) console.log('  ' + d);
