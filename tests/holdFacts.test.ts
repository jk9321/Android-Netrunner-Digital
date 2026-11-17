/**
 * Stage D item 1 (brief rev 2, 4.4): the hold walk's card facts, from each card's text, and kept out of the Runner's
 * run prices (no gainsOnEncounter on these cards: plannedSubroutines, which icePrice reads, would pick a gain up).
 */
import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/ai/cards';

describe('holdFacts card entries', () => {
  it('turn start (5.7.1): Botulus and Tranquilizer counters, Tranquilizer derezzes at 3', () => {
    expect(CARDS['30004'].holdFacts).toEqual({ runnerTurnStart: { counters: { kind: 'virus', n: 1 } } });
    expect(CARDS['30017'].holdFacts).toEqual({ runnerTurnStart: { counters: { kind: 'virus', n: 1 }, derezHostAt: 3 } });
  });
  it('turn end: Lycian Multi-Munition derezzes itself', () => {
    expect(CARDS['34100'].holdFacts).toEqual({ turnEndDerezSelf: true });
  });
  it('rezzed during a run: Flyswatter purges, Ping tags, Bumi 1.0 may trash a trojan, Thunderbolt Armaments adds a subroutine (9.8.3e)', () => {
    expect(CARDS['35079'].holdFacts?.rezDuringRun).toEqual({ purgeVirus: true });
    expect(CARDS['30055'].holdFacts?.rezDuringRun).toEqual({ tags: 1 });
    expect(CARDS['35041'].holdFacts?.rezDuringRun).toEqual({ corpMayTrashInstalled: 'trojan' });
    expect(CARDS['34096'].holdFacts?.rezDuringRun?.anyIce).toEqual({ subtypes: ['ap', 'destroyer'], strength: 1, gains: 'End the run unless the Runner trashes 1 of their installed cards.' });
  });
  it('encounter (6.9.3a): Paywall, Funhouse, Jaguarundi at threat 4, Seraph', () => {
    expect(CARDS['36052'].holdFacts?.encounter).toEqual({ loses: 1 });
    expect(CARDS['30054'].holdFacts?.encounter).toEqual({ toll: { endRun: true }, unless: { tags: 1 } });
    expect(CARDS['34035'].holdFacts?.encounter).toEqual({ threatAtLeast: 4, toll: { tags: 1 }, unless: { clicks: 1 } });
    expect(CARDS['34118'].holdFacts?.encounter).toEqual({ toll: { loses: 3 }, unless: { netDamage: 2, tags: 1 } });
  });
  it('none of them reaches the run prices through gainsOnEncounter', () => {
    for (const code of ['30004', '30017', '34100', '35079', '30055', '35041', '34096', '36052', '30054', '34035', '34118']) expect(CARDS[code].gainsOnEncounter).toBeUndefined();
  });
});
