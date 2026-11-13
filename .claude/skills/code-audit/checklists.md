# Audit checklists

Use the sections that match the scope (all of them for a full audit). Each item says what to look for and how
to find it quickly. A checked item with nothing found goes in the report's "Checked, clean" list.

## A. Rules engine (`src/core/engine/**`, `src/core/scripts/**`)

- **Rule citations.** Every rules-relevant change since the last audit cites a rule number (commit message or
  test). `git log --since=<last audit> --format='%h %s' -- src/core` and look for ones that change behaviour
  without one. Spot-check 5-10 cited rules against the PDF: does the code do what the rule says?
- **Card text vs implementation.** For each card in scope, read `stripped_text` in `src/data/*-cards.json`
  and its script; check costs, "may" vs mandatory, timing (when/after/each time), once-per-turn limits,
  trash cost, strength, subroutine order, and errata. Optional "you may X now for Y later" must be a real
  choice, not auto-resolved.
- **Generic engine, specific scripts.** Card codes or titles named in `src/core/engine/**` (metrics
  `cardCodeSpecialCases`) are special cases that belong in `src/core/scripts/` or a general mechanism.
- **Timing windows.** Paid ability windows (5.6.1b exists, 5.7.1b not added), rez windows, Movement Phase
  (6.9.4), access order (7.3.4). Known deliberate skips: 6.9.1e, 5.6.3b, 5.7.2b; don't report them again.
- **State discipline.** Nothing mutates a state after `isLegalAction`/`getLegalActions` (WeakMap cache); tests
  edit a `structuredClone`. `inst-N` numbering in `gameState.ts` unchanged. Engine stays pure and deterministic
  (`tests/enginePurity.test.ts`, `tests/determinism.test.ts` still cover new code paths: RNG only through
  `src/core/rng.ts`, no `Math.random`, `Date.now` in engine or AI decisions).
- **Coverage of new cards.** Every card in a set has its own unit test (`tests/<set>*.test.ts`) plus liveValue
  and revealInHand entries. Count cards in the set JSON vs cards with tests; list the missing ones.

## B. Hidden information (single player now, multiplayer next)

- **Log and UI text** never names a facedown/unrezzed card, an HQ card, or R&D order to the wrong side (past
  bug: "Corp could not install X"). Grep log calls in actions for `.title` on cards that may be hidden.
- **Prompts** show only what the prompted side may see (past bug: Tāo Salonga showed unrezzed ice face up).
- **Pacing tells**: a pause, handoff or window that opens only when the Corp can act leaks information (past
  bug: corpRezWindow). AUTO paid windows are an accepted tell (Jeff, like MTGA); don't report that one.
- **AI fairness**: Normal never reads hidden identity (may use the opponent's decklist). Hard Runner knowing
  its own draw order is kept on purpose. Look for AI code reading `state.corp.hand`, `deck`, facedown cards'
  `code` from the Runner side without going through the view the side is allowed.
- **Multiplayer views** (`src/core/view.ts`, `src/ui`): every field of the per-player view is either public
  or owned by that player; new GameState fields added since the last audit are classified in the view (a field
  added to state but not to the view's redaction is the classic leak). Bug-report payloads, saved games and
  anything a server would send must use the view, not the raw state.

## C. AI (`src/ai/**`, `scripts/*` batch tools)

- **Plan switches.** From metrics `plan`: switches defined but never read (dead), folded names still read
  (should be zero), switches read once (candidate for folding). Each OFF switch has a reason in
  `tests/codeHealth.test.ts` OFF_SWITCHES and a recent batch behind it; flag OFF switches with no batch in
  `docs/ai-batch-log.md` for 2+ weeks. Folded names must THROW in `PLAN_OFF`/`planWith` (`src/ai/synergy.ts`).
- **One entry per card.** Per-card data lives in one entry in `src/ai/cards/<set>.ts`, joined in `index.ts`.
  Card codes in shared value files (metrics `cardCodeSpecialCases`, and the `CODES_IN_VALUE_FILES` list in
  `tests/codeHealth.test.ts`) may only shrink. Codes growing in `prompts.ts`/`runs.ts` are allowed (prompt
  answers, break plans, run options live there) but check each new one is card-specific by nature, not a patch.
- **Whack-a-mole.** For each AI fix since the last audit, ask: did it fix a symptom in one layer (rule
  ranking, planner leaf, overrides, safety gates) that another layer also handles? Are there `-Infinity`
  gates that hide moves from the planner? Is the same situation priced in two places?
- **Parallel implementations.** The same quantity (rez money, income slide, steal odds, draw worth, click
  price, agenda pace) computed in more than one function. Grep for the concept name and its synonyms.
- **Caches and memo keys.** Every memo/WeakMap/Map cache: is everything the result depends on in its key
  (side, plan/pricing context, difficulty, known info)? `memo()` has no in-progress guard (cycles). Module-level
  `let` is pricing state only via `pricing.ts` (`MODULE_LETS` in codeHealth may only shrink).
- **Measured constants.** Rates measured from batches (STEAL, AGENDA_RUN, PAYOUT_RISK, PACE, run shares):
  how many AI commits since each was measured? Flag ones measured before a big behaviour change.
- **New cards in the AI.** Every card in a new set has an AI entry (values, synergy tags, profiles, effect
  formulas, counter worths as needed) and the older cards it interacts with were re-tagged. A new identity
  appears in a beta picker deck and in batch decks (`scripts/deck-playability.ts`).
- **Balance claims.** Corp win rate 50 ± 5% claims cite a logged batch (`scripts/batch-log.mjs`) with games
  and SE. A merged switch with no paired batch is a finding.
- **Speed.** Per-decision time at Hard (target ~1.0 s/decision) and per-game batch time; note regressions
  against the previous audit's numbers if they were recorded.

## D. Data, decks, formats, main vs beta

- `main` ships only the two System Gateway starters in `src/data/decks.ts`. Test decks (`src/data/testDecks/`)
  and `src/beta/**` load only behind `__ALL_DECKS__`/`__BETA_TOOLS__` (metrics `betaImportsOutsideFlags`
  must be empty). For a full audit, also build main (`npm run build`) and grep `dist/` for a test-deck name or
  `BulkImport` to prove they were tree-shaken out.
- Beta picker: exactly one deck per identity; every identity in the card data has one.
- Formats and ban lists (`src/core/formats.ts`) match NSG's current lists (`node scripts/print-banlist.mjs`);
  new sets are Startup/Standard-legal where they should be; `validateDeck` rules cite 1.4.x.
- Card data: every code in code/tests resolves (metrics `unknownCardCodes` empty); images load from
  card-images.netrunnerdb.com; NSG and NetrunnerDB credited in the UI and README.

## E. UI (`src/ui/**`)

- Jeff's standing rules: no scanlines, no dot grid; tap-to-inspect on touch devices only; mouse behaviour does
  not depend on window width; fonts not shrunk below the bumped sizes. Grep for `scanline`, `repeating-linear`,
  `radial-gradient` dot patterns, `innerWidth`/`matchMedia('(max-width` driving pointer behaviour, `text-xs`.
- Components over ~250 lines (metrics `largestFunctions`) mixing game logic with rendering; game rules
  decided in UI code instead of the engine's legal actions.
- `eslint-disable` of `react-hooks/exhaustive-deps` (metrics) each with a reason.

## F. Tests and tooling

- **Gaps**: new modules/functions with no test that exercises them; scenario tests pinning each human-usable
  AI hole Jeff reported; rules fixes with a test naming the rule.
- **Slow tests**: from the vitest JSON, the 15 slowest tests and any over 30 s; past CI failures came from AI
  tests hitting timeouts. Suggest cheaper fixtures, not bigger timeouts.
- **Weak tests**: tests that only check "doesn't throw", snapshot tests nobody reads, skipped tests (metrics),
  tests that pass with the feature switched off.
- **Flaky**: e2e timing tests (`e2e/handSpread.e2e.ts` was flaky on CI). Check the last ~10 CI runs.
- **Tooling pins**: `vite-node` stays 3.2.4 until vite is upgraded; CI runs typecheck, lint, test on main and
  beta; hooks in `.claude/settings.json` still work (guard-ai-dir, ci-after-push).

## G. Drift and sprawl (full audits; the "vibe coding" check)

- **Size trend**: metrics diff per area. Growth with no new features behind it is sprawl.
- **Escape hatches**: `any`, `@ts-ignore`, `eslint-disable`, empty `catch`, non-null `!` chains on state.
  Each new one since last audit gets a look.
- **Docs vs code**: claims in `CLAUDE.md`, `PROJECT_STATUS.md`, file header comments and project memory
  that are no longer true (renamed files, folded switches still described as switchable, removed scripts).
- **Comments**: comments that narrate history or a thread's reasoning instead of what the code does now, and
  comments that contradict the code beneath them.
- **Copy-paste**: near-identical blocks across card scripts or AI files that should share a helper (look in
  the largest files first). Exported functions with the same name in two files.
- **Dead code**: exports nobody imports, scripts in `scripts/` nobody runs, test helpers unused.
- **Branches**: merged branches are deleted by the nightly cleanup action, so don't list them for Jeff. Only
  report abandoned or parked branches with unmerged commits (`git branch -r --no-merged origin/beta`) that need
  his decision.

## H. Security and hosting (`worker/**`, `wrangler.jsonc`)

- No secrets or tokens in the repo or in `vite.config.ts` defines (`git grep -nE 'ghp_|github_pat_|sk-|token'`).
- `/api/bug-report` (uses the `GITHUB_TOKEN` secret): input size limits, rate limiting/abuse, no raw state
  that leaks the other side once multiplayer exists.
- `npm audit --omit=dev` for shipped dependencies; note high/critical only.
