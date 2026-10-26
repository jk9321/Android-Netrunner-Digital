/**
 * Plain-language rules glossary for the keyword hover tooltips.
 * Definitions are short summaries of the NSG Comprehensive Rules (v26.03); section numbers point there.
 */

export interface GlossaryEntry {
  term: string;
  text: string;
  /** Regex sources (matched case-insensitively, whole words) that mark this term in card text. */
  match?: string[];
  /** Everyday term: underlined in card text, but left out of the hover popout's keyword list. */
  basic?: boolean;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // Resources and the turn
  click: {
    term: 'Click',
    text: 'One action\'s worth of time. The Corp gets 3 clicks a turn, the Runner 4; most actions cost 1 click.',
    match: ['clicks?'],
    basic: true,
  },
  credit: {
    term: 'Credit',
    text: 'The game\'s money. Spend credits to play, install and rez cards, break ice and pay trash costs.',
    match: ['credits?'],
    basic: true,
  },
  'recurring-credit': {
    term: 'Recurring credits',
    text: 'Credits placed on the card that refill to their printed number at the start of each of your turns. They can only be spent the way the card says.',
  },
  mu: {
    term: 'Memory units (MU)',
    text: 'The Runner\'s room for programs. Each program uses its memory cost; the Runner starts with 4 MU. If programs use more than you have, you must trash some.',
    match: ['memory units?'],
  },
  'hand-size': {
    term: 'Maximum hand size',
    text: 'The most cards a player may keep at the end of their turn (5 to start). Extra cards are discarded.',
    match: ['maximum hand size'],
  },
  link: {
    term: 'Link',
    text: 'The Runner\'s link value. It is added to the Runner\'s side when the Corp starts a trace.',
  },

  // Zones
  hq: {
    term: 'HQ',
    text: 'The Corp\'s hand, and a central server. Runs on HQ access random cards from it.',
    match: ['HQ'],
    basic: true,
  },
  rd: {
    term: 'R&D',
    text: 'The Corp\'s deck, and a central server. Runs on R&D access the top card.',
    match: ['R&amp;D', 'R&D'],
    basic: true,
  },
  archives: {
    term: 'Archives',
    text: 'The Corp\'s discard pile, and a central server. Facedown cards there are hidden; a run on Archives turns them faceup and accesses all of them.',
    match: ['Archives'],
    basic: true,
  },
  grip: { term: 'Grip', text: 'The Runner\'s hand.', match: ['grip'], basic: true },
  stack: { term: 'Stack', text: 'The Runner\'s deck.', match: ['stack'], basic: true },
  heap: { term: 'Heap', text: 'The Runner\'s discard pile.', match: ['heap'], basic: true },
  'score-area': {
    term: 'Score area',
    text: 'Where scored or stolen agendas go. The first player to 7 agenda points wins.',
  },
  'central-server': {
    term: 'Central server',
    text: 'HQ, R&D and Archives. The Corp can protect them with ice and install upgrades in them.',
    match: ['central servers?'],
  },
  'remote-server': {
    term: 'Remote server',
    text: 'A server the Corp creates by installing an agenda, asset or upgrade on its own. Runs on it access the cards installed there.',
    match: ['remote servers?'],
  },

  // Card types
  agenda: {
    term: 'Agenda',
    text: 'The Corp scores it by advancing it enough; the Runner steals it by accessing it. Its agenda points count toward the 7 needed to win.',
    match: ['agendas?'],
    basic: true,
  },
  asset: { term: 'Asset', text: 'A Corp card installed in a remote server. It works once rezzed and can be trashed by the Runner when accessed.', match: ['assets?'], basic: true },
  upgrade: { term: 'Upgrade', text: 'A Corp card installed in any server (central or remote) to improve it.', match: ['upgrades?'], basic: true },
  operation: { term: 'Operation', text: 'A one-shot Corp card: play it for its effect, then it goes to Archives.', match: ['operations?'], basic: true },
  ice: {
    term: 'Ice',
    text: 'Corp cards installed in front of servers. The Runner must get past each piece, outermost first, to reach the server.',
    match: ['piece of ice', 'pieces of ice', 'ice'],
    basic: true,
  },
  event: { term: 'Event', text: 'A one-shot Runner card: play it for its effect, then it goes to the heap.', match: ['events?'], basic: true },
  program: { term: 'Program', text: 'A Runner card installed in the rig that uses memory units (MU). Icebreakers are programs.', match: ['programs?'], basic: true },
  hardware: { term: 'Hardware', text: 'A Runner card installed in the rig, such as a console or other gear.', match: ['hardware'], basic: true },
  resource: {
    term: 'Resource',
    text: 'A Runner card installed in the rig. While the Runner is tagged, the Corp can spend a click and 2 credits to trash one.',
    match: ['resources?'],
    basic: true,
  },
  icebreaker: {
    term: 'Icebreaker',
    text: 'A program that breaks ice subroutines. It can only interact with ice whose strength is equal or lower than its own.',
    match: ['icebreakers?'],
  },
  console: { term: 'Console', text: 'A type of hardware. The Runner can only have 1 console installed at a time.', match: ['console'] },
  identity: { term: 'Identity', text: 'The card that says who you are playing. It starts in play and its ability is always active.' },

  // Corp actions and states
  install: {
    term: 'Install',
    text: 'Put a card into play. Corp cards are installed facedown and must be rezzed to work; installing ice costs 1 credit for each ice already protecting that server.',
    match: ['install(?:s|ed|ing)?', 'uninstalled'],
    basic: true,
  },
  rez: {
    term: 'Rez',
    text: 'Turn an installed Corp card faceup by paying its rez cost. Unrezzed cards do nothing. Derez turns it facedown again.',
    match: ['rez(?:zed|zes|zing)?', 'derez(?:zed)?', 'unrezzed'],
  },
  advance: {
    term: 'Advance',
    text: 'Corp action: spend a click and 1 credit to place an advancement counter on a card. An agenda with counters equal to its advancement requirement can be scored.',
    match: ['advance(?:s|d)?', 'advancement counters?'],
  },
  'advancement-requirement': {
    term: 'Advancement requirement',
    text: 'How many advancement counters an agenda needs before the Corp can score it.',
  },
  score: {
    term: 'Score',
    text: 'The Corp scores an agenda (one that has enough advancement counters) by moving it to their score area and gaining its agenda points.',
    match: ['score(?:s|d)?'],
    basic: true,
  },
  steal: {
    term: 'Steal',
    text: 'When the Runner accesses an agenda, they steal it: it goes to their score area and they gain its points.',
    match: ['steal(?:s)?', 'stolen'],
    basic: true,
  },
  purge: {
    term: 'Purge',
    text: 'Corp action costing all 3 clicks: remove every virus counter from the game.',
    match: ['purge'],
  },

  // Running
  run: {
    term: 'Run',
    text: 'The Runner\'s attack on a server: approach and get past each piece of ice, then breach the server and access cards.',
    match: ['run(?:s)?'],
    basic: true,
  },
  'successful-run': {
    term: 'Successful run',
    text: 'A run where the Runner gets past all the ice and reaches the server, before breaching it.',
    match: ['successful run', 'successful'],
  },
  approach: {
    term: 'Approach',
    text: 'Reaching a piece of ice or the server during a run. The Corp may rez the approached ice now.',
    match: ['approach(?:es)?'],
  },
  encounter: {
    term: 'Encounter',
    text: 'Facing a rezzed piece of ice. The Runner may break its subroutines; any left unbroken then resolve, in order.',
    match: ['encounter(?:s|ing)?'],
  },
  subroutine: {
    term: 'Subroutine',
    text: 'An effect on ice (marked ↳) that fires against the Runner unless they break it during the encounter.',
    match: ['subroutines?'],
  },
  break: {
    term: 'Break',
    text: 'Stop a subroutine from resolving, usually by using an icebreaker of equal or higher strength.',
    match: ['break'],
  },
  strength: {
    term: 'Strength',
    text: 'Ice and icebreakers have strength. An icebreaker can only break subroutines on ice with strength equal or lower than its own; pay to boost it.',
    match: ['strength'],
    basic: true,
  },
  interface: {
    term: 'Interface',
    text: 'Marks an icebreaker ability that breaks subroutines. It only works on ice whose strength is equal or lower than the breaker\'s.',
    match: ['Interface'],
  },
  'end-the-run': {
    term: 'End the run',
    text: 'The run stops immediately and is unsuccessful. The Runner accesses nothing.',
    match: ['end the run'],
  },
  'jack-out': {
    term: 'Jack out',
    text: 'The Runner gives up the run. It ends unsuccessful. Allowed only right after passing a piece of ice (or before approaching a server with no ice), before the Corp gets to rez the next card.',
    match: ['jack out'],
  },
  breach: {
    term: 'Breach',
    text: 'After a successful run the Runner breaches the server and accesses its cards: 1 random card from HQ, the top card of R&D, everything in Archives, or all cards in a remote server.',
    match: ['breach(?:es)?'],
  },
  access: {
    term: 'Access',
    text: 'Look at a Corp card during a breach. Agendas are stolen; other cards may be trashed by paying their trash cost, otherwise they stay where they were.',
    match: ['access(?:es|ed|ing)?'],
    basic: true,
  },
  'trash-cost': {
    term: 'Trash cost',
    text: 'The price the Runner pays to trash a Corp card they are accessing.',
    match: ['trash costs?'],
  },
  trash: {
    term: 'Trash',
    text: 'Send a card to its owner\'s discard pile: Archives for the Corp, the heap for the Runner.',
    match: ['trash(?:es|ed)?'],
    basic: true,
  },

  // Tags and damage
  tag: {
    term: 'Tag',
    text: 'The Corp has found the Runner. While tagged (1+ tags), the Corp can spend a click and 2 credits to trash a Runner resource, and some Corp cards get stronger. The Runner can spend a click and 2 credits to remove a tag.',
    match: ['tags?', 'tagged'],
  },
  'net-damage': {
    term: 'Net damage',
    text: 'For each point, the Runner trashes a random card from their grip. Taking more damage than cards in grip flatlines the Runner and they lose.',
    match: ['net damage'],
  },
  'meat-damage': {
    term: 'Meat damage',
    text: 'Works like net damage: 1 random card from the grip is trashed per point. Taking more than you hold flatlines the Runner.',
    match: ['meat damage'],
  },
  'core-damage': {
    term: 'Core damage',
    text: 'Trash 1 random card from the grip per point, and the Runner\'s maximum hand size drops by 1 for the rest of the game.',
    match: ['core damage', 'brain damage'],
  },
  'bad-publicity': {
    term: 'Bad publicity',
    text: 'For each bad publicity the Corp has, the Runner gets 1 extra credit to spend during each run.',
    match: ['bad publicity'],
  },
  trace: {
    term: 'Trace',
    text: 'Both players secretly bid credits: the Corp adds theirs to the trace value, the Runner adds theirs to link. The Corp wins if its total is higher.',
    match: ['trace'],
  },

  // Counters and hosting
  counter: {
    term: 'Counters',
    text: 'Tokens placed on cards to track things like advancement, virus, credits or power. Hosted counters leave with their card.',
  },
  'virus-counter': {
    term: 'Virus counter',
    text: 'A counter on Runner virus programs that powers their effects. The Corp can remove them all by purging.',
    match: ['virus counters?'],
  },
  virus: { term: 'Virus', text: 'A program subtype that uses virus counters. A Corp purge wipes them out.', match: ['virus'] },
  host: {
    term: 'Host',
    text: 'A card on another card is hosted by it. If the host card leaves play, the cards and counters on it are trashed.',
    match: ['host(?:s|ed)?'],
  },
  load: {
    term: 'Load / empty',
    text: 'Loading places counters on a card. It is empty once those loaded counters are all gone, which often trashes it.',
    match: ['load', 'empty'],
  },

  // Card text conventions
  'once-per-turn': {
    term: 'Once per turn',
    text: 'The ability can only be used or trigger one time each turn.',
    match: ['once per turn'],
  },
  persistent: {
    term: 'Persistent',
    text: 'If the Runner trashes this card while accessing it, this ability keeps working until the end of that run.',
    match: ['Persistent'],
  },
  'limit-per-deck': {
    term: 'Limit 1 per deck',
    text: 'A deck may only include 1 copy of this card (normally 3 are allowed).',
    match: ['limit 1 per deck'],
  },
  'remove-from-game': {
    term: 'Remove from the game',
    text: 'The card is set aside for the rest of the game. It is not trashed and cannot come back.',
    match: ['remove (?:this \\w+ )?from the game'],
  },
  threat: {
    term: 'Threat / threat level',
    text: 'The threat level is the highest number of agenda points either player has in their score area. "Threat N →" abilities are only active while the threat level is N or more.',
    match: ['threat level', 'threat \\d+'],
  },
  dividends: {
    term: 'Dividends',
    text: 'When the Corp scores this agenda, it gets 1 agenda counter (or N for Dividends N) for each advancement counter on it beyond its advancement requirement.',
    match: ['dividends(?: \\d+)?'],
  },
  sabotage: {
    term: 'Sabotage',
    text: 'To sabotage N, the Corp trashes N cards of their choice, split however they like between HQ and the top of R&D.',
    match: ['sabotage(?: \\d+)?'],
  },
  forfeit: {
    term: 'Forfeit',
    text: 'Remove an agenda from your own score area from the game, usually to pay a cost. Its agenda points no longer count for you.',
    match: ['forfeit(?:s|ed)?'],
  },
  'additional-cost': {
    term: 'Additional cost',
    text: 'An extra cost you must pay on top of the normal cost to play or use the card. If you cannot pay it, you cannot play it.',
    match: ['additional cost'],
  },
  bypass: {
    term: 'Bypass',
    text: 'Get past a piece of ice without finishing the encounter: no subroutines or further "when encountered" abilities resolve, and the run continues.',
    match: ['bypass(?:es|ed)?'],
  },
  reveal: {
    term: 'Reveal',
    text: 'Show a card to both players. It then goes back where it was, unless the effect says otherwise.',
    match: ['reveal(?:s|ed)?'],
    basic: true,
  },
  'power-counter': {
    term: 'Power counter',
    text: 'A general-purpose counter that a card\'s own abilities place and spend.',
    match: ['power counters?'],
  },
  'agenda-counter': {
    term: 'Agenda counter',
    text: 'A counter placed on a scored agenda, which that agenda\'s abilities can spend.',
    match: ['agenda counters?'],
  },
  'trash-symbol': {
    term: 'Trash symbol',
    text: 'As part of the ability\'s cost, trash this card. An ability with this cost can only be used once.',
  },

  // Subtypes that card text refers to
  barrier: { term: 'Barrier', text: 'An ice subtype. Barriers mostly end the run. Fracters break barrier subroutines.', match: ['barriers?'] },
  'code-gate': { term: 'Code gate', text: 'An ice subtype. Code gates often tax the Runner or disrupt their plans. Decoders break code gate subroutines.', match: ['code gates?'] },
  sentry: { term: 'Sentry', text: 'An ice subtype. Sentries tend to hurt the Runner: damage, tags or trashed programs. Killers break sentry subroutines.', match: ['sentry', 'sentries'] },
  fracter: { term: 'Fracter', text: 'An icebreaker that breaks barrier subroutines.', match: ['fracters?'] },
  decoder: { term: 'Decoder', text: 'An icebreaker that breaks code gate subroutines.', match: ['decoders?'] },
  killer: { term: 'Killer', text: 'An icebreaker that breaks sentry subroutines.', match: ['killers?'] },
  ai: { term: 'AI', text: 'An icebreaker subtype. AI breakers can usually interface with ice of any subtype, but often at a high cost.', match: ['AI'] },
  bioroid: { term: 'Bioroid', text: 'An ice and card subtype. Many bioroid ice let the Runner break subroutines by spending clicks instead of using icebreakers.', match: ['bioroids?'] },
  trojan: { term: 'Trojan', text: 'A program subtype installed on (hosted by) a piece of ice. If that ice leaves play or is uninstalled, the trojan is trashed.', match: ['trojans?'] },
  region: { term: 'Region', text: 'An upgrade subtype. Each server can only have 1 region installed in or protecting it.', match: ['regions?'] },

  unrezzed: {
    term: 'Unrezzed',
    text: 'An installed Corp card still facedown. It has no effect until the Corp pays to rez it. The Runner cannot see it unless they access it.',
  },
};

const ids = Object.keys(GLOSSARY).filter(id => GLOSSARY[id].match);
const sources = ids.flatMap(id => GLOSSARY[id].match!.map(src => ({ id, src })));
// Longest first, so "net damage" wins over "damage" and "successful run" over "run"
sources.sort((a, b) => b.src.length - a.src.length);
const KEYWORD_RE = new RegExp(
  // Not inside a symbol token like [credit], and not part of a longer word
  `(?<![\\w\\[-])(${sources.map(s => s.src).join('|')})(?![\\w\\]-])`,
  'gi'
);
const compiled = sources.map(s => ({ id: s.id, re: new RegExp(`^(?:${s.src})$`, 'i') }));

/** The glossary entry a matched word belongs to. */
function idFor(word: string): string | undefined {
  return compiled.find(c => c.re.test(word))?.id;
}

/**
 * Wrap the first mention of each glossary term in card text (which may contain HTML tags)
 * in a hoverable span. Text inside tags is left alone.
 */
export function annotateKeywords(html: string): string {
  // Card text comes from a fixed card pool, so each text is worked out once (hover popouts ask again on every hover)
  let annotated = annotatedCache.get(html);
  if (annotated === undefined) {
    annotated = annotate(html);
    annotatedCache.set(html, annotated);
  }
  return annotated;
}

const annotatedCache = new Map<string, string>();

function annotate(html: string): string {
  const seen = new Set<string>();
  return html
    .split(/(<[^>]+>)/)
    .map(part => {
      if (part.startsWith('<')) return part;
      return part.replace(KEYWORD_RE, word => {
        const id = idFor(word);
        if (!id || seen.has(id)) return word;
        seen.add(id);
        return `<span data-kw="${id}" class="kw">${word}</span>`;
      });
    })
    .join('');
}

/** Glossary ids mentioned in card text, in order of first appearance. */
export function keywordsIn(html: string): string[] {
  const found = annotateKeywords(html).matchAll(/data-kw="([^"]+)"/g);
  return [...new Set([...found].map(m => m[1]))];
}

/** Rules symbols in raw card text that have their own glossary entry. */
const SYMBOL_TERMS: Record<string, string> = { '[recurring-credit]': 'recurring-credit', '[mu]': 'mu', '[link]': 'link', '[trash]': 'trash-symbol' };

/** The less obvious terms on a card, for the keyword list in the hover popout. */
export function cardKeywords(text: string): string[] {
  const symbols = Object.keys(SYMBOL_TERMS).filter(s => text.includes(s)).map(s => SYMBOL_TERMS[s]);
  return [...new Set([...keywordsIn(text), ...symbols])].filter(id => !GLOSSARY[id].basic);
}

const LABEL_KEYWORDS: Record<string, string> = {
  HQ: 'hq', 'R&D': 'rd', Archives: 'archives', Stack: 'stack', Heap: 'heap', Grip: 'grip',
  Scored: 'score-area', Stolen: 'score-area', Removed: 'remove-from-game',
};

/** The glossary id for a pile or zone label in the UI. */
export function labelKeyword(label: string): string {
  return LABEL_KEYWORDS[label] ?? '';
}
