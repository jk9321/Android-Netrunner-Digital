import fs from 'node:fs';
import { ParsedDeck, normalizeTitle, parseNetrunnerDbUrl, resolveImport } from '../src/data/deckImport';
import { CARD_SETS } from '../src/core/cards';
import {
  DeckGap,
  IMPLEMENTED_PACKS,
  PackInfo,
  buildPrintingIndex,
  groupMissingBySet,
  packName,
  rankSetsToUnlock,
} from '../src/data/deckPlayability';

/**
 * Deck playability check for NetrunnerDB decklists: which are fully playable
 * with the cards this game implements, what each one is missing, and which
 * unimplemented set would make the most of them playable.
 *
 *   npx vite-node scripts/deck-playability.ts -- --from 2022-07-22 --to 2022-10-31 --startup
 *   npx vite-node scripts/deck-playability.ts -- --ids 98786,https://netrunnerdb.com/en/decklist/80555
 *
 * Options:
 *   --from / --to YYYY-MM-DD   decklists published in that range (inclusive; one API call per day)
 *   --ids a,b                  decklist ids or links
 *   --startup                  only decklists tagged with a Startup ban list (mwl_code startup-*)
 *   --within sg,su21,ms        only decklists whose every card is printed in these packs
 *                              (era Startup pool), on top of our own sets
 *   --side corp|runner
 *   --candidates ms,ph         sets to rank (default: every set from System Gateway on that we lack)
 *   --playable                 list only fully playable decklists
 *   --json out.json            also write the full result as JSON
 *
 * New-set threads: pull era decks by date, keep the "PLAYABLE" + "legal" ones
 * as test decks (test-only, never shipped on main).
 */

const API = 'https://netrunnerdb.com/api/2.0/public';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);
const list = (name: string) => opt(name)?.split(',').map(s => s.trim()).filter(Boolean);

async function getJson<T>(path: string): Promise<T[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/${path}`);
    if (res.ok) return ((await res.json()) as { data: T[] }).data ?? [];
    if (attempt >= 3 || res.status === 404) throw new Error(`${path}: NetrunnerDB answered ${res.status}`);
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
  }
}

interface NrdbCard {
  code: string;
  title: string;
  pack_code: string;
  type_code: string;
  side_code: string;
}
interface NrdbDecklist {
  id: number;
  uuid: string;
  name: string;
  date_creation: string;
  user_name: string;
  mwl_code: string | null;
  cards: Record<string, number>;
}

const [cards, packs] = await Promise.all([getJson<NrdbCard>('cards'), getJson<PackInfo>('packs')]);
const byCode = new Map(cards.map(c => [c.code, c]));
const printings = buildPrintingIndex(cards);
const released = (p: PackInfo) => p.date_release ?? '9999';
const packsByDate = [...packs].sort((a, b) => released(a).localeCompare(released(b)));

// Decklists to check
const decklists: NrdbDecklist[] = [];
const from = opt('from');
const to = opt('to') ?? from;
if (from && to) {
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    decklists.push(...(await getJson<NrdbDecklist>(`decklists/by_date/${d.toISOString().slice(0, 10)}`)));
  }
}
for (const ref of list('ids') ?? []) {
  const id = parseNetrunnerDbUrl(ref)?.id ?? ref;
  decklists.push(...(await getJson<NrdbDecklist>(`decklist/${id}`)));
}
if (decklists.length === 0) {
  console.error('No decklists. Pass --from/--to dates or --ids (see the header of this script).');
  process.exit(1);
}

const within = list('within');
const pool = within && new Set([...within, ...IMPLEMENTED_PACKS]);
const side = opt('side');
const isIdentity = (code: string) => byCode.get(code)?.type_code === 'identity';
const kept = decklists.filter(dl => {
  if (flag('startup') && !dl.mwl_code?.startsWith('startup')) return false;
  const identity = Object.keys(dl.cards).find(isIdentity);
  if (side && identity && byCode.get(identity)?.side_code !== side) return false;
  if (pool) {
    return Object.keys(dl.cards).every(code => {
      const card = byCode.get(code);
      return card && [...(printings.get(normalizeTitle(card.title)) ?? [])].some(p => pool.has(p));
    });
  }
  return true;
});

// Check each decklist against our pool
const results = kept.map(dl => {
  const parsed: ParsedDeck = { name: dl.name, entries: [] };
  for (const [code, count] of Object.entries(dl.cards)) {
    const card = byCode.get(code);
    const title = card?.title ?? `Card ${code}`;
    if (card && isIdentity(code)) {
      parsed.identity = title;
      parsed.identitySet = packName(packs, card.pack_code);
    } else parsed.entries.push({ title, count, set: card ? packName(packs, card.pack_code) : undefined });
  }
  const r = resolveImport(parsed);
  return {
    id: dl.id,
    url: `https://netrunnerdb.com/en/decklist/${dl.uuid}`,
    name: dl.name,
    date: dl.date_creation.slice(0, 10),
    author: dl.user_name,
    mwl: dl.mwl_code,
    identity: parsed.identity,
    playable: r.playable,
    legal: r.playable && r.problems.length === 0,
    problems: r.problems,
    missing: r.missing,
  };
});

const shown = flag('playable') ? results.filter(r => r.playable) : results;
shown.sort((a, b) => Number(b.playable) - Number(a.playable) || a.missing.length - b.missing.length || a.date.localeCompare(b.date));
console.log(`\nOur sets: ${CARD_SETS.map(s => s.name).join(', ')}`);
console.log(`Checked ${results.length} of ${decklists.length} decklists; ${results.filter(r => r.playable).length} fully playable, ${results.filter(r => r.legal).length} also legal.\n`);
for (const r of shown) {
  const head = r.playable ? (r.legal ? 'PLAYABLE' : 'PLAYABLE (not legal)') : `MISSING ${r.missing.reduce((n, m) => n + m.count, 0)}`;
  console.log(`${head.padEnd(20)} ${r.date} ${r.name} by ${r.author} (${r.identity ?? 'no identity'})\n${' '.repeat(21)}${r.url}`);
  if (r.playable && !r.legal) console.log(`${' '.repeat(21)}${r.problems.join('; ')}`);
  for (const g of groupMissingBySet(r.missing)) {
    console.log(`${' '.repeat(21)}${g.set}: ${g.cards.map(m => `${m.count}x ${m.title}`).join(', ')}`);
  }
}

// Which set would unlock the most decks
const startDate = released(packs.find(p => p.code === 'sg')!);
const candidates =
  list('candidates') ?? packsByDate.filter(p => !IMPLEMENTED_PACKS.has(p.code) && released(p) >= startDate && p.date_release).map(p => p.code);
const gaps: DeckGap[] = results.map(r => ({ id: String(r.id), missing: r.missing }));
const ranking = rankSetsToUnlock(gaps, printings, candidates, packsByDate.map(p => p.code));
const label = (id: string) => results.find(r => String(r.id) === id)!.name;

console.log('\nSets that would make decks fully playable, each set alone:');
for (const a of ranking.alone.filter(a => a.copies > 0)) {
  console.log(`  ${packName(packs, a.pack).padEnd(28)} ${String(a.unlocked.length).padStart(3)} decks, ${a.copies} missing copies`);
}
console.log('\nBest order (greedy, ties go to the older set):');
for (const s of ranking.order) {
  console.log(`  + ${packName(packs, s.pack).padEnd(26)} +${s.unlocked.length} decks (${s.playableAfter} playable)${s.unlocked.length ? ': ' + s.unlocked.map(label).join(', ') : ''}`);
}
if (ranking.unreachable.length) {
  console.log(`\n${ranking.unreachable.length} decks need cards outside the candidate sets: ${ranking.unreachable.map(label).join(', ')}`);
}

const out = opt('json');
if (out) {
  fs.writeFileSync(out, JSON.stringify({ results, ranking }, null, 2));
  console.log(`\nWrote ${out}`);
}
