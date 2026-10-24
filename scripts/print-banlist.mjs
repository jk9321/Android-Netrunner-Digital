// Prints NetrunnerDB's ban lists as titles, ready to paste into src/core/formats.ts.
// Usage: node scripts/print-banlist.mjs [list-code-substring]
// With no argument it prints the newest Startup and Standard lists.
const get = async url => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return (await res.json()).data;
};

const [lists, cards] = await Promise.all([
  get('https://netrunnerdb.com/api/2.0/public/mwl'),
  get('https://netrunnerdb.com/api/2.0/public/cards'),
]);
const byCode = new Map(cards.map(c => [c.code, c]));
const filter = process.argv[2];
const newest = prefix => lists.filter(l => l.code.startsWith(prefix)).sort((a, b) => a.date_start.localeCompare(b.date_start)).at(-1);
const chosen = filter ? lists.filter(l => l.code.includes(filter)) : [newest('startup'), newest('standard')].filter(Boolean);

for (const list of chosen) {
  console.log(`\n// ${list.name} (${list.code}), effective ${list.date_start}`);
  const titles = { banned: new Set(), restricted: new Set() };
  for (const [code, rule] of Object.entries(list.cards)) {
    const card = byCode.get(code);
    if (!card) continue;
    if (rule.deck_limit === 0) titles.banned.add(card.title);
    if (rule.is_restricted) titles.restricted.add(card.title);
  }
  for (const [kind, set] of Object.entries(titles)) {
    if (set.size === 0) continue;
    console.log(`${kind}: [`);
    for (const t of [...set].sort()) console.log(`  ${JSON.stringify(t)},`);
    console.log('],');
  }
}
