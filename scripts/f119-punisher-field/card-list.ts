/**
 * F119 phase A step 1 (brief /mnt/project-files/netrunner-ai/f119-punisher-field/brief.md rev 1, final with
 * ruling-redteam.md "Rev 1, ruled"): THE CARD LIST. Every Corp card of the four sets whose text names a tag, by code,
 * classified as `filled` (the brief's table: a tagUse entry), `runTime` (a tag spent or read during the Runner's runs),
 * `giver` (gives tags, uses none: F112's family), `ice` (a subroutine or ability that reads or gives tags in a run: the
 * run model's facts) or `other`, with a reason. For the ten filled cards the card text is quoted from the card data
 * (`stripped_text`, src/data/*-cards.json) beside the field the brief fills (coordinator addition a); run as a script,
 * the list checks itself against the card data: a quote that differs, or a Corp card with "tag" in its text that is not
 * listed, is a stop (exit 1).
 *   npx vite-node scripts/f119-punisher-field/list-check.ts
 * Committed before any arm tree exists; the tests, the record (record-set.ts) and the trees read it.
 */
export type Kind = 'filled' | 'runTime' | 'giver' | 'ice' | 'other';
export interface Listed {
  title: string;
  kind: Kind;
  why: string;
  /** filled only: the card text quoted from the card data, and the field the brief fills */
  text?: string;
  field?: string;
  /** filled only: the brief's group (take: the Runner loses; gain: the Corp gains; freeRez: freeRez.ts's reader) */
  group?: 'take' | 'gain' | 'freeRez';
}

export const CARD_LIST: Record<string, Listed> = {
  // ---------------------------------------------------------------- filled (the brief's table)
  '30065': {
    title: 'Retribution',
    kind: 'filled',
    group: 'take',
    why: 'operation, play only if tagged',
    text: 'Play only if the Runner is tagged. Trash 1 installed program or piece of hardware.',
    field: "from hq, needs 1, spends 0, does { trashRig: 1 }, no without",
  },
  '35066': {
    title: 'IP Enforcement',
    kind: 'filled',
    group: 'take',
    why: 'operation, X tags as an additional cost (rules 1.16.10, 1.16.2c)',
    text: "As an additional cost to play this operation, remove X tags. Install 1 agenda from the Runner's score area with a printed agenda point value equal to X. If the Runner is still tagged, place 1 advancement counter on that agenda.",
    field: "from hq, needs 1, spends X, does { runnerPoints: X, corpAgenda: { counters: n > X ? 1 : 0, cost, points: X } } for the agenda the engine's ipTargets allows (printed points 1..n; the highest points, then the lowest requirement), nothing if none; no without",
  },
  '35065': {
    title: 'Bigger Picture',
    kind: 'filled',
    group: 'take',
    why: 'operation, play only if tagged; remove tags mode',
    text: 'Play only if the Runner is tagged. Resolve 1 of the following: * Give the Runner 1 tag. * Remove any number of tags. The Runner loses 5 credits for each tag removed this way. Gain credits equal to the number of credits the Runner lost.',
    field: 'from hq, needs 1, spends min(n, ceil(runnerCredits / 5)) (rule 1.10.3b), does { runnerCredits: min(credits, 5n), corpCredits: the same }, no without ("give 1 tag" is not a tag use)',
  },
  '34045': {
    title: 'Mindscaping',
    kind: 'filled',
    group: 'take',
    why: 'operation, damage equal to tags up to 3',
    text: 'Resolve 1 of the following: * Gain 4 credits and draw 2 cards. Add 1 card from HQ to the top of R&D. * Do X net damage. X is equal to the number of tags the Runner has, up to 3.',
    field: 'from hq, needs 1, spends 0, does { damage: min(3, n) }, without { corpCredits: 4, corpCards: 1 }',
  },
  '30068': {
    title: 'Orbital Superiority',
    kind: 'filled',
    group: 'take',
    why: 'agenda, 4 meat damage on score if tagged',
    text: 'When you score this agenda, if the Runner is tagged, do 4 meat damage; otherwise, give the Runner 1 tag.',
    field: 'from onScore, needs 1, spends 0, does { damage: 4 }, no without (untagged it gives a tag: not a use)',
  },
  '34049': {
    title: 'Oracle Thinktank',
    kind: 'filled',
    group: 'take',
    why: "agenda, the Corp's click ability from the Runner's score area (rules 1.14.4a, 4.5.4)",
    text: "When the Runner steals this agenda, give them 1 tag. click, remove 1 tag: Shuffle this agenda into R&D. The Corp can use this ability only if this agenda is in the Runner's score area.",
    field: "from runnerScoreArea, needs 1, spends 1, does { runnerPoints: its printed points (1) }; the return to R&D is not read (approximation 5)",
  },
  '30056': {
    title: 'Predictive Planogram',
    kind: 'filled',
    group: 'gain',
    why: 'operation, both modes if tagged',
    text: 'Resolve 1 of the following. If the Runner is tagged, you may resolve both instead. * Gain 3 credits. * Draw 3 cards.',
    field: 'from hq, needs 1, spends 0, does { corpCredits: 3, corpCards: 3 }, without the better of { corpCredits: 3 } and { corpCards: 3 }',
  },
  '35058': {
    title: 'Synapse Global: Faster than Thought',
    kind: 'filled',
    group: 'gain',
    why: "identity, click ability that removes a tag; install on a tag's removal",
    text: 'The first time each turn a tag is removed, you may reveal and install 1 card from HQ, ignoring all costs. click, remove 1 tag: Gain 2 credits.',
    field: 'from identity, needs 1, spends 1, does { corpCredits: 2, install: hq.length > 0 ? 1 : 0 } (approximation 9)',
  },
  '34037': {
    title: 'Greasing the Palm',
    kind: 'filled',
    group: 'gain',
    why: 'operation, may remove a tag for a counter',
    text: 'Gain 5 credits. You may install 1 card from HQ. You may remove 1 tag to place 1 advancement counter on that card.',
    field: 'from hq, needs 1, spends 1, does { corpCredits: 5, advance: hq.length > 1 ? 1 : 0 }, without { corpCredits: 5 }',
  },
  '36044': {
    title: 'Unleash',
    kind: 'filled',
    group: 'freeRez',
    why: 'operation, 1 tag as an additional cost',
    text: 'As an additional cost to play this operation, remove 1 tag. Rez 1 installed piece of ice, ignoring all costs. You may resolve 1 subroutine on that ice.',
    field: "from hq, needs 1, spends 1, does { freeRez: 1 } (freeRez.ts's reader, not the clock; the subroutine is not read: approximation 11)",
  },
  // ---------------------------------------------------------------- run time (F111, RULE-SET-RUN-STOPPERS)
  '34065': { title: 'B-1001', kind: 'runTime', why: 'a tag spent during a run on another server (F111)' },
  '34060': { title: 'Valentão', kind: 'runTime', why: "a tag as the rez's additional cost, rezzed during the Runner's run (F111)" },
  '34117': { title: 'Piranhas', kind: 'runTime', why: "a tag as the rez's additional cost, rezzed during the Runner's run (F111)" },
  // ---------------------------------------------------------------- ice: tag-reading or tag-giving subroutines (the run model's facts)
  '35052': { title: 'Empiricist', kind: 'ice', why: 'a subroutine gives a tag' },
  '35063': { title: 'Doomscroll', kind: 'ice', why: 'a subroutine reads 2 tags (runs.ts runnerTagsAtLeast)' },
  '35080': { title: 'Lamplighter', kind: 'ice', why: 'end the run if tagged (runs.ts runnerTagsAtLeast)' },
  '34035': { title: 'Jaguarundi', kind: 'ice', why: 'core damage if tagged; tag on encounter' },
  '34043': { title: 'Phoneutria', kind: 'ice', why: 'a tag when passed with 4+ cards in grip' },
  '34053': { title: 'Starlit Knight', kind: 'ice', why: 'end-the-run subroutines per tag (gainsOnEncounter)' },
  '34054': { title: 'Virtual Service Agent', kind: 'ice', why: 'a tag when passed unbroken' },
  '34110': { title: 'Cloud Eater', kind: 'ice', why: 'gives tags (a subroutine and the encounter end)' },
  '34116': { title: 'Capacitor', kind: 'ice', why: 'strength and credits by tags in the encounter' },
  '34118': { title: 'Seraph', kind: 'ice', why: 'a tag on encounter or a subroutine' },
  '34126': { title: 'Hammer', kind: 'ice', why: 'a subroutine gives a tag' },
  '30054': { title: 'Funhouse', kind: 'ice', why: 'gives tags on encounter and a subroutine' },
  '30055': { title: 'Ping', kind: 'ice', why: 'a tag when rezzed during a run' },
  '30063': { title: 'Pharos', kind: 'ice', why: 'a subroutine gives a tag' },
  '36042': { title: 'Vicsek', kind: 'ice', why: 'damage and tags equal to tags, in a run' },
  '36051': { title: 'Lethe', kind: 'ice', why: 'a tag when bypassed or fully broken' },
  // ---------------------------------------------------------------- givers (F112's first-tag reading)
  '35050': { title: 'Byte!', kind: 'giver', why: 'on access: pay 4 for a tag and 3 net damage' },
  '35062': { title: 'Public Access Plaza', kind: 'giver', why: 'a tag when trashed by the Runner (trashedByRunner)' },
  '35068': { title: 'BANGUN: When Disaster Strikes', kind: 'giver', why: 'identity: a tag when a faceup agenda is accessed' },
  '34051': { title: 'Behold!', kind: 'giver', why: 'on access: pay 4 for 2 tags' },
  '34055': { title: 'Oppo Research', kind: 'giver', why: 'operation: 2 tags' },
  '34105': { title: 'See How They Run', kind: 'giver', why: 'agenda: a tag on score' },
  '30051': { title: 'NBN: Reality Plus', kind: 'giver', why: 'identity: gains when the Runner takes a tag (reads a given tag, uses none)' },
  '30052': { title: 'Tomorrowʼs Headline', kind: 'giver', why: 'agenda: a tag when scored or stolen' },
  '30057': { title: 'Public Trail', kind: 'giver', why: 'operation: a tag unless the Runner pays 8' },
  '30058': { title: 'AMAZE Amusements', kind: 'giver', why: 'upgrade: 2 tags after a steal from its server' },
  '36047': { title: 'Witch Hunt', kind: 'giver', why: 'agenda: removes all tags when the action phase ends, after the uses, then gives 3 (the brief\'s note)' },
  '36049': { title: 'Nihilo Agent', kind: 'giver', why: "asset: removes 1 tag when the Corp's turn begins (rule 5.6.1d, approximation 12), gives 1 at the discard phase's end" },
  // ---------------------------------------------------------------- other
  '36038': { title: 'Esca', kind: 'other', why: 'on access: 1 net damage if tagged (an access effect, not a Corp-turn use)' },
};

/** The filled codes, in the brief's order. */
export const FILLED = Object.entries(CARD_LIST)
  .filter(([, v]) => v.kind === 'filled')
  .map(([k]) => k);
/** Decks "holding a filled card" (step 2's field decks) and "holding a gain card" (G's bar), by code. */
export const TAKE_CODES = FILLED.filter(c => CARD_LIST[c].group === 'take');
export const GAIN_CODES = FILLED.filter(c => CARD_LIST[c].group === 'gain');
