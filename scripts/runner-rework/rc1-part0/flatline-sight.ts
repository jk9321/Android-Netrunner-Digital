/**
 * R-C1 Part 0, R-34: the Runner's flatlines on its own turn, inside a run, split into the damage the run's price could
 * see when the run began and the damage it could not (plan.md 18:56Z, b0/count-note.md: "21 of 32 flatlines happen on
 * the Runner's own turn, inside a run"; the pre-count owed before any fix).
 *
 * Replays each flatline deal of a batch's .deals.json as corp-losses.ts seeds it (Normal v Normal, the deal's decks; a
 * plain GameRunner, never asked: `RULE-SCRIPT-RULES`) and checks the replay is the batch's game (the Corp's credits at
 * each turn start, `cr`, equal). For the run the Runner flatlined in, every card the Runner lost from its grip during
 * the run is put to one source, and each source to one class, by what the Runner could see when it initiated the run:
 *   seenIce     ice rezzed at the run's start (its subroutines are in the run's price: runs.ts icePrice)
 *   unseenIce   ice unrezzed at the run's start, rezzed during the run (the price has only a guess of it)
 *   seenCard    an accessed card the Runner knew at the run's start (rezzed, faceup or marked known: rule 10.2.2a)
 *   unseenCard  an accessed card the Runner did not know (a facedown root card, a card of HQ or R&D)
 *   other       anything else in the run (a Corp card's trigger on the run, the Runner's own card)
 * The flatline's class is the class of the step that did the last damage. Rules: 10.4.4 (flatline: more damage than
 * cards in the grip), 6.9.2b (rez on approach), 7.2.1 (access).
 *
 *   npx vite-node scripts/runner-rework/rc1-part0/flatline-sight.ts -- <deals.json> <out.jsonl> [shard i/n]
 *   (NRDB pool: NRDB=1 adds scripts/nrdb-test-decks.ts, as corp-losses.ts does)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync } from 'node:fs';
import { GameState, cardDef, createInitialGameState, findCardAnywhere } from '../../../src/core';
import { deckGameSetup } from '../../../src/data/decks';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';
import { createAgent } from '../../../src/ai';
import { GameRunner } from '../../../src/ai/playout';
import { valueLoops } from '../../../src/ai/valueModel';

type Klass = 'seenIce' | 'unseenIce' | 'seenCard' | 'unseenCard' | 'other';
const [dealsFile, out, shardArg] = process.argv.slice(2).filter(a => a !== '--');
const [shard, shards] = (shardArg ?? '0/1').split('/').map(Number);
const raw = JSON.parse(readFileSync(dealsFile, 'utf8'));
const deals: any[] = (Array.isArray(raw) ? raw : raw.deals).filter((d: any) => d.flatCause);
const POOL: any[] = [...ALL_DECKS, ...(process.env.NRDB ? NRDB_TEST_DECKS : [])]; // as corp-losses.ts DECKS
const rows: string[] = [];

/** Every Corp card the Runner can see on this board: installed and rezzed, faceup, or marked known to the Runner. */
function seenIds(s: GameState): Set<string> {
  const ids = new Set<string>();
  for (const sv of Object.values(s.corp.servers)) for (const c of [...sv.ice, ...sv.root]) if (c.isRezzed || c.faceUp || c.runnerKnows) ids.add(c.instanceId);
  for (const c of [...s.corp.hq, ...s.corp.rd]) if (c.runnerKnows) ids.add(c.instanceId);
  for (const c of s.corp.archives.faceUp) ids.add(c.instanceId);
  return ids;
}

deals.forEach((d, i) => {
  if (i % shards !== shard) return;
  const c = POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) {
    rows.push(JSON.stringify({ seed: d.seed, error: `deck not found: ${d.corpDeck} / ${d.runnerDeck}` }));
    return;
  }
  valueLoops.clear();
  const gr = new GameRunner(createInitialGameState(deckGameSetup(d.seed, c, r)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  // The Corp's credits at each of its turn starts, as lossLog.ts records `cr` (the first from the board before turn 1)
  const cr: number[] = [gr.state.corp.credits];
  let run: { server: string; turn: number; seen: Set<string>; grip: number; lost: Record<Klass, number>; sources: string[] } | null = null;
  let flat: any = null;
  for (let k = 0; k < 6000 && !gr.state.winner && gr.state.turnNumber <= 80; k++) {
    const before: GameState = gr.state;
    if (!gr.step()) break;
    const after = gr.state;
    if (before.activePlayer === 'runner' && after.activePlayer === 'corp') cr.push(after.corp.credits);
    if (!before.activeRun && after.activeRun && after.activePlayer === 'runner')
      run = { server: after.activeRun.server, turn: after.turnNumber, seen: seenIds(before), grip: before.runner.grip.length, lost: { seenIce: 0, unseenIce: 0, seenCard: 0, unseenCard: 0, other: 0 }, sources: [] };
    let klass: Klass | null = null;
    let source = '';
    const flatlined = after.winner === 'corp' && /flatline/i.test(after.winReason ?? '');
    // A step that took cards, or the step that flatlined (on an empty grip it takes none: 10.4.4)
    if (run && before.activeRun && (after.runner.grip.length < before.runner.grip.length || flatlined)) {
      const enc = before.activeRun.encounter;
      const ice = enc ? findCardAnywhere(before, enc.iceId) : undefined;
      // The card accessed in this step, from the step's own log (the damage of an access resolves in the step that
      // accesses it, before the run's accessed list is read), else the last card the run accessed in an earlier step
      const newLog = after.log.slice(before.log.length);
      const accessLine = [...newLog].reverse().find(l => l.event === 'access' && l.cardCode);
      const last = before.activeRun.accessed[before.activeRun.accessed.length - 1];
      const lastCard = !enc && last ? findCardAnywhere(before, last.id) : undefined;
      if (ice) {
        klass = run.seen.has(ice.instanceId) ? 'seenIce' : 'unseenIce';
        source = cardDef(ice).title;
      } else if (accessLine) {
        // The log names the card, not the instance: the instance is the card of that code in the run's server root, else
        // in HQ or R&D (the access of a card in the hand or the deck); seen as above (seenIds at the run's start)
        const sv = before.corp.servers[run.server];
        const pool = [...(sv?.root ?? []), ...(run.server === 'hq' ? before.corp.hq : run.server === 'rd' ? before.corp.rd : [])];
        const hit = pool.find(card => card.cardCode === accessLine.cardCode);
        const seenCode = !!hit && run.seen.has(hit.instanceId);
        klass = seenCode ? 'seenCard' : 'unseenCard';
        source = accessLine.message.replace(/^Runner accessed /, '').replace(/\.$/, '');
      } else if (lastCard && (before.activeRun.phase === 'access' || before.activeRun.breached)) {
        klass = run.seen.has(lastCard.instanceId) ? 'seenCard' : 'unseenCard';
        source = cardDef(lastCard).title;
      } else {
        klass = 'other';
        source = newLog.map(l => l.message).join(' / ') || after.log.slice(-2).map(l => l.message).join(' / ');
      }
      const n = before.runner.grip.length - after.runner.grip.length;
      run.lost[klass] += n;
      run.sources.push(`${klass}:${source}:${n}`);
    }
    if (flatlined) {
      const ownRun = !!before.activeRun && before.activePlayer === 'runner';
      flat = {
        ownRun,
        turn: after.turnNumber,
        ...(ownRun && run ? { server: run.server, gripAtRun: run.grip, lost: run.lost, last: klass, lastSource: source, sources: run.sources } : { side: before.activePlayer }),
      };
    }
    if (before.activeRun && !after.activeRun) run = null;
  }
  const same = Array.isArray(d.cr) ? JSON.stringify(cr.slice(0, d.cr.length)) === JSON.stringify(d.cr) : null;
  rows.push(JSON.stringify({ seed: d.seed, corp: d.corpDeck, runner: d.runnerDeck, batchCause: d.flatCause, replayed: same, ...(same === false ? { cr, batchCr: d.cr } : {}), winner: gr.state.winner ?? null, flat }));
  console.error(`${d.seed} ${gr.state.winner} ${flat?.ownRun ? `own run, last ${flat.last}` : flat ? 'not in an own run' : 'no flatline'}${same === false ? ' (REPLAY DIFFERS)' : ''}`);
});
writeFileSync(out, rows.join('\n') + '\n');
