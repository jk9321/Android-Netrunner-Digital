// Which Corp decks of the pool can put trash-subroutine ice on one server (AI Coordinator, ai-hold-trash stop, item c):
// the beta picker's decks (one per identity) and the two starters, each ice whose printed subroutines the walk reads as
// "trash 1 installed X" (runs.ts subroutineFacts), with its copies. Thunderbolt Armaments' "unless the Runner trashes"
// is the Runner's choice, not the Corp's, and is not counted.
//   npx vite-node scripts/stage-d/trash-decks.ts
import { ALL_CARDS } from '../../src/core/cards';
import { STARTER_DECKS, betaDefaultDecks, deckCodes } from '../../src/data/decks';
import { subroutineFacts } from '../../src/ai/runs';

const byCode = new Map(ALL_CARDS.map(c => [c.code, c]));
const trashKinds = (code: string): string[] => {
  const c = byCode.get(code) as { type_code?: string; text?: string } | undefined;
  if (c?.type_code !== 'ice') return [];
  const subs = (c.text ?? '').split('\n').filter(l => l.includes('[subroutine]')).map(l => l.replace(/<[^>]+>/g, '').replace(/^.*\[subroutine\]\s*/, ''));
  return subs.flatMap(s => subroutineFacts(s).does.flatMap(e => (e.kind === 'trashInstalled' ? [e.what] : [])));
};
const decks = [...STARTER_DECKS, ...betaDefaultDecks().filter(d => !STARTER_DECKS.some(s => s.id === d.id))].filter(d => d.side === 'corp');
let two = 0, three = 0;
for (const d of decks) {
  const counts = new Map<string, number>();
  for (const code of deckCodes(d).cards) if (trashKinds(code).length) counts.set(code, (counts.get(code) ?? 0) + 1);
  const copies = [...counts.values()].reduce((a, b) => a + b, 0);
  if (copies >= 2) two++;
  if (copies >= 3) three++;
  const list = [...counts].map(([code, n]) => `${n}x ${(byCode.get(code) as { title: string }).title} (${[...new Set(trashKinds(code))].join(', ')})`);
  console.log(JSON.stringify({ deck: d.id, identity: d.identity, trashIce: copies, list }));
}
console.log(`${decks.length} Corp decks: ${two} hold 2 or more trash-subroutine ice, ${three} hold 3 or more`);
