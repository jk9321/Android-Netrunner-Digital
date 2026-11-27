/** F119 step 1: the card list's self-check against the card data (card-list.ts). npx vite-node scripts/f119-punisher-field/list-check.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CARD_LIST, FILLED } from './card-list';

// ---------------------------------------------------------------- the self-check (run as a script)
async function check() {
  const { readFileSync, readdirSync } = await import('node:fs');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  let bad = 0;
  const seen = new Set<string>();
  for (const f of readdirSync('src/data').filter(x => x.endsWith('-cards.json'))) {
    const raw = JSON.parse(readFileSync(`src/data/${f}`, 'utf8'));
    const cards: any[] = Array.isArray(raw) ? raw : Array.isArray(raw.cards) ? raw.cards : Object.values(raw.cards ?? raw);
    for (const c of cards) {
      const text: string = c.stripped_text ?? '';
      if (c.side_code !== 'corp' || !/\btag/i.test(text)) continue;
      seen.add(c.code);
      const l = CARD_LIST[c.code];
      if (!l) {
        bad++;
        console.log(`STOP: ${c.code} ${c.title} names a tag and is not listed: ${text.slice(0, 120)}`);
        continue;
      }
      if (l.kind === 'filled' && norm(l.text ?? '') !== norm(text)) {
        bad++;
        console.log(`STOP: ${c.code} ${c.title}: the quote differs from the card data\n  list: ${l.text}\n  data: ${text}`);
      }
    }
  }
  for (const k of Object.keys(CARD_LIST))
    if (!seen.has(k)) {
      bad++;
      console.log(`STOP: ${k} ${CARD_LIST[k].title} is listed but its text names no tag`);
    }
  const by: Record<string, number> = {};
  for (const v of Object.values(CARD_LIST)) by[v.kind] = (by[v.kind] ?? 0) + 1;
  console.log(`card list: ${Object.keys(CARD_LIST).length} Corp cards with "tag" in the text (${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ')}); ${bad} stops`);
  for (const c of FILLED) console.log(`  ${c} ${CARD_LIST[c].title} [${CARD_LIST[c].group}]: "${CARD_LIST[c].text}"\n      -> ${CARD_LIST[c].field}`);
  if (bad) process.exit(1);
}
void check();
