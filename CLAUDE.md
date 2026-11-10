# CLAUDE.md

Android: Netrunner digital game (React + TypeScript + Vite, Cloudflare Worker hosting). Free and non-commercial; credit Null Signal Games (NSG) and NetrunnerDB. Public repo: github.com/jk9321/Android-Netrunner-Digital. Use the account name `jk9321` everywhere.

## Working style
- Act as a colleague, not a yes-man: push back when something looks wrong.
- Jeff does not work from a local clone. Never tell him to run git commands or `git pull`; say "refresh the site".
- Never write secrets or tokens into the repo.

## Branches
- Small fixes and finished work go straight to `main` (no PR per fix), then merge `main` into `beta`.
- `beta` holds ALL new AI work and all new card sets. Jeff bug-tests it on the beta Cloudflare preview. Beta merges to `main` only when Jeff says so.
- Larger work Jeff will test first goes on a named feature branch (Cloudflare builds a preview per branch).
- Never push throwaway `claude/*` branches.
- Threads cannot delete remote branches (GitHub returns 403). When a branch you pushed is merged or abandoned, tell Jeff its name so he can delete it.
- Threads with clones from before 2026-10-23 must reset to current history, never push old history.

## Rules correctness
- Check EVERY rules change against the comprehensive rules PDF and cite the rule number in the commit/test: `Netrunner/Resources/Rulebook/Null_Signal_Games_Netrunner_Comprehensive_Rules_v26.03.pdf` (project files, `/mnt/project-files/`).
- Rules bugs from playtesting: quote the rule first, then fix, then add a test.

## Commands
- `npm test` (vitest run), `npm run lint` (eslint), `npm run typecheck` (tsc --noEmit), `npm run build` (tsc && vite build), `npm run test:e2e` (Playwright smoke).
- CI (`.github/workflows/ci.yml`) runs typecheck, lint and test on main and beta. Run all three before pushing.
- Gate: `.claude/hooks/gate-main-beta.mjs` (PreToolUse) blocks `git commit` on main/beta and `git push` to main/beta until `node .claude/hooks/fast-checks.mjs` passes (typecheck + lint + unit tests minus the slow AI files, 25-40 s; a passed tree is stamped so the push after a commit doesn't re-run). Push as its own command, not after a checkout/merge in the same line. GitHub MCP file writes to main/beta are blocked: use git. The slow tests and e2e stay in CI. Don't work around the gate; fix what it reports.
- After every push to `main` or `beta`, check that push's CI run yourself (a PostToolUse hook, `.claude/hooks/ci-after-push.mjs`, reminds you) and fix failures before finishing; don't wait for Jeff to report them. Ignore `ai-batch-results` and other branch builds.
- vitest 5 and eslint 10. `vite-node` is pinned at 3.2.4 on purpose: the AI batch scripts (`npx vite-node scripts/*.ts`) need it; don't bump it until vite itself is upgraded.
- Card data: `npm run sync-cards`. Ban lists: `node scripts/print-banlist.mjs`.
- Never mutate a game state after `isLegalAction`/`getLegalActions` (legality is cached per state in a WeakMap); tests edit a `structuredClone`.
- Don't change the `inst-N` instance numbering in `src/core/engine/gameState.ts`.

## AI work
- Guard: `.claude/hooks/guard-ai-dir.mjs` (PreToolUse, `.claude/settings.json`) blocks Edit/Write and obvious shell writes under `src/ai/**` unless the git branch starts with `ai-`. Don't work around it; ask the coordinator for an ai-* branch thread.
- Goes through the Fable "AI Coordinator" thread for spec and review. Opus threads implement. Nothing merges to beta without its review.
- Goal is playing strength, not matching Jeff's moves. Corp win rate should sit around 50 ± 5%.
- Counted decisions (Jeff 2026-11-10): a decision made by counting (`plan.scoreNow`, `plan.scoreInTwo`, and the ones that follow) is fixed by changing an INPUT to its count (what holds a server, the Runner's capability, the reserve), never by adding a bonus or penalty value term on top. After each counted decision ships, delete the value terms it made redundant, so the levers stay few and visible.
- Behaviour is controlled by switches in `tuning.plan`. Folded switch names THROW when passed in `PLAN_OFF` (see `src/ai/synergy.ts`).
- Per-card AI data (synergy tags, values, profiles, effect formulas, counter worths) lives in ONE entry per card in `src/ai/cards/<set>.ts`, joined in `src/ai/cards/index.ts`. Prompt answers, break plans and run options stay in `prompts.ts` / `runs.ts`.
- Batches run on GitHub Actions: `.github/workflows/ai-batch.yml` (ref = branch name or full 40-char SHA). Use paired batches: run the base first, then pass its run id as `base_run`; compare with `scripts/corp-losses-sum.mjs`. Log every batch with `scripts/batch-log.mjs`.
- Batch sizes (Jeff 2026-11-07: the repo runs at most 20 Actions jobs at once, a full batch is ~600 runner-minutes): "expect identical" checks use `games=1` (any difference shows); win-rate tests start at `games=3` and top up to 10 (`game_from=3`, `add_run`) only when the result is within about 2 SE of the gate. Launch at most 2-3 batches at a time.
- Self-play hides holes. Pin human-usable holes with scenario tests.
- Human-games fixtures: `tests/fixtures/human-games/report-N.json` (decode bug reports with `scripts/bug-report-state.mjs`); score with `npx vite-node scripts/human-agreement.ts`.
- Branch-build failures on `ai-batch-results` are harmless noise.

## Hand-off and review
- Any branch a coordinator (AI or Multiplayer) or reviewer will check: hand off with the `handoff` skill (`.claude/skills/handoff/SKILL.md`): fixed template, evidence generated by `evidence.mjs` (diff stat vs base, files vs the spec's allowed list, diff signals, real check output), deviations listed. A prose summary is not a hand-off.
- Coordinators review with the `review` skill (`.claude/skills/review/SKILL.md`): re-run the evidence, read the raw diff against the spec, fact-check, verdict Approved/Changes needed for one full SHA. Merge only an approved SHA.
- Specs from coordinators name the allowed and forbidden files, so the evidence script can check them.

## Multiplayer
- Goes through the Fable multiplayer coordinator thread for spec and review. Per-player views live in `src/core/view.ts` and `src/ui`. The game server must be a separate Worker (Durable Objects disable preview URLs).

## Decks
- `main` ships only the two official System Gateway starters (Syndicate, Catalyst) in `src/data/decks.ts`.
- Third-party decks (NSG samples, NetrunnerDB lists) are test-only in `src/data/testDecks/` and appear in the picker only on `beta` (`__ALL_DECKS__` in `vite.config.ts`). Never ship them on main without Jeff's permission.
- Beta picker shows one deck per identity; add one when you add an identity.
- Deck legality: `validateDeck` in `src/core/deckValidation.ts`; formats and ban lists in `src/core/formats.ts` (Casual/Startup/Standard; Eternal is out of scope).

## New card set process (Standard sets, newest first, on beta)
1. Pull card data and image links from NetrunnerDB.
2. Add new keywords to the hover tooltips.
3. Implement every card with its own unit test (plus liveValue/revealInHand); check errata.
3b. In a separate thread, blind rules tests with the `blind-rules-tests` skill (`.claude/skills/blind-rules-tests/SKILL.md`): 20-30 tricky cards tested from card text and the rules only, without reading the card code; real bugs go to the rules-bugs thread.
4. AI data: one entry per card in `src/ai/cards/<set>.ts`; re-tag older cards that interact. Ice that gains subroutines when encountered (Starlit Knight) needs a `gainsOnEncounter` entry, or the Runner AI prices the run against the printed subroutines only.
5. Startup/Standard legality and ban lists.
6. Make the AI use the new cards and identities: sample real NetrunnerDB decks (test-only), run `scripts/deck-playability.ts`, add one beta picker deck per new identity. Check optional "you may X now for Y later" prompts.
7. Balance with AI self-play: Corp 50 ± 5%.

## UI
- No scanlines and no dot grid, ever.
- Tap-to-inspect on touch devices only; mouse behaviour must not change with window width.
- Fonts have been bumped one step for eye strain; don't shrink them.

## Audits
- Code audits use the `code-audit` skill (`.claude/skills/code-audit/SKILL.md`): focused (one area, a new set, an MP chunk, an AI item, a branch before merge) or full (tech-debt sprawl and drift). Audits only report; fixes go to separate threads (AI fixes via the AI Coordinator). Reports, findings.json and metrics go to `/mnt/project-files/audits/`; each audit compares with the previous one.
- Run one after every 2-3 AI merges to beta, before beta merges to main, and before a new set's balance step.

## Hosting
- Cloudflare Worker serves static assets and auto-deploys on every push to `main` (live: stackheap.run / android-netrunner-digital.jk9321.workers.dev). `beta` has its own preview (beta-android-netrunner-digital.jk9321.workers.dev) with separate localStorage, so decks don't carry over.
- Card art loads from card-images.netrunnerdb.com; card backs are our own.
- Update `PROJECT_STATUS.md` when finishing notable work.
