# New card set process

Moved verbatim out of `CLAUDE.md` (2026-11-26, to cut what every thread reads each turn). Read it before you plan, script, test or balance a new card set. The card-script rules in step 3 also apply to any thread that scripts a card.

## New card set process (Standard sets, newest first, on beta)
When (Jeff 2026-11-22, replaces "alongside tuning"): after the Runner rework, SET - ROUND - SET - ROUND until all wanted cards are in. The next set is scripted on its own branch during a learned round and merges to beta only at a round boundary; then the baselines are re-run and the next round starts from the earlier learned numbers. Early-round win rates don't compare across card-pool changes; one or two final rounds with every set in give the real read. Then the level-ups (wider search, work budget, hold-count cap; Corp and Runner together), each followed by a short re-learn round.
0. Once, before the first new set (Jeff 2026-11-22): generic run/turn flags. Card-specific fields on RunState/CardScript (`meliesServer`, `shredArmed`, `redirectToHq`, ...) move to keyed flags/modifiers (`TurnFlag`, `CardModifiers`); new cards add keys, not fields. FULL review tier (engine). Card facts in one place is the Runner rework's stage R-A.
1. Pull card data and image links from NetrunnerDB.
2. Add new keywords to the hover tooltips.
3. Implement every card with its own unit test (plus liveValue/revealInHand); check errata.
   Start from `npx vite-node scripts/new-set.ts` (stubs, test todos, unknown keywords). Card scripts live in `src/core/scripts/<set>/{corp,runner}/<type>.ts`; a card with prompts declares its steps with `prompts()` (`src/core/scripts/steps.ts`) and asks only through that flow (`tests/steps.test.ts` fails on a hand-written `onPromptAnswer` or a raw step string).
3b. In a separate thread, blind rules tests with the `blind-rules-tests` skill (`.claude/skills/blind-rules-tests/SKILL.md`): 20-30 tricky cards tested from card text and the rules only, without reading the card code; real bugs go to the rules-bugs thread.
4. AI data: one entry per card in `src/ai/cards/<set>.ts`; re-tag older cards that interact. Ice that gains subroutines when encountered (Starlit Knight) needs a `gainsOnEncounter` entry, or the Runner AI prices the run against the printed subroutines only.
5. Startup/Standard legality and ban lists.
6. Make the AI use the new cards and identities: sample real NetrunnerDB decks (test-only), run `scripts/deck-playability.ts`, add one beta picker deck per new identity. Check optional "you may X now for Y later" prompts.
7. Balance with AI self-play, read in the final rounds with every set in: Corp 50 ± 5%.
