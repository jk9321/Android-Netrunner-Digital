# Blind rules tests

Written on 2026-11-08 from the card text (`src/data/*-cards.json`) and the
Comprehensive Rules v26.03 only, without reading the card scripts
(`src/core/scripts/**`) or the cards' existing tests. Each test cites the rules
it checks. The point is a second, independent reading of the cards: where a
test and the engine disagreed, the code was read afterwards and the rulebook
decided which one was wrong.

Cards (38): System Gateway: Verbal Plasticity, Docklands Pass, Mayfly, Luminal
Transubstantiation, Seamless Launch, Ping, Send a Message, Palisade, Diviner,
Urtica Cipher, AMAZE Amusements, Tomorrow's Headline, Funhouse, Hansei Review,
Manegarm Skunkworks, Pharos, Karunā, Tranquilizer, Jailbreak, Weyland
Consortium: Built to Last. Elevation: Shred, Scatter Field, Byte!, Lamplighter,
Semak-samun, Magdalene Keino-Chemutai, Project Ingatan, Biawak, Greenmail.
Vantage Point: Méliès City Luxury Line, Magistrate Revontulet, Flagship,
Vertigo, Let Them Dream, Word on the Street, Myōshu, Reverb, Vicsek.
Liberation: Fujii Asset Retrieval, Hammer, Wage Workers, Daniela Jorge Inácio,
Salvo Testing, Sacrifice Zone Expansion, Capacitor, Phoneutria.

`it.fails` marks a test that pins a known engine bug: it passes while the bug
is there. When the bug is fixed the test fails; change `it.fails` back to `it`.
Known bugs: none open. Fixed 2026-11-08 (main 61abd52): Urtica Cipher did its
damage when accessed in HQ or R&D (rules 9.3.2c), and "when you rez this ice
during a run against this server" skipped free rezzes (rules 8.1.2b).

`util.ts` has the drivers: `drive` plays a run out answering prompts,
`accessedSince` lists the accessed cards from the log.
