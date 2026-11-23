# CLAUDE.md

Android: Netrunner digital game (React + TypeScript + Vite, Cloudflare Worker hosting). Free and non-commercial; credit Null Signal Games (NSG) and NetrunnerDB. Public repo: github.com/jk9321/Android-Netrunner-Digital. Use the account name `jk9321` everywhere.

## Working style
- Act as a colleague, not a yes-man: push back when something looks wrong.
- Jeff does not work from a local clone. Never tell him to run git commands or `git pull`; say "refresh the site".
- Never write secrets or tokens into the repo.

## Branches
- Small fixes and finished work go straight to `main` (no PR per fix), then merge `main` into `beta`.
- `beta` holds ALL new AI work and all new card sets. Jeff bug-tests it on the beta Cloudflare preview. Beta merges to `main` only when Jeff says so.
- Larger work Jeff will test first goes on a named feature branch; its preview is deployed by hand (Actions -> Deploy -> Run workflow with the branch name; URL `<branch>-android-netrunner-digital.jk9321.workers.dev`).
- Never push throwaway `claude/*` branches.
- Merged branches are deleted automatically by the nightly `.github/workflows/cleanup-branches.yml` (09:17 UTC; keeps main, beta, ai-batch-results, branches with an open PR or unmerged commits). Do NOT ask Jeff to delete a merged branch. Mention a branch only if it is abandoned or parked with unmerged work and needs his decision.
- Threads with clones from before 2026-10-23 must reset to current history, never push old history.

## Rules correctness
- Check EVERY rules change against the comprehensive rules PDF and cite the rule number in the commit/test: `Netrunner/Resources/Rulebook/Null_Signal_Games_Netrunner_Comprehensive_Rules_v26.03.pdf` (project files, `/mnt/project-files/`).
- Rules bugs from playtesting: quote the rule first, then fix, then add a test.

## Commands
- `npm test` (vitest run), `npm run lint` (eslint), `npm run typecheck` (tsc --noEmit), `npm run build` (tsc && vite build), `npm run test:e2e` (Playwright smoke).
- CI (`.github/workflows/ci.yml`) runs typecheck, lint and test on main and beta. Run all three before pushing.
- Gate: `.claude/hooks/gate-main-beta.mjs` (PreToolUse) blocks `git commit` on main/beta and `git push` to main/beta until `node .claude/hooks/fast-checks.mjs` passes (typecheck + lint + unit tests minus the slow AI files, 25-40 s; a passed tree is stamped so the push after a commit doesn't re-run). Push as its own command, not after a checkout/merge in the same line. GitHub MCP file writes to main/beta are blocked: use git. The slow tests and e2e stay in CI. Don't work around the gate; fix what it reports.
- After every push to `main` or `beta`, check that push's CI run yourself (a PostToolUse hook, `.claude/hooks/ci-after-push.mjs`, reminds you) and fix failures before finishing; don't wait for Jeff to report them. Ignore `ai-batch-results` and other branch builds.
- Vite 8 (Rolldown, oxc), @vitejs/plugin-react 6, vitest 5, eslint 10 (2026-11-20). `vite-node` 6 is an explicit devDependency: the AI batch scripts (`npx vite-node scripts/*.ts`) need it and vitest no longer bundles it; keep its major matched to vite's (vite-node 6 = vite 8). `esbuild` is an explicit devDependency for `scripts/load-order.mjs` (vite 8 no longer installs it).
- Engine fuzzer (random legal moves on every deck, Comprehensive Rules invariants checked after every action; checks in `scripts/engine-fuzz-check.ts`): tier 1 `tests/engineFuzz.test.ts` (fixed seeds, in `npm test`, gates CI); tier 2 `.github/workflows/engine-fuzz-nightly.yml` (one ~15 min job each night on beta, fresh seeds, failures uploaded as the `engine-fuzz-failures` artifact); tier 3 `.github/workflows/engine-fuzz-deep.yml` (run by hand with parallel jobs before each new set merges and before beta merges to main). Reproduce a failure with `npx vite-node scripts/engine-fuzz-replay.ts -- fail-<seed>.json`. A new invariant must pass tier 1 on day one; when it flags a state the rules allow, fix the check (cite the rule), not the engine.
- Card data: `npm run sync-cards`. Ban lists: `node scripts/print-banlist.mjs`.
- Never mutate a game state after `isLegalAction`/`getLegalActions` (legality is cached per state in a WeakMap); tests edit a `structuredClone`.
- Don't change the `inst-N` instance numbering in `src/core/engine/gameState.ts`.

## AI work
- Guard: `.claude/hooks/guard-ai-dir.mjs` (PreToolUse, `.claude/settings.json`) blocks Edit/Write and obvious shell writes under `src/ai/**` unless the git branch starts with `ai-`. Don't work around it; ask the coordinator for an ai-* branch thread.
- Goes through the Fable "AI Coordinator" thread for spec and review. Opus threads implement. Nothing merges to beta without its review.
- **Read `docs/ai-process.md` first** if you touch `src/ai`, review or red-team AI or Multiplayer work, coordinate it, or launch an `ai-batch` or `ai-script` run. It holds the AI rules verbatim: thread economy, goal and win rate, counted decisions, one owner per quantity, replace don't stack and Stage D, the tuning ladder, switches, per-card data, batches, measurement scripts, batch sizes and the slot gate, bar before the batch, override check, pins, human-game fixtures, review cutoff, and adversarial review.
- Batch queue (every thread that launches an `ai-batch` or `ai-script` run; slot gate details in `docs/ai-process.md`): Always start the workflow from `beta` (workflow ref `beta`, the commit to test in the `ref` input), since a run started from an older branch's copy of the workflow has no gate. Queue discipline (2026-11-16, after the queue reached ten waiting runs): a thread keeps at most TWO runs in the queue at a time, waiting or running, and launches its next one when one of its own starts its shards; a script that will take over 30 minutes says so in its label; before launching, look at what is already waiting. Do not change the gate's ordering rule while runs are waiting: two waiting runs on different versions of the rule can each put the other first and neither starts.
- Branch-build failures on `ai-batch-results` are harmless noise.

## Hand-off and review
- Any branch a coordinator (AI or Multiplayer) or reviewer will check: hand off with the `handoff` skill (`.claude/skills/handoff/SKILL.md`): fixed template, evidence generated by `evidence.mjs` (diff stat vs base, files vs the spec's allowed list, diff signals, real check output), deviations listed. A prose summary is not a hand-off.
- Coordinators review with the `review` skill (`.claude/skills/review/SKILL.md`): re-run the evidence, read the raw diff against the spec, fact-check, verdict Approved/Changes needed for one full SHA. Merge only an approved SHA.
- Specs from coordinators name the allowed and forbidden files, so the evidence script can check them.
- Adversarial review (Jeff 2026-11-15): red team on a spec before it is built, exploit hunt at each stage checkpoint, by a fresh thread; full rule in `docs/ai-process.md`.
- Review cutoff (Jeff 2026-11-19): review depth follows what a change can affect: full red team + review for AI logic and engine resolution, a single review for a one-card script, CI plus a self-check for tests, scripts, UI, docs and workflows, none for a step counted and parked with no change; full rule in `docs/ai-process.md`, Review cutoff.

## Multiplayer
- Goes through the Fable multiplayer coordinator thread for spec and review. Per-player views live in `src/core/view.ts` and `src/ui`. The game server must be a separate Worker (Durable Objects disable preview URLs).

## Decks
- `main` ships only the two official System Gateway starters (Syndicate, Catalyst) in `src/data/decks.ts`.
- Third-party decks (NSG samples, NetrunnerDB lists) are test-only in `src/data/testDecks/` and appear in the picker only on `beta` (`__ALL_DECKS__` in `vite.config.ts`). Never ship them on main without Jeff's permission.
- Beta picker shows one deck per identity; add one when you add an identity.
- Deck legality: `validateDeck` in `src/core/deckValidation.ts`; formats and ban lists in `src/core/formats.ts` (Casual/Startup/Standard; Eternal is out of scope).

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

## UI
- No scanlines and no dot grid, ever.
- Tap-to-inspect on touch devices only; mouse behaviour must not change with window width.
- Fonts have been bumped one step for eye strain; don't shrink them.

## Audits
- Code audits use the `code-audit` skill (`.claude/skills/code-audit/SKILL.md`): focused (one area, a new set, an MP chunk, an AI item, a branch before merge) or full (tech-debt sprawl and drift). Audits only report; fixes go to separate threads (AI fixes via the AI Coordinator). Reports, findings.json and metrics go to `/mnt/project-files/audits/`; each audit compares with the previous one.
- Run one after every 2-3 AI merges to beta, before beta merges to main, and before a new set's balance step.

## Hosting
- Cloudflare Worker serves static assets. GitHub Actions deploys it (`.github/workflows/deploy.yml`, wrangler, secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID) after CI passes on a push to `main` (live: stackheap.run / android-netrunner-digital.jk9321.workers.dev) or `beta` (beta preview + game Workers). Cloudflare's own Workers Builds are off (they billed build minutes for every branch); no other branch deploys by itself. `beta` has its own preview (beta-android-netrunner-digital.jk9321.workers.dev) with separate localStorage, so decks don't carry over.
- Card art loads from card-images.netrunnerdb.com; card backs are our own.
- Update `PROJECT_STATUS.md` when finishing notable work.
- AI state has ONE status source (Jeff 2026-11-16): the plan page "Corp AI rework: current plan" (https://claude.ai/artifact/DXPYCFJKJaPSvep8zfmoRk), kept by the AI Coordinator at every AI merge. `PROJECT_STATUS.md` keeps one dated line per AI merge (what, branch, review file) and points there for the state; project memory keeps rules, thread ids and pointers, not a second copy of the state. If they differ, the plan page wins.
