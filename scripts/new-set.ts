/**
 * New card set scaffold (new-set process steps 1 to 4, docs/new-card-set.md).
 *
 *   npx vite-node scripts/new-set.ts -- <slug> <cards.json> [--write]
 *
 * <slug>: the set's folder name, camelCase (e.g. `vantagePoint`). <cards.json>: the set's card data, as
 * `npm run sync-cards` writes it (add the set to SETS in scripts/sync-cards.mjs first).
 *
 * Without --write it only prints the plan. With --write it creates, and never overwrites:
 * - src/core/scripts/<slug>/<side>/<type>.ts: one stub per card, its text as a comment. A stub is
 *   `unfinished`, so tests/cardCoverage.test.ts fails until every card is scripted.
 * - src/core/scripts/<slug>/index.ts: the set's script groups, to add to SCRIPT_GROUPS in scripts/index.ts.
 * - tests/<slug>Corp.test.ts and tests/<slug>Runner.test.ts: one it.todo per card (a todo doesn't count
 *   as a test of the card).
 * Then it prints the keywords the hover tooltips don't know yet, the cards that need AI entries in
 * src/ai/cards/<slug>.ts (written by an ai-* branch thread), and the wiring still to do by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GLOSSARY, keywordsIn } from '../src/ui/glossary';

interface RawCard {
  code: string;
  title: string;
  side_code: 'corp' | 'runner';
  type_code: string;
  keywords?: string;
  text?: string;
  pack_code: string;
}

const args = process.argv.slice(2).filter(a => a !== '--');
const write = args.includes('--write');
const [slug, file] = args.filter(a => !a.startsWith('--'));
if (!slug || !file || !/^[a-z][A-Za-z0-9]*$/.test(slug)) {
  console.error('Usage: npx vite-node scripts/new-set.ts -- <camelCaseSlug> <cards.json> [--write]');
  process.exit(1);
}
const ROOT = path.resolve(__dirname, '..');
const cards: RawCard[] = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

const camel = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, c => c.toLowerCase())
    .replace(/^(\d)/, '_$1');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const plain = (html = '') => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
/** Wraps card text into `// ` comment lines of about 100 characters. */
function comment(text: string): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '//';
  for (const w of words) {
    if (line.length + w.length + 1 > 100) {
      lines.push(line);
      line = '//';
    }
    line += ` ${w}`;
  }
  lines.push(line);
  return lines.join('\n');
}

const TYPE_FILE: Record<string, string> = {
  ice: 'ice', asset: 'assets', upgrade: 'upgrades', agenda: 'agendas', operation: 'operations', identity: 'identities',
  program: 'programs', hardware: 'hardware', resource: 'resources', event: 'events',
};
const groups = new Map<string, RawCard[]>();
for (const c of cards) {
  const key = `${c.side_code}/${TYPE_FILE[c.type_code] ?? c.type_code}`;
  groups.set(key, [...(groups.get(key) ?? []), c]);
}

const created: string[] = [];
const skipped: string[] = [];
function writeNew(rel: string, content: string) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) return skipped.push(rel);
  if (!write) return created.push(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  created.push(rel);
}

const groupNames: string[] = [];
for (const [key, list] of [...groups].sort()) {
  const [side, kind] = key.split('/');
  const exportName = `${slug}${cap(side)}${cap(kind)}Scripts`;
  groupNames.push(`${exportName}`);
  const names = new Map(list.map(c => [c.code, camel(c.title)]));
  const body = list
    .map(c => {
      const header = `${c.title}${c.keywords ? ` (${c.keywords})` : ''}: ${plain(c.text) || '(no text)'}`;
      return `${comment(header)}\nconst ${names.get(c.code)}: CardScript = unfinished('${c.code}');\n`;
    })
    .join('\n');
  writeNew(
    `src/core/scripts/${slug}/${key}.ts`,
    `import { CardScript } from '../../types';\nimport { unfinished } from '../../steps';\n\n${body}\nexport const ${exportName}: Record<string, CardScript> = {\n${list.map(c => `  '${c.code}': ${names.get(c.code)},`).join('\n')}\n};\n`,
  );
}
writeNew(
  `src/core/scripts/${slug}/index.ts`,
  `${[...groups.keys()].sort().map((key, i) => `import { ${groupNames[i]} } from './${key}';`).join('\n')}\n\n/** The ${slug} script files, for SCRIPT_GROUPS in src/core/scripts/index.ts. */\nexport const ${slug}ScriptGroups = {\n${groupNames.map(n => `  ${n},`).join('\n')}\n};\n`,
);
for (const side of ['corp', 'runner'] as const) {
  const list = cards.filter(c => c.side_code === side);
  if (!list.length) continue;
  writeNew(
    `tests/${slug}${cap(side)}.test.ts`,
    `import { describe, it } from 'vitest';\n\n// One test per card (new-set process step 3): replace each todo with a test that names the card by its code.\ndescribe('${slug}: ${side}', () => {\n${list.map(c => `  it.todo(${JSON.stringify(`${c.code} ${c.title}`)});`).join('\n')}\n});\n`,
  );
}

// Keywords the hover tooltips don't mark yet: "Word N" keywords (Threat 3, Sabotage 2), and subtypes
const known = (term: string) => keywordsIn(term).length > 0 || Object.values(GLOSSARY).some(g => g.term.toLowerCase() === term.toLowerCase());
/** Sentence-starting verbs that "Word N" also catches (Gain 2, Draw 1). */
const VERBS = new Set(
  'Gain Draw Place Remove Prevent Limit Install Trash Do Look Lose Take Give Reveal Add Pay Spend Search Shuffle Choose Access Break Bypass Load Move Derez Rez Advance Score Steal Forfeit Purge Runner Corp Host Swap Name Play Turn Expose Return Deal Suffer Increase Reduce Count Resolve Use Ice Each Hosted'.split(' '),
);
const unknownKeywords = new Map<string, string[]>();
const unknownSubtypes = new Map<string, string[]>();
const note = (into: Map<string, string[]>, term: string, card: RawCard, phrase = term) => {
  if (!known(phrase)) into.set(term, [...(into.get(term) ?? []), card.title]);
};
for (const c of cards) {
  for (const m of plain(c.text).matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?) (\d+|X)\b/g)) if (!VERBS.has(m[1].split(' ')[0])) note(unknownKeywords, m[1], c, m[0]);
  for (const k of (c.keywords ?? '').split(/\s+-\s+/).filter(Boolean)) note(unknownSubtypes, k, c);
}
const listTerms = (m: Map<string, string[]>) =>
  [...m].map(([t, on]) => `  ${t}: ${on.slice(0, 3).join(', ')}${on.length > 3 ? `, +${on.length - 3}` : ''}`).join('\n') || '  none';

console.log(`${cards.length} cards (${cards.filter(c => c.side_code === 'corp').length} Corp, ${cards.filter(c => c.side_code === 'runner').length} Runner), packs ${[...new Set(cards.map(c => c.pack_code))].join(', ')}`);
console.log(`\n${write ? 'Created' : 'Would create (run with --write)'}:\n${created.map(f => `  ${f}`).join('\n') || '  nothing'}`);
if (skipped.length) console.log(`Already there, left alone:\n${skipped.map(f => `  ${f}`).join('\n')}`);
console.log(`\nStep 2, keywords the tooltips (src/ui/glossary.ts) don't know yet; check each against the rules:\n${listTerms(unknownKeywords)}`);
console.log(`Subtypes they don't know (most need no tooltip; add one where the rules give it meaning):\n${listTerms(unknownSubtypes)}`);
console.log(`\nStep 4, AI entries (src/ai/cards/${slug}.ts, on an ai-* branch): all ${cards.length} cards; ice that gains subroutines when encountered needs gainsOnEncounter.`);
console.log(`\nWiring by hand:
  scripts/sync-cards.mjs SETS, src/core/cards.ts (import + ALL_CARDS + CARD_SETS),
  src/core/scripts/index.ts: import { ${slug}ScriptGroups } from './${slug}' and spread it into SCRIPT_GROUPS.
Then: npm test (cardCoverage lists every unfinished card), the blind rules tests thread (step 3b), formats (step 5).`);
