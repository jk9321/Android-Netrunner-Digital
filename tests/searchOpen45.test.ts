import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef } from '../src/core';

/**
 * Open human-game case #45 (Jeff's Runner game vs the beta Normal Corp, seed 999463420): Send a Message (3 points,
 * advancement 5) sat in remote-1 behind Pharos and Flyswatter and was not scored. Corp T8 and T9 both start with 3
 * counters, 1 credit and 3 clicks: a click for a credit and two advances score it. The AI iced R&D at T8; at T9 it iced
 * Archives, advanced once and took a credit, and the Runner stole it for the win. The fixes thread traced it to the 2-sample reply: both samples
 * ran the other remote. Phase 3 S3 (plan.searchSamples, parked OFF) must be tested against these positions when it is
 * re-measured after plan.corpTurnDamageOwn lands on beta. Pinned only: no pick assertion yet.
 */
const load = (t: number): GameState => JSON.parse(readFileSync(new URL(`./fixtures/search-open-45-t${t}.json`, import.meta.url), 'utf8'));

describe('#45 Send a Message left unscored (open, S3 re-measure)', () => {
  it.each([
    [8, 3],
    [9, 3],
  ])('Corp T%i: Send a Message in remote-1 with %i counters, 1 credit, 3 clicks', (t, counters) => {
    const s = load(t);
    expect(s.turnNumber).toBe(t);
    expect([s.activePlayer, s.corp.clicks, s.corp.credits]).toEqual(['corp', 3, 1]);
    const agenda = s.corp.servers['remote-1'].root[0];
    expect(cardDef(agenda).title).toBe('Send a Message');
    expect(agenda.advancementCounters).toBe(counters);
  });
  it.todo('S3 re-measure: the Corp scores Send a Message at T8 or T9');
});
