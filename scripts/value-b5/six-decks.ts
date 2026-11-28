// B5: which Runner decks of the two batch pools hold one of the six cards (local helper for the batch read).
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
const SIX = ['Solidarity Badge', 'Eru Ayase-Pessoa', 'Hannah "Wheels" Pilintra', 'Arruaceiras Crew', 'Friend of a Friend', 'Borrowed Goods'];
for (const d of [...ALL_DECKS, ...NRDB_TEST_DECKS] as { side: string; name: string; cards: Record<string, number> }[])
  if (d.side === 'runner') console.log(JSON.stringify({ name: d.name, six: SIX.filter(x => x in d.cards) }));
