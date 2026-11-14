import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { holdCost } from '../src/ai/corp/hold';
import { countedRez } from '../src/ai/rezModel';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

/**
 * Holes from Jeff's games #48-#50 (redesign/spec-jeff-games-48-50.md; playtests/jeff-games-48-50.md). Fixtures are the
 * state before the move, written by scripts/fixture-at.ts from tests/fixtures/human-games/report-N.json.
 */
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));

describe('Part A: an installed bypass card is Runner capability (folded plan.bypassHold)', () => {
  // #48 #76, turn 7, Corp 1 credit: remote-1 has a lone rezzed Ping; Malandragem is installed with power counters
  // (bypass ice of strength 3 or less for a counter, runs.ts runBypasses; 6.5.8a: its subroutines never resolve)
  it('#48 #76: lone Ping does not hold remote-1 against an installed Malandragem', () => {
    const s = read('holes-48-76.json');
    const ice = s.corp.servers['remote-1'].ice;
    // Before Part A holdCost read 0 here (the Ping "held")
    expect(inCorp(s, () => holdCost(s, ice, s.corp.credits))).toBeNull();
    // Without the Malandragem in the rig the same Ping holds again
    const bare = structuredClone(s);
    bare.runner.rig.programs = bare.runner.rig.programs.filter(c => c.cardCode !== '34081');
    expect(inCorp(bare, () => holdCost(bare, bare.corp.servers['remote-1'].ice, bare.corp.credits))).toBe(0);
  });

  // #48 #60, turn 6: Malandragem, S-Dobrado and Laser Pointer are in the grip, nothing installed. The Corp cannot see the
  // grip's contents (its size is public): the verdict is the same with those three swapped for another card.
  it('#48 #60: unseen grip contents do not change the verdict (hidden information)', () => {
    const s = read('holes-48-60.json');
    const empty = structuredClone(s);
    empty.runner.grip = empty.runner.grip.map(c => (['34012', '34016', '34081'].includes(c.cardCode) ? { ...c, cardCode: '30030' } : c));
    for (const v of Object.values(s.corp.servers).filter(x => x.ice.length > 0)) {
      const a = inCorp(s, () => holdCost(s, v.ice, s.corp.credits));
      const b = inCorp(empty, () => holdCost(empty, empty.corp.servers[v.id].ice, empty.corp.credits));
      expect(a, v.id).toBe(b);
    }
  });

  // #48 #118, turn 9: the Runner's S-Dobrado run on R&D (bypass the first ice encountered), Doomscroll outermost and
  // unrezzed, Corp 4 credits. Rezzed, Doomscroll is that first encounter and is bypassed: the 3 credits buy nothing.
  it('#48 #118: no rez of the ice the declared S-Dobrado run bypasses', () => {
    const s = read('holes-48-118.json');
    const ice = s.corp.servers.rd.ice.find(c => c.instanceId === 'inst-41')!;
    // Before Part A countedRez read null here (no counted rule) and the value model rezzed it
    expect(inCorp(s, () => countedRez(s, ice))).toBe('pass');
  });
});
