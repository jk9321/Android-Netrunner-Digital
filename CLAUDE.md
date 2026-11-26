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
- Engine fuzzer: three tiers (tier 1 `tests/engineFuzz.test.ts` gates CI; nightly and deep runs; replay a failure) in `docs/reference.md`, Tooling. A new invariant must pass tier 1 on day one; when it flags a state the rules allow, fix the check (cite the rule), not the engine.
- Card data: `npm run sync-cards`. Ban lists: `node scripts/print-banlist.mjs`.
- Quiet output, the default for every thread: run tests as `node scripts/quiet.mjs test [vitest args]`, read a batch or ai-script result as `node scripts/quiet.mjs batch <run id> [--base <run id>]`, and wrap any long script as `node scripts/quiet.mjs run <name> -- <command>`. The full log goes to `.quiet/`; open it only when the summary's UNUSUAL block points at something. Details: `docs/reference.md`, Quiet output.
- Tool versions (Vite 8, vitest 5, eslint 10; why `vite-node` and `esbuild` are explicit devDependencies): `docs/reference.md`, Tooling.
- Never mutate a game state after `isLegalAction`/`getLegalActions` (legality is cached per state in a WeakMap); tests edit a `structuredClone`.
- Don't change the `inst-N` instance numbering in `src/core/engine/gameState.ts`.

## AI work
- Guard: `.claude/hooks/guard-ai-dir.mjs` (PreToolUse, `.claude/settings.json`) blocks Edit/Write and obvious shell writes under `src/ai/**` unless the git branch starts with `ai-`. Don't work around it; ask the coordinator for an ai-* branch thread.
- Goes through the "AI Coordinator" thread for spec and review. Opus threads implement. Nothing merges to beta without its review. Models (Jeff 2026-11-25): the AI coordinators run on Opus at high effort; Fable is for red-team reviews, stage design briefs, and a short review a coordinator starts when it faces a hard ruling; a request for such a thread says so.
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

## New card set process
- Read `docs/new-card-set.md` before you plan, script, test or balance a new card set: when sets go in (set - round cycles after the Runner rework) and steps 0 to 7.

## UI
- No scanlines and no dot grid, ever.
- Tap-to-inspect on touch devices only; mouse behaviour must not change with window width.
- Fonts have been bumped one step for eye strain; don't shrink them.

## Audits
- One is due after every 2-3 AI merges to beta, before beta merges to main, and before a new set's balance step. Audits only report; fixes go to separate threads. Which skill, where reports go: `docs/reference.md`, Audits.

## Hosting
- Deploys (what deploys main and beta, the beta preview's separate storage, card art and backs): `docs/reference.md`, Hosting. Cloudflare's own Workers Builds are off; no branch other than main and beta deploys by itself.
- Update `PROJECT_STATUS.md` when finishing notable work.
- AI state has ONE status source (Jeff 2026-11-16): the plan page "Corp AI rework: current plan" (https://claude.ai/artifact/DXPYCFJKJaPSvep8zfmoRk), kept by the AI Coordinator at every AI merge. `PROJECT_STATUS.md` keeps one dated line per AI merge (what, branch, review file) and points there for the state; project memory keeps rules, thread ids and pointers, not a second copy of the state. If they differ, the plan page wins.
