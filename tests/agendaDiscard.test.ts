import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardInstance, GameAction, GameState, activePrompt, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { clearHandCaches } from '../src/ai/handValues';
import { clearDamageThreats } from '../src/ai/effectValues';

/**
 * Stage D item 7 (D6, the class of report-53 #112): at the Corp's discard step no agenda is discarded while a non-agenda
 * stays in HQ. Count and ruling: /mnt/project-files/netrunner-ai/stage-d/item7-agenda-discard/ (count-note.md,
 * design-answer.md; branch ai-discard-count). Rules (Comprehensive Rules v26.03): the Corp discards down to its maximum
 * hand size in its discard step (5.6.3a); cards discarded from HQ go to Archives facedown (5.5.2a); a breach of Archives
 * turns its facedown cards faceup first (7.3.2) and every card in Archives is a candidate (7.4.1d); the Runner cannot
 * decline to steal an agenda it accesses (1.17.3d). So a discarded agenda is open to the next Archives run.
 *
 * Boards: every recorded Corp discard prompt with an agenda and a non-agenda in HQ in the human games (both kinds: the AI
 * Corp's own prompts and the person's, each answered by today's Normal Corp; one replay a report), and the 15 self-play
 * boards of the g1 base where the keep sort ranks a non-agenda above an agenda (tests/fixtures/agenda-discard, written by
 * scripts/stage-d/agenda-discard-fixtures.ts). On a board where the Corp can bring an Archives card back
 * before the Runner's next turn (archivesReturn below; counted) an agenda may be discarded while a non-agenda is kept,
 * but only if it is back out of Archives when the Corp's turn ends (played on by GameRunner). report-53 #112 is such a
 * board (a rezzed Spin Doctor): the recorded answer discarded Oracle Thinktank and left it there, and it was stolen.
 */
const T = 60_000;
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';

/**
 * The Corp can bring an Archives card back before the Runner's next turn (the count's right exception 1, narrowed to the
 * returns that come in time): a rezzed Spin Doctor, whose paid ability works in the paid ability window after the
 * discard step (5.6.3b; an unrezzed card is inactive, 8.5.2), or Project Ingatan in the Corp's score area with a hosted
 * agenda counter, whose install from Archives comes when the discard phase ends (5.6.3d). Haas-Bioroid: Precision Design
 * and Longevity Serum return a card only when the Corp scores, at the earliest on its next turn: the discarded agenda
 * faces the Runner's turn in Archives first, so they are not exempt.
 */
function archivesReturn(s: GameState): boolean {
  const installed = Object.values(s.corp.servers).flatMap(v => v.root);
  if (installed.some(c => c.isRezzed && cardDef(c).title === 'Spin Doctor')) return true;
  return s.corp.scoreArea.some(c => cardDef(c).title === 'Project Ingatan' && (c.tokens?.agenda ?? 0) > 0);
}

interface Tally {
  boards: number;
  /** Boards with an Archives return in play (checked by the return rule). */
  exempt: number;
  failures: string[];
}

/** The class check at one discard board (clones are asked and played; the state itself is never touched). */
function check(s: GameState, name: string, tally: Tally) {
  const hq = s.corp.hq;
  if (!hq.some(isAgenda) || hq.every(isAgenda)) return;
  tally.boards++;
  const canReturn = archivesReturn(s);
  if (canReturn) tally.exempt++;
  clearHandCaches();
  clearDamageThreats();
  const a = createAgent('corp', 'normal').chooseAction(structuredClone(s)) as GameAction & { choice?: { kind: string; cardInstanceIds?: string[] } };
  const thrown = new Set(a.choice?.kind === 'discard' ? (a.choice.cardInstanceIds ?? []) : []);
  const agendaThrown = hq.filter(c => thrown.has(c.instanceId) && isAgenda(c));
  const nonKept = hq.filter(c => !thrown.has(c.instanceId) && !isAgenda(c));
  if (a.choice?.kind !== 'discard') tally.failures.push(`${name}: not a discard answer`);
  else if (agendaThrown.length && nonKept.length && canReturn) {
    // The right exception holds only if the agenda does come back: the Corp's own Normal agent plays the rest of its turn
    // (both sides' Normal agents answer, GameRunner), and every discarded agenda must have left Archives before the turn ends
    let after = executeAction(structuredClone(s), a);
    const g = new GameRunner(after, { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    for (let k = 0; k < 40 && g.state.activePlayer === 'corp' && g.state.turnNumber === s.turnNumber && g.step(); k++);
    after = g.state;
    const archived = new Set([...after.corp.archives.faceDown, ...after.corp.archives.faceUp].map(c => c.instanceId));
    const stayed = agendaThrown.filter(c => archived.has(c.instanceId));
    if (stayed.length) tally.failures.push(`${name} T${s.turnNumber}: discards ${stayed.map(c => cardDef(c).title).join(', ')} with an Archives return in play and leaves it in Archives, keeps ${nonKept.map(c => cardDef(c).title).join(', ')}`);
  } else if (agendaThrown.length && nonKept.length) tally.failures.push(`${name} T${s.turnNumber}: discards ${agendaThrown.map(c => cardDef(c).title).join(', ')}, keeps ${nonKept.map(c => cardDef(c).title).join(', ')}`);
}

/**
 * The human games present when the count was made (2026-11-19), named so a playtest game added later to
 * tests/fixtures/human-games does not change this test's counts (the exact counts catch a replay that stops early).
 */
const HUMAN_FILES = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 32, 33, 34, 35, 36, 37, 38, 39, 40, '40b', '40c', 41, 42, 43, 44, 45, 47, 48, 49, 50, 51, 52, 53, 54, 56].map(n => `report-${n}.json`);

const corpDiscard = (s: GameState) => {
  const p = activePrompt(s);
  return p?.kind === 'discard' && p.side === 'corp';
};

describe('Stage D item 7: no agenda discarded while a non-agenda is kept', () => {
  it('the human games: every mixed Corp discard board', { timeout: T }, () => {
    const dir = new URL('./fixtures/human-games/', import.meta.url);
    const tally: Tally = { boards: 0, exempt: 0, failures: [] };
    for (const f of HUMAN_FILES) {
      const r = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      if (!r.moves?.length) continue;
      let s: GameState = r.startsAt === 'state' ? structuredClone(r.state) : createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
      if (r.startsAt !== 'state' && r.startStops) s = { ...s, stops: r.startStops };
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        if (corpDiscard(s)) check(s, `${f} #${j}`, tally);
        try {
          s = executeAction(s, move);
        } catch {
          break; // a fixture recorded on an older engine stops here (report-24 at move 286, a Runner discard)
        }
      }
    }
    expect(tally.failures).toEqual([]);
    // The count's 27 human-Runner and 11 human-Corp mixed boards; 22 with an Archives return in play
    expect(tally.boards).toBe(38);
    expect(tally.exempt).toBe(EXEMPT_HUMAN);
  });

  it('the self-play boards where a non-agenda is priced above an agenda', { timeout: T }, () => {
    const dir = new URL('./fixtures/agenda-discard/', import.meta.url);
    const tally: Tally = { boards: 0, exempt: 0, failures: [] };
    for (const f of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
      const s: GameState = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      expect(corpDiscard(s)).toBe(true);
      check(s, f, tally);
    }
    expect(tally.failures).toEqual([]);
    expect(tally.boards).toBe(15);
    expect(tally.exempt).toBe(EXEMPT_SELF);
  });
});

const EXEMPT_HUMAN = 22;
const EXEMPT_SELF = 3;
