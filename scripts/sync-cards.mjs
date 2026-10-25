import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Refreshes the card data the game reads (src/data/*.json) from NetrunnerDB.
// Card images aren't downloaded: the app loads them from NetrunnerDB at runtime.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'src', 'data');

// pack_code → file in src/data
const SETS = {
  sg: 'system-gateway-cards.json',
  elev: 'elevation-cards.json',
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

for (const [pack, file] of Object.entries(SETS)) {
  const cards = allCards.filter(c => c.pack_code === pack).map(normalize);
  if (cards.length === 0) throw new Error(`No cards found for pack ${pack}; not overwriting ${file}`);
  const filePath = path.join(DATA_DIR, file);
  fs.writeFileSync(filePath, JSON.stringify(cards, null, 2), 'utf-8');
  console.log(`Saved ${cards.length} ${pack} cards to ${path.relative(process.cwd(), filePath)}`);
}
