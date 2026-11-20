/**
 * Stage D item 1 follow-up 4, step 1.2 (brief section 2.2): the inventory, over every Runner card in the game (the four
 * sets' card data, src/data/*-cards.json), of what the Runner can do that the hold count (src/ai/corp/hold.ts) does not
 * read: credits or a cheaper run by a route the count misses, a change to the ice met, and the Corp cards that change
 * which ice is rezzed at the Runner's turn.
 *
 * The table below is read from each card's text (`stripped_text`) and checked against what the count reads today:
 * `turnIncome` and `clickMoney` (runnerEarnings), `holdFacts` (the walk), the engine's `paysDuringRuns` and stealth
 * credits (runCredits), the breakers' break and boost costs at the board's state (runs.ts breakPlans, the engine's
 * breakCost), and runBypasses (Malandragem, Laser Pointer, Curupira, Fransofia Ward). The script prints it grouped by
 * route with counts, and a cross-check: every Runner card whose text matches a money, cost, click, bypass, strength or
 * derez pattern and is in neither the table nor the list of cards read already or irrelevant (the run fails the check
 * loudly, so a new set cannot slip past).
 *
 *   npx vite-node scripts/stage-d/runner-money-inventory.ts > inventory.md
 */
import { readFileSync, readdirSync } from 'node:fs';
import { CARDS } from '../../src/ai/cards';
import { getCardScript } from '../../src/core';

type Info = 'open' | 'hidden' | 'open (identity)';
interface Row {
  /** The route by which it gives money, cheapens a run or changes the ice met. */
  route: string;
  info: Info;
  /** What the count misses, and which reader. */
  missing: string;
  /** Which way leaving it out errs. */
  errs: 'holds' | 'does not hold' | 'none (not a hold question)';
  /** The step-1 arm that counts it, if any. */
  arm?: string;
}

const R1 = 'R1 a run begins (6.9.1c)';
const R2 = 'R2 a counter or hosted credits spent without a click';
const R3 = 'R3 its host ice rezzed or derezzed';
const R4 = 'R4 a successful run (6.9.5a): later runs only';
const R5 = 'R5 a click gained';
const R6 = 'R6 an event from the grip (F2)';
const R7 = 'R7 a cheaper break by a condition the walk does not carry';
const I1 = 'I1 a Runner ability that changes the ice met (row 55)';
const I2 = 'I2 a route into a server through another server\'s ice';
const C1 = 'C1 a Corp card that changes which ice is rezzed at the Runner\'s turn (row 54)';

const TABLE: Record<string, Row> = {
  // R1
  '35034': { route: R1, info: 'open', missing: 'hosted credits grow by 1 a run, all taken at 6: walk state at the run\'s start (no fact, no reader)', errs: 'holds', arm: 'runBegin' },
  '35033': { route: R1, info: 'open', missing: 'first run each turn: trash another installed card for its printed install cost: a choice at the run\'s start (no fact, no reader)', errs: 'holds', arm: 'runBegin' },
  '36020': { route: R1, info: 'hidden', missing: 'a hardware trashed from the grip places 2 (its hosted credits are read as stealth credits)', errs: 'holds' },
  // R2
  '34089': { route: R2, info: 'open', missing: '2 credits a power counter, no click, the Runner\'s turn only: runnerEarnings reads only turnIncome and clickMoney', errs: 'holds', arm: 'counter' },
  '34019': { route: R2, info: 'open', missing: 'hosted credits spendable on its own click-run only: the walk models no run ability', errs: 'holds' },
  // R3
  '34017': { route: R3, info: 'open', missing: '3 credits when its host is rezzed (the walk\'s rez of a set ice) or derezzed', errs: 'holds', arm: 'saci' },
  // R4
  '36024': { route: R4, info: 'open', missing: '2 credits on a successful run on its server: a second run (entries, run sequence)', errs: 'holds' },
  '30014': { route: R4, info: 'open', missing: '1 credit placed on each successful run, before its click ability (clickMoney reads the credits hosted now)', errs: 'holds' },
  '30018': { route: R4, info: 'open', missing: 'click: run a central, 3 credits if successful: a free click-run and money for a later run', errs: 'holds' },
  '35023': { route: R4, info: 'open (identity)', missing: 'Dewi: 1 credit on a successful run with full memory', errs: 'holds' },
  '35001': { route: R4, info: 'open (identity)', missing: 'Ryō: 1 credit on the first successful run after a subroutine resolved', errs: 'holds' },
  '30010': { route: R4, info: 'open (identity)', missing: 'Zahya: 1 credit per card accessed when an HQ or R&D run ends', errs: 'holds' },
  '30001': { route: R4, info: 'open (identity)', missing: 'René: 1 credit the first time it trashes an accessed card', errs: 'holds' },
  '30023': { route: R4, info: 'open', missing: 'Pantograph: 1 credit and an install from the grip when an agenda is stolen', errs: 'holds' },
  '36025': { route: R4, info: 'open', missing: 'Word on the Street: 4 credits when the Corp scores an older agenda', errs: 'none (not a hold question)' },
  // R5
  '34084': { route: R5, info: 'open', missing: 'a click the first time each turn it takes an action on an installed resource: the walk\'s clicks are maxClicks', errs: 'holds' },
  '34008': { route: R5, info: 'open', missing: 'once a turn a click and a run on a remote; click, trash: 2 clicks (net 1)', errs: 'holds' },
  '34025': { route: R5, info: 'open', missing: 'a click when it passes its host ice (once a turn, then back to the grip)', errs: 'holds' },
  // R6 (grip events: F2)
  '30030': { route: R6, info: 'hidden', missing: 'Sure Gamble: 9 for 5 (3 over a click for a credit)', errs: 'holds', arm: 'f2max/f2odds' },
  '30020': { route: R6, info: 'hidden', missing: 'Creative Commission: 5 for 1, a click lost (2 over)', errs: 'holds', arm: 'f2max/f2odds' },
  '34001': { route: R6, info: 'hidden', missing: 'Strike Fund: 4 for 1 (2 over)', errs: 'holds', arm: 'f2max/f2odds' },
  '30029': { route: R6, info: 'hidden', missing: 'Overclock: 5 for its run, cost 1 (4 over the run\'s click)', errs: 'holds', arm: 'f2max/f2odds' },
  '34087': { route: R6, info: 'hidden', missing: 'Trick Shot: 4 for its R&D run, cost 1 (3 over; the arms count it on every server)', errs: 'holds', arm: 'f2max/f2odds' },
  '36011': { route: R6, info: 'hidden', missing: 'Sell Out: 4 for 1 and an installed resource (2 over)', errs: 'holds', arm: 'f2max/f2odds' },
  '36018': { route: R6, info: 'hidden', missing: 'Aircheck: 4 hosted for 1, the pool locked during the run (HQ or R&D): not a plain addend; left at 0', errs: 'holds' },
  '30002': { route: R6, info: 'hidden', missing: 'Wildcat Strike: 6 credits or 4 cards, the Corp\'s choice (ruling 6: the cards): 0', errs: 'none (not a hold question)' },
  '34076': { route: R6, info: 'hidden', missing: 'Meeting of Minds: 1 credit per card revealed, for 4: depends on the grip; left at 0', errs: 'holds' },
  '35014': { route: R6, info: 'hidden', missing: 'Clean Getaway: 6 after a successful run (a later run only)', errs: 'holds' },
  '35017': { route: R6, info: 'hidden', missing: 'Transfer of Wealth: credits after a successful HQ run (a later run only)', errs: 'holds' },
  '34030': { route: R6, info: 'hidden', missing: 'Bahia Bands: 4 hosted after a successful run (a later run only)', errs: 'holds' },
  '30012': { route: R6, info: 'hidden', missing: 'Tread Lightly: every rez costs the Corp 3 more on its run', errs: 'holds' },
  '34077': { route: R6, info: 'hidden', missing: 'Window of Opportunity: derezzes 1 ice as its run begins', errs: 'holds' },
  '34012': { route: R6, info: 'hidden', missing: 'S-Dobrado: bypasses the first ice on a central (runBypasses reads it only on its own run)', errs: 'holds' },
  '35005': { route: R6, info: 'hidden', missing: 'Shred: the first end-the-run prevented unless the Corp trashes X from HQ', errs: 'holds' },
  '34086': { route: R6, info: 'hidden', missing: 'Spree: moves installed trojans onto the attacked server\'s ice', errs: 'holds' },
  '36019': { route: R6, info: 'hidden', missing: 'Beta Build: a program from the stack installed free for its run', errs: 'holds' },
  // R7
  '30016': { route: R7, info: 'open', missing: 'Marjanah: breaks 1 less after a successful run this turn (read at the board\'s state, not after a run of the walk)', errs: 'holds' },
  '34071': { route: R7, info: 'open', missing: 'Boi-tatá: 1 less once an installed card was trashed this turn (Knickknack, Side Hustle, a Corp trash in the walk)', errs: 'holds' },
  '35020': { route: R7, info: 'open', missing: 'Sang Kancil: 2 less with a run event active (the event is from the grip)', errs: 'holds' },
  '36003': { route: R7, info: 'open', missing: 'The Tungsten Tailor: 1 credit on the first break of a 0-strength ice (its -1 strength is read)', errs: 'holds' },
  '30008': { route: R7, info: 'open', missing: 'Leech: a virus counter gives the encountered ice -1 strength: breakPlans does not spend Leech counters', errs: 'holds' },
  // I1
  '34073': { route: I1, info: 'open', missing: 'Arruaceiras Crew: a tag for -2 strength once a turn; trash it and 2 credits to trash ice at 0 or less: the walk does not read it', errs: 'holds', arm: 'arru' },
  '34013': { route: I1, info: 'open', missing: 'Capybara: a bypassed ice derezzed (removed from the game): a later run meets it unrezzed', errs: 'holds' },
  '34022': { route: I1, info: 'open', missing: 'AirbladeX: a counter prevents a "when encountered" ability (Funhouse\'s, Seraph\'s toll)', errs: 'holds' },
  '34078': { route: I1, info: 'open', missing: 'Alarm Clock: a turn-start HQ run, the first ice bypassed for 2 clicks (runBypasses reads it only during its own run)', errs: 'holds' },
  '36023': { route: I1, info: 'open', missing: 'Sipa: swaps a fully broken outermost ice after it is passed: a later run meets other ice', errs: 'holds' },
  '35019': { route: I1, info: 'open', missing: 'Maglectric Rapid: derezzes a Corp card after a successful HQ run: a later run', errs: 'holds' },
  // I2
  '34007': { route: I2, info: 'open', missing: 'Eru Ayase-Pessoa: R&D breached through Archives\' ice (click, a tag)', errs: 'holds' },
  '34028': { route: I2, info: 'open', missing: 'Beatriz Friere Gonzalez: R&D breached through HQ\'s ice (2 clicks)', errs: 'holds' },
  '36015': { route: I2, info: 'open', missing: 'Baker: HQ or R&D through Archives\' ice, 1 stealth credit', errs: 'holds' },
  '34088': { route: I2, info: 'open', missing: 'Cataloguer: click and a counter breach R&D again after a successful R&D run (a second access without the ice)', errs: 'holds' },
  '35016': { route: I2, info: 'hidden', missing: 'Maintenance Access: HQ through Archives\' ice (an event)', errs: 'holds' },
};

/** Runner cards whose money, cost or ice effect the count reads today, or that are not about getting in. */
export const READ_OR_IRRELEVANT: Record<string, string> = {
  '30007': 'Fermenter: clickMoney', '35011': 'Rent Rioters: clickMoney', '30027': 'Telework Contract: clickMoney', '30033': 'Smartware Distributor: turnIncome (its turn-start take; its click places credits and pays nothing this turn, so it has no click entry)',
  '35022': 'Open Market: turnIncome (its hosted credits install only)', '34074': 'Friend of a Friend: clickMoney', '36021': 'Touchstone: stealth credits (runCredits)',
  '34082': 'Physarum Entangler: holdFacts.hostBypass', '30004': 'Botulus: holdFacts', '30017': 'Tranquilizer: holdFacts', '35030': 'Chromatophores: granter',
  '34081': 'Malandragem: runBypasses', '34016': 'Laser Pointer: runBypasses', '34015': 'Curupira: runBypasses', '35021': 'Fransofia Ward: runBypasses (its +1 rez cost: rezCostOf)',
  '34006': 'Monkeywrench: strength (iceStrength)', '35027': 'GAMEDRAGON Pro: breaker strength', '34005': 'Banner: breakPlans', '35029': 'Azimat: trash costs only',
  '34029': 'Urban Art Vernissage: install credits only', '36006': 'Hackerspace: install cost only', '30022': 'DZMZ Optimizer: install cost only', '30015': 'Carmen: install cost only',
  '35032': 'Principia: install cost only', '34002': 'The Price: install cost only', '35025': 'Illumination: install cost only', '35012': 'Barry Wong: installs from the grip (hidden)',
  '34066': 'Sebastião: installs from the grip (hidden)', '35002': 'Topan: installs from the grip (hidden)', '34020': 'Arissana: installs from the grip (hidden)', '35028': 'Madani: hosts from the grip (hidden)',
  '36013': 'Borrowed Goods: memory', '34095': 'Valentina Ferreira Carvalho: 1 credit on removing tags (the walk\'s tag removal: 1 less; small, open)',
  '36009': 'Vic: draw and a tag for 1 credit', '34024': 'Living Mural: breakPlans', '36004': 'Corsair: breakPlans, stealth', '36005': 'Lampades: trash on access',
  '35018': 'Detente: access', '36014': 'Rotary: access', '36008': 'Stick and Poke: a subroutine against the Runner', '30032': 'Mayfly: breakPlans', '34092': 'Pressure Spike: breakPlans',
  '34026': 'Slap Vandal: breakPlans', '34027': 'Umbrella: breakPlans', '34090': 'Lobisomem: breakPlans', '34004': 'Audrey v2: breakPlans', '35008': 'Hantu: breakPlans',
  '34018': 'Shibboleth: breakPlans', '35009': 'Rising Tide: breakPlans', '30025': 'Echelon: breakPlans', '30026': 'Unity: breakPlans', '30005': 'Buzzsaw: breakPlans', '30006': 'Cleaver: breakPlans',
  '34011': 'Chrysopoeian Skimming: a click only if the Corp reveals an agenda (its choice: none)', '34068': 'Privileged Access: Archives, a tag', '34079': 'Jeitinho: installs from the heap',
  '34085': 'Burner: instead of the breach', '36010': 'Kompromat: the Corp\'s choice of a derez after the run', '35015': 'Lie Low: cards or tags', '30021': 'VRcation: cards',
};

// The table is imported by tests/clickMoneyFacts.test.ts (its field claims as a test); the report runs only as a script.
if (!process.env.VITEST) main();

function main() {
  const files = readdirSync('src/data').filter(f => f.endsWith('-cards.json'));
  const cards = files.flatMap(f => (JSON.parse(readFileSync(`src/data/${f}`, 'utf8')) as { code: string; title: string; side_code: string; type_code: string; stripped_text?: string }[]).map(c => ({ ...c, set: f.replace('-cards.json', '') })));
  const runner = cards.filter(c => c.side_code === 'runner');
  const corp = cards.filter(c => c.side_code === 'corp');

  // The count's readers today, from the entries (a check of the table's "read already" column)
  const reads = (code: string): string[] => {
    const e = CARDS[code];
    const s = getCardScript(code);
    return [e?.turnIncome && 'turnIncome', e?.clickMoney && 'clickMoney', e?.holdFacts && 'holdFacts', s?.paysDuringRuns && 'paysDuringRuns'].filter((x): x is string => !!x);
  };

  const PATTERN = /\bgain \d+\s*(?:\[credit\]|credits?)|\btake (?:all|\d+) (?:\[credit\]|credits?)|hosted credits|gain (?:\[click\]|click)|\bbypass\b|-\d+ strength|\bderez\b|costs? \d+ (?:\[credit\]|credits?) less|\bless to use|place \d+ (?:\[credit\]|credits?)|recurring|instead of breaching|change the attacked server/i;
  const unclassified = runner.filter(c => PATTERN.test(c.stripped_text ?? '') && !TABLE[c.code] && !(c.code in READ_OR_IRRELEVANT));

  console.log('# Inventory: what the Runner can do that the hold count does not read\n');
  console.log(`Runner cards in the game: ${runner.length} (${files.join(', ')}). In the table: ${Object.keys(TABLE).length}. Read already or not about getting in: ${Object.keys(READ_OR_IRRELEVANT).filter(k => runner.some(c => c.code === k)).length}. Unclassified by the pattern: ${unclassified.length}.\n`);
  const routes = [...new Set(Object.values(TABLE).map(r => r.route))].sort();
  for (const route of routes) {
    const rows = Object.entries(TABLE).filter(([, r]) => r.route === route);
    const by = (k: Info | 'holds') => rows.filter(([, r]) => r.info === k || r.errs === k).length;
    console.log(`## ${route}: ${rows.length} cards (open ${by('open') + by('open (identity)')}, hidden ${by('hidden')}; errs toward "holds": ${by('holds')})\n`);
    console.log('| card | set | info | what the count misses (reader) | errs | arm | reads today |');
    console.log('|---|---|---|---|---|---|---|');
    for (const [code, r] of rows) {
      const c = runner.find(x => x.code === code);
      console.log(`| ${c?.title ?? code} (${code}) | ${c?.set ?? '?'} | ${r.info} | ${r.missing} | ${r.errs} | ${r.arm ?? '-'} | ${reads(code).join(', ') || '-'} |`);
    }
    console.log();
  }

  // Corp cards that change which ice is rezzed (or met) at the Runner's turn
  const CORP: Record<string, Row> = {
    '34097': { route: C1, info: 'open', missing: 'Lightning Laboratory: when the turn it was used ends, 2 ice of that server derezzed (turnIce counts them rezzed)', errs: 'holds', arm: 'lightning' },
    '36040': { route: C1, info: 'open', missing: 'Knowledge Seeker: derezzes itself after an encounter at 3 counters (a retry meets it unrezzed)', errs: 'holds' },
    '34100': { route: C1, info: 'open', missing: 'Lycian Multi-Munition: read (holdFacts.turnEndDerezSelf)', errs: 'none (not a hold question)' },
    '34032': { route: C1, info: 'open', missing: 'Stegodon MK IV: the Corp derezzes ice of another server for 1 (the Corp\'s choice; -2 to breakers after: toward the Corp)', errs: 'does not hold' },
    '34104': { route: C1, info: 'open', missing: 'Brasília Government Grid: the Corp derezzes another ice for +3 strength (the Corp\'s choice)', errs: 'does not hold' },
    '34038': { route: C1, info: 'open', missing: 'Vovô Ozetti: may move when the Corp\'s turn ends (rez costs read where it stands)', errs: 'does not hold' },
  };
  console.log(`## ${C1}: ${Object.keys(CORP).length} cards\n`);
  console.log('| card | info | what the count misses | errs | arm |');
  console.log('|---|---|---|---|---|');
  for (const [code, r] of Object.entries(CORP)) console.log(`| ${corp.find(x => x.code === code)?.title ?? code} (${code}) | ${r.info} | ${r.missing} | ${r.errs} | ${r.arm ?? '-'} |`);
  console.log();

  console.log('## Cross-check\n');
  if (unclassified.length) {
    for (const c of unclassified) console.log(`- UNCLASSIFIED ${c.title} (${c.code}): ${c.stripped_text}`);
    process.exitCode = 1;
  } else console.log('Every Runner card whose text matches the money, click, bypass, strength or derez pattern is in the table or in the read-already list.');
  const wrong = Object.keys(TABLE).filter(code => reads(code).length && TABLE[code].route !== R6);
  if (wrong.length) console.log(`\nIn the table with a reader today for another part of the card (Pennyshaver's click, Methuselah's hosted credits): ${wrong.map(c => `${runner.find(x => x.code === c)?.title} [${reads(c)}]`).join('; ')}`);
}
