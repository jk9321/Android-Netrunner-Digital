import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Refreshes the card data the game reads (src/data/*.json) from NetrunnerDB.
// Card images aren't downloaded: the app loads them from NetrunnerDB at runtime.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'src', 'data');

// file in src/data → the pack codes it holds (Liberation is two packs)
const SETS = {
  'system-gateway-cards.json': ['sg'],
  'elevation-cards.json': ['elev'],
  'vantage-point-cards.json': ['vp'],
  'liberation-cards.json': ['tai', 'rwr'],
};

console.log('Fetching card data from NetrunnerDB...');
const response = await fetch('https://netrunnerdb.com/api/2.0/public/cards');
if (!response.ok) {
  throw new Error(`Failed to fetch cards: ${response.statusText}`);
}
const allCards = (await response.json()).data;

// Same shape as the committed files: faction_cost 0 when absent, keys sorted
const normalize = card =>
  Object.fromEntries(Object.entries({ ...card, faction_cost: card.faction_cost ?? 0 }).sort(([a], [b]) => (a < b ? -1 : 1)));

for (const [file, packs] of Object.entries(SETS)) {
  const pack = packs.join('+');
  const cards = allCards.filter(c => packs.includes(c.pack_code)).map(normalize);
  if (cards.length === 0) throw new Error(`No cards found for pack ${pack}; not overwriting ${file}`);
  const filePath = path.join(DATA_DIR, file);
  fs.writeFileSync(filePath, JSON.stringify(cards, null, 2), 'utf-8');
  console.log(`Saved ${cards.length} ${pack} cards to ${path.relative(process.cwd(), filePath)}`);
}
