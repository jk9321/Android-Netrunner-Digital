import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * R-14h (brief runner-rework/briefs/r14h-last-credits-fix.md rev 2, second pass C): every read of the deck's average card
 * declares when the card is played, and the class is the one ruled at step 0.1 (runner-rework/r14h-fix/step0-1-classes.md):
 * 'later' for a card that arrives on a later turn (next turn's money), 'now' for a card in the hand on the board priced or
 * lost from it now (today's credits). A call given the wrong class fails here, before any game shows it. A new call (or a
 * call moved within its file) needs its row here, in file order.
 */
const RULED: Record<string, [when: 'now' | 'later', reader: string][]> = {
  'cardPlans.ts': [
    ['now', 'Sell Out: 2 cards with the play (#24)'],
    ['now', 'principiaFuel: Knickknack fuel (#23)'],
  ],
  'cardProfiles.ts': [['later', 'unrezzedWorth: a Corp payout card still to rez, its draws (#33)']],
  'cards/elevation.ts': [
    ['later', 'Side Hustle credit counter: the card at 6 (#5)'],
    ['later', 'AU Co. power counters (#34)'],
    ['later', 'Embedded Reporting: the next draw (#35)'],
    ['later', 'Off the Books (#36)'],
    ['later', 'Next Big Thing (#37)'],
    ['now', 'Cacophony: cards the Corp loses (#30)'],
    ['later', 'Gourmand: a card on a later access (#6)'],
    ['later', 'Knickknack: spent installs (#2)'],
    ['later', 'Knickknack: the Principia loop (#3)'],
    ['later', 'Side Hustle: a card once it holds 6 (#4)'],
  ],
  'cards/liberation.ts': [
    ['later', 'Solidarity Badge power counter, tagged (#7)'],
    ['later', 'Solidarity Badge power counter (#7)'],
    ['later', 'Lago Paranoá Shelter (#8)'],
    ['now', 'Joy Ride: cards at the run’s end (#25)'],
    ['later', 'LilyPAD (#9)'],
    ['now', 'Daniela Jorge Inácio: 2 cards from the grip (#29)'],
    ['later', 'Epiphany Analytica power counter (#38)'],
    ['later', 'Amanuensis power counter (#10)'],
    ['later', 'The Basalt Spire agenda counter (#39)'],
  ],
  'cards/systemGateway.ts': [
    ['now', 'Carnivore: 2 cards from the grip (#26)'],
    ['now', 'T400 Memory Diamond: a hand slot (#27)'],
    ['later', 'Verbal Plasticity (#1)'],
    ['later', 'Spin Doctor spent, by the odds (#40)'],
    ['later', 'Spin Doctor spent, a known card (#41)'],
    ['later', 'Spin Doctor spent, the Runner’s view (#42)'],
  ],
  'cards/vantagePoint.ts': [
    ['now', 'Hackerspace: hand size (#28)'],
    ['later', 'Nurse Hạnh (#11)'],
    ['later', 'Underdome Irregulars (#12)'],
    ['later', 'Read-Write Share (#13)'],
    ['later', 'Word on the Street (#14)'],
  ],
  'effectValues.ts': [
    ['now', 'damageWorth: a card lost to damage (#20)'],
    ['now', 'coreSlotWorth: a hand slot lost (#21)'],
    ['now', "corpEffect's ctx.card (#31; R-14p splits it)"],
  ],
  'evaluate.ts': [
    ['later', "addRigCard: an installed payout card's draws (#15)"],
    ['later', "corpCardWorth: a rezzed Corp payout card's draws (#32)"],
  ],
  'handValues.ts': [
    ['now', "playedWorth: an event's or operation's floor, a held card (#17)"],
    ['later', "playedWorth: a rig card's payout draws (#16)"],
    ['now', "ownHandValue: an unseen card in hand, cardRate (#18)"],
    ['now', "ownHandValue: an unseen card in hand, the other side's deck (#18)"],
    ['now', "clickWorth: the repeatable draw, cardRate (#19)"],
    ['now', "clickWorth: the repeatable draw, the other side's deck (#19)"],
  ],
  'prompts.ts': [['now', "Knickknack's trash pick: a card back now (#22)"]],
};

const AI = join(import.meta.dirname, '..', 'src', 'ai');
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f)] : []));

describe('the class of every read of the deck average card (R-14h step 0.1)', () => {
  it('every cardRate call, and every direct drawWorth call, has its ruled class, in file order', () => {
    const found: Record<string, string[]> = {};
    for (const path of files(AI)) {
      const name = relative(AI, path).replace(/\\/g, '/');
      const text = readFileSync(path, 'utf8');
      // a call's literal when: cardRate(state, side, 'now') or drawWorth(state, side, 'later'), not the definitions
      const calls = [...text.matchAll(/\b(cardRate|drawWorth)\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)].filter(m => !/:\s*(GameState|DrawWhen)/.test(m[2]));
      if (!calls.length) continue;
      found[name] = calls.map(m => {
        const when = m[2].match(/,\s*'(now|later)'\s*$/);
        return when ? when[1] : `no literal when: ${m[0]}`;
      });
    }
    // valueModel.ts holds the definition and the deck card hook only; handValues' registration passes `when` through
    delete found['valueModel.ts'];
    const hook = found['handValues.ts']?.findIndex(w => w.includes('drawWorth(state, side, when)'));
    if (hook !== undefined && hook >= 0) found['handValues.ts'].splice(hook, 1);
    const want = Object.fromEntries(Object.entries(RULED).map(([f, rows]) => [f, rows.map(r => r[0])]));
    expect(found).toEqual(want);
  });
});
