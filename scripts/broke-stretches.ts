/**
 * Phase 2 E0 (spec-phase2.md, item E): what the Corp bought before it stayed broke.
 *
 *   SEEDS=1212,1423 [FLIP=1] npx vite-node scripts/broke-stretches.ts
 *
 * Plays each deal the way corp-losses.ts does (the shipped decks, games=3 seeding: seed = 1000 + (pairing-1)*10 + g + 1)
 * and logs every Corp credit spent, by moneyKind and the card it went on. For each 'Corp stayed broke' stretch (2+ Corp
 * turn starts in a row under 3 credits, turn 3 or later, as scripts/alarms.ts counts it) it lists the purchases of the
 * two rounds before the stretch began. FLIP=1 replays the deal with +1 credit at the start of the Corp turn just before
 * the stretch (that turn only; scripts/oracle-money.ts) and says whether the stretch still forms, what the Corp bought
 * instead, and who won. Not a rule (the Corp gains credits only by rules 5.2.6 and card abilities): a measurement.
 * Prints one JSON line per deal, then a table of purchase kinds before stretches, won vs lost deals.
 */
import { CardInstance, GameState, createInitialGameState } from '../src/core';
import { cardDef } from '../src/core/cards';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { GameRunner, createAgent } from '../src/ai';
import { moneyKind } from './alarms';
import { withOracleMoney } from './oracle-money';

interface Spend {
  turn: number;
  side: 'corp' | 'runner';
  kind: string;
  /** What the kind is, more finely: an asset/upgrade's or operation's own type, an ice rez on a server holding an agenda or not */
  what: string;
  title: string;
  credits: number;
}
interface Played {
  winner: string;
  turns: number;
  starts: Map<number, number>;
  spends: Spend[];
}

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';

function dealOf(seed: number) {
  const pairing = Math.floor((seed - 1001) / 10);
  return { corp: corpDecks[Math.floor(pairing / runnerDecks.length)], runner: runnerDecks[pairing % runnerDecks.length] };
}

/** The card a credit-spending step went on, and a finer label for it. */
function spentOn(before: GameState, after: GameState, kind: string): { title: string; what: string } {
  const all = (st: GameState) => Object.values(st.corp.servers).flatMap(sv => [...sv.root, ...sv.ice].map(c => ({ c, sv })));
  const prev = new Map(all(before).map(x => [x.c.instanceId, x]));
  for (const { c, sv } of all(after)) {
    const was = prev.get(c.instanceId);
    const agendaThere = sv.root.some(isAgenda) || (sv.id === 'hq' && after.corp.hq.some(isAgenda));
    if (was && !was.c.isRezzed && c.isRezzed) {
      const type = cardDef(c).type_code;
      return { title: cardDef(c).title, what: type === 'ice' ? `${kind} (${sv.isRemote ? (agendaThere ? 'agenda remote' : 'other remote') : sv.id})` : `rez ${type}` };
    }
    if (was && c.advancementCounters > was.c.advancementCounters) return { title: cardDef(c).title, what: `advance ${cardDef(c).type_code}` };
    if (!was) return { title: cardDef(c).title, what: `install ${cardDef(c).type_code}` };
  }
  const played = after.corp.archives.faceUp.find(c => !before.corp.archives.faceUp.some(b => b.instanceId === c.instanceId));
  if (played) return { title: cardDef(played).title, what: `play ${cardDef(played).type_code}` };
  return { title: '?', what: kind };
}

function play(seed: number, bonusAt?: number): Played {
  const { corp, runner } = dealOf(seed);
  const agents = { corp: createAgent('corp', 'normal', {}), runner: createAgent('runner', 'normal', {}) };
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corp, runner)), agents);
  const starts = new Map<number, number>();
  const spends: Spend[] = [];
  let told = -1;
  for (let steps = 0; steps < 4000 && game.state.turnNumber <= 80; steps++) {
    if (game.state.activePlayer === 'corp' && game.state.turnNumber !== told) {
      told = game.state.turnNumber;
      if (bonusAt === told) game.state = withOracleMoney(game.state);
      starts.set(told, game.state.corp.credits);
    }
    const before = game.state;
    if (!game.step()) break;
    const after = game.state;
    const delta = after.corp.credits - before.corp.credits;
    if (delta < 0) {
      const kind = moneyKind(before, after);
      spends.push({ turn: before.turnNumber, side: before.activePlayer, kind, ...spentOn(before, after, kind), credits: -delta });
    }
  }
  return { winner: game.state.winner ?? 'draw', turns: game.state.turnNumber, starts, spends };
}

/** Turns where a stayed-broke stretch began (2+ starts in a row under 3, turn 3+). */
function stretches(starts: Map<number, number>): number[] {
  const out: number[] = [];
  const turns = [...starts.keys()].sort((a, b) => a - b);
  for (const t of turns) {
    if (t < 3 || (starts.get(t) ?? 9) >= 3 || (starts.get(t + 1) ?? 9) >= 3) continue;
    if (t > 3 && (starts.get(t - 1) ?? 9) < 3) continue; // inside a stretch already open
    out.push(t);
  }
  return out;
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const flip = !!process.env.FLIP;
const table = new Map<string, { won: number; lost: number; credits: number }>();
for (const seed of seeds) {
  const base = play(seed);
  const result: Record<string, unknown> = { seed, deal: `${dealOf(seed).corp.name} vs ${dealOf(seed).runner.name}`, winner: base.winner, turns: base.turns, starts: [...base.starts.values()].join(' ') };
  const list = [];
  for (const from of stretches(base.starts)) {
    const before = base.spends.filter(s => s.turn >= from - 2 && s.turn < from);
    for (const s of before) {
      const row = table.get(s.what) ?? { won: 0, lost: 0, credits: 0 };
      if (base.winner === 'corp') row.won += s.credits;
      else row.lost += s.credits;
      row.credits += s.credits;
      table.set(s.what, row);
    }
    const entry: Record<string, unknown> = { from, bought: before.map(s => `t${s.turn}${s.side[0]} ${s.what}: ${s.title} ${s.credits}`) };
    if (flip) {
      const alt = play(seed, from - 1);
      const still = [from, from + 1, from + 2].some(t => (alt.starts.get(t) ?? 9) < 3 && (alt.starts.get(t + 1) ?? 9) < 3);
      entry.flip = { stillBroke: still, winner: alt.winner, starts: [...alt.starts.values()].join(' '), bought: alt.spends.filter(s => s.turn >= from - 1 && s.turn < from).map(s => `t${s.turn}${s.side[0]} ${s.what}: ${s.title} ${s.credits}`) };
    }
    list.push(entry);
  }
  result.stretches = list;
  console.log(JSON.stringify(result));
}
console.log('\nCredits spent in the two rounds before a stayed-broke stretch, by what (won deals / lost deals):');
for (const [what, row] of [...table].sort((a, b) => b[1].credits - a[1].credits)) console.log(`  ${what}: ${row.won} / ${row.lost}`);
