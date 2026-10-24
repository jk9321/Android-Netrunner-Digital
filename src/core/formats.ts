import { CardDefinition } from './types/card';

/**
 * Null Signal Games' play formats and their current ban lists, taken from
 * NetrunnerDB (netrunnerdb.com/en/formats and /en/banlists) and NSG's
 * Supported Formats page (nullsignal.games/players/supported-formats).
 *
 * To update after a rotation or a new ban list:
 * - A new set: add its NetrunnerDB pack code to SET_NAMES and to the `sets`
 *   of each format it is legal in (and remove rotated sets).
 * - A new ban list: replace the format's `banList`. `node scripts/print-banlist.mjs`
 *   prints NetrunnerDB's current lists as ready-to-paste titles.
 * Cards are banned by title, so every printing of a banned card is caught.
 */

export type FormatId = 'casual' | 'startup' | 'standard';

export interface BanList {
  name: string;
  /** Date the list took effect (YYYY-MM-DD). */
  effective: string;
  /** Titles of cards no deck may include, identities among them. */
  banned: string[];
  /** Titles of restricted cards: a deck may include only one of them (up to a full playset). */
  restricted?: string[];
}

export interface Format {
  id: FormatId;
  name: string;
  description: string;
  /** NetrunnerDB pack codes of the legal sets; null means every card is allowed. */
  sets: string[] | null;
  banList?: BanList;
  /** Extra deck-building rules the format adds. Returns problems, like validateDeck. */
  extraRules?: (identity: CardDefinition, cards: CardDefinition[]) => string[];
}

/** Names of the sets formats refer to, by NetrunnerDB pack code. */
export const SET_NAMES: Record<string, string> = {
  sg: 'System Gateway',
  elev: 'Elevation',
  df: 'Downfall',
  ur: 'Uprising',
  urbp: 'Uprising Booster Pack',
  msbp: 'Midnight Sun Booster Pack',
  ms: 'Midnight Sun',
  ph: 'Parhelion',
  tai: 'The Automata Initiative',
  rwr: 'Rebellion Without Rehearsal',
  vp: 'Vantage Point',
};

export const FORMATS: Format[] = [
  {
    id: 'casual',
    name: 'Casual',
    description: 'Any card in the game, no ban list.',
    sets: null,
  },
  {
    id: 'startup',
    name: 'Startup',
    description: 'System Gateway, Elevation and the newest Null Signal cycle.',
    // As of Vantage Point (2 March 2026), which rotated the Liberation cycle out
    sets: ['sg', 'elev', 'vp'],
    banList: {
      // NSG calls this Startup Balance Update 26.04; NetrunnerDB lists it as 26.05
      name: 'Startup Balance Update 26.05',
      effective: '2026-04-17',
      banned: [
        'NBN: Reality Plus',
        'Let Them Dream',
        'Offworld Office',
        'Seamless Launch',
        'Mercia B4LL4RD',
        'Cleaver',
      ],
    },
    extraRules: (identity, cards) => {
      if (identity.side_code !== 'corp') return [];
      const big = cards.filter(c => c.type_code === 'agenda' && (c.agenda_points ?? 0) >= 3).length;
      return big > 4 ? [`Has ${big} agendas worth 3 or more points; Startup allows at most 4`] : [];
    },
  },
  {
    id: 'standard',
    name: 'Standard',
    description: 'The main Organized Play format.',
    // As of Vantage Point (2 March 2026); it did not trigger a Standard rotation
    sets: ['sg', 'elev', 'df', 'ur', 'urbp', 'msbp', 'ms', 'ph', 'tai', 'rwr', 'vp'],
    banList: {
      // NSG's Standard Balance Update 26.09 made no changes to this list
      name: 'Standard Balance Update 26.08',
      effective: '2026-08-01',
      banned: [
        // Corp
        'Bellona',
        'Cayambe Grid',
        'Cyberdex Sandbox',
        'Cybersand Harvester',
        'Dr. Vientiane Keeling',
        'Drago Ivanov',
        'Engram Flush',
        'Extract',
        'False Lead',
        'Gold Farmer',
        'Luminal Transubstantiation',
        'Méliès U: Only the Brightest',
        'Nanisivik Grid',
        'Offworld Office',
        'Project Vacheron',
        'Red Level Clearance',
        'Sting!',
        'Touch-ups',
        'Tributary',
        // Runner
        'Ashen Epilogue',
        'Bukhgalter',
        'Cleaver',
        'Endurance',
        'Hoshiko Shiro: Untold Protagonist',
        'K2CP Turbine',
        'Matryoshka',
        'Moshing',
        'Nyusha "Sable" Sintashta: Symphonic Prodigy',
        'Rezeki',
        'Trick Shot',
        'Tsakhia "Bankhar" Gantulga',
        'World Tree',
      ],
    },
  },
];

export const DEFAULT_FORMAT: FormatId = 'casual';

export function isFormatId(value: unknown): value is FormatId {
  return FORMATS.some(f => f.id === value);
}

export function getFormat(id: FormatId | undefined): Format {
  return FORMATS.find(f => f.id === id) ?? FORMATS.find(f => f.id === DEFAULT_FORMAT)!;
}

// Titles are compared without accents and curly quotes, so "Ryō “Phoenix” Ōno" matches its plain spelling
const normalize = (title: string) =>
  title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();

function onList(list: string[] | undefined, card: CardDefinition): boolean {
  if (!list) return false;
  const titles = [card.title, card.stripped_title].filter((t): t is string => !!t).map(normalize);
  return list.some(t => titles.includes(normalize(t)));
}

export function isBanned(format: Format, card: CardDefinition): boolean {
  return onList(format.banList?.banned, card);
}

export function isRestricted(format: Format, card: CardDefinition): boolean {
  return onList(format.banList?.restricted, card);
}

/** Whether the card's set is in the format's card pool. */
export function isInCardPool(format: Format, card: CardDefinition): boolean {
  return format.sets === null || format.sets.includes(card.pack_code);
}

/** Problems with the identity and cards under a format's card pool, ban list and extra rules. */
export function validateFormat(format: Format, identity: CardDefinition, cards: CardDefinition[]): string[] {
  const problems: string[] = [];
  const unique = [identity, ...new Map(cards.map(c => [c.code, c])).values()];
  for (const card of unique) {
    if (!isInCardPool(format, card)) {
      problems.push(`${card.title} is from ${SET_NAMES[card.pack_code] ?? card.pack_code}, which isn't legal in ${format.name}`);
    }
    if (isBanned(format, card)) problems.push(`${card.title} is banned in ${format.name} (${format.banList!.name})`);
  }
  const restricted = [...new Set(unique.filter(c => isRestricted(format, c)).map(c => c.title))];
  if (restricted.length > 1) problems.push(`Has ${restricted.length} restricted cards (${restricted.join(', ')}); ${format.name} allows 1`);
  if (format.extraRules) problems.push(...format.extraRules(identity, cards));
  return problems;
}
