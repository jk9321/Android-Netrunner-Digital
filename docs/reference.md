# Reference detail moved out of CLAUDE.md

Moved verbatim out of `CLAUDE.md` (2026-11-26, to cut what every thread reads each turn). `CLAUDE.md` keeps every rule a thread must not miss and points here for the detail. Read a section when its subject comes up. Each rule has an id heading; cite the id (`CLAUDE.md`, `RULE-CITE-IDS`).

| Id | Rule |
|---|---|
| `RULE-TOOL-VERSIONS` | Tool versions and explicit devDependencies |
| `RULE-ENGINE-FUZZER` | Engine fuzzer tiers |
| `RULE-CARD-DATA` | Card data and ban lists |
| `RULE-QUIET-OUTPUT` | Quiet output |
| `RULE-MAIN-BETA-MERGES` | Main-only items and main-into-beta merges |
| `RULE-STOPS` | Stop settings |
| `RULE-BUG-REPORTS` | Bug reports and playtest games |
| `RULE-UI-BASE` | UI work builds on the light UI |
| `RULE-HOSTING` | Deploys and card art |
| `RULE-AUDIT-SKILL` | Audit skill and reports |

## Tooling
### RULE-TOOL-VERSIONS: Tool versions
Vite 8 (Rolldown, oxc), @vitejs/plugin-react 6, vitest 5, eslint 10 (2026-11-20). `vite-node` 6 is an explicit devDependency: the AI batch scripts (`npx vite-node scripts/*.ts`) need it and vitest no longer bundles it; keep its major matched to vite's (vite-node 6 = vite 8). `esbuild` is an explicit devDependency for `scripts/load-order.mjs` (vite 8 no longer installs it).

### RULE-ENGINE-FUZZER: Engine fuzzer
Engine fuzzer (random legal moves on every deck, Comprehensive Rules invariants checked after every action; checks in `scripts/engine-fuzz-check.ts`): tier 1 `tests/engineFuzz.test.ts` (fixed seeds, in `npm test`, gates CI); tier 2 `.github/workflows/engine-fuzz-nightly.yml` (one ~15 min job each night on beta, fresh seeds, failures uploaded as the `engine-fuzz-failures` artifact); tier 3 `.github/workflows/engine-fuzz-deep.yml` (run by hand with parallel jobs before each new set merges and before beta merges to main). Reproduce a failure with `npx vite-node scripts/engine-fuzz-replay.ts -- fail-<seed>.json`. A new invariant must pass tier 1 on day one; when it flags a state the rules allow, fix the check (cite the rule), not the engine.

### RULE-CARD-DATA: Card data
Card data: `npm run sync-cards`. Ban lists: `node scripts/print-banlist.mjs`.

## Quiet output
### RULE-QUIET-OUTPUT: Quiet output
`scripts/quiet.mjs` (2026-11-26) keeps long output out of the conversation: the full log goes to `.quiet/` (git-ignored), and you see a short summary with an UNUSUAL block. Open the full log only when the summary points at something.
- `node scripts/quiet.mjs test [vitest args]`: vitest run. Shows pass/fail counts, each failure with its first message lines, test count and run time next to the last run in this container, and flags skipped and todo tests, slow tests and files new since the last run, files that failed to load, unhandled errors, tests that wrote to stderr, warnings, and passed tests that made no `expect()` call (listed by `tests/setup.ts` when `QUIET_NO_ASSERT_FILE` is set). Log `.quiet/test.log`.
- `node scripts/quiet.mjs batch <run id> [--base <run id>] [--games N]`: reads an `ai-batch` summary (`results/<id>.txt` on `ai-batch-results`, fetched for you; a local file works too) in about ten lines: games against the expected count (the paired base, `--games`, or the last run of the same size), Corp win rate, the paired diff in SE, how games end, alarms. Flags missing games, crashed games, value loops, games with no winner, a paired diff or alarm outside 2 SE, a way of ending that moved 5 points or more against `--base`, and a Corp win rate outside 40-60%. An `ai-script` run id unpacks `scripts/<id>.tar.gz` into `.quiet/script-<id>/` and flags missing shards, shards that wrote to stderr, empty outputs and error lines; read it with the script's own summing script under `run`.
- `node scripts/quiet.mjs run <name> -- <command ...>`: any long script. Shows exit code, run time and line count next to the last run of that name, the lines that look like trouble (errors, warnings, NaN, timeouts, grouped and counted), and the last 12 lines. Log `.quiet/<name>.log`.
- The gate's `fast-checks.mjs` is already quiet; it is not wrapped.

## Branches
### RULE-MAIN-BETA-MERGES: Main-only items and main-into-beta merges
From project memory (2026-11-26). "What's new" stays on main, never beta. A main-into-beta merge must NOT change beta's deck picker (keep beta's side). Compare main and beta by content (`git diff origin/main origin/beta --stat`, by folder), never by commit count.

## Product decisions
### RULE-STOPS: Stop settings
From project memory (2026-11-26). STOPS: ALL stops at every window every time; AUTO passes unless there is a real choice. The player decides. NONE was removed 2026-11-23 (main 8efbf4f); the engine still accepts `'none'` for old saves. The online AUTO-stop tell is kept (Jeff 2026-11-14: anyone worried can turn AUTO off).

### RULE-BUG-REPORTS: Bug reports
From project memory (2026-11-26). Bug reports attach the full game, on main too (Jeff re-confirmed 2026-11-14; do not re-raise). "Submit playtest game" is beta-only. A report that is not a bug: the thread replies on the issue and closes it after Jeff's OK.

### RULE-UI-BASE: UI base
From project memory (2026-11-26). UI work builds on Gemini's light UI.

## Hosting
### RULE-HOSTING: Hosting
- Cloudflare Worker serves static assets. GitHub Actions deploys it (`.github/workflows/deploy.yml`, wrangler, secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID) after CI passes on a push to `main` (live: stackheap.run / android-netrunner-digital.jk9321.workers.dev) or `beta` (beta preview + game Workers). Cloudflare's own Workers Builds are off (they billed build minutes for every branch); no other branch deploys by itself. `beta` has its own preview (beta-android-netrunner-digital.jk9321.workers.dev) with separate localStorage, so decks don't carry over.
- Card art loads from card-images.netrunnerdb.com; card backs are our own.

## Audits
### RULE-AUDIT-SKILL: Audit skill and reports
- Code audits use the `code-audit` skill (`.claude/skills/code-audit/SKILL.md`): focused (one area, a new set, an MP chunk, an AI item, a branch before merge) or full (tech-debt sprawl and drift). Audits only report; fixes go to separate threads (AI fixes via the AI Coordinator). Reports, findings.json and metrics go to `/mnt/project-files/audits/`; each audit compares with the previous one.
- Run one after every 2-3 AI merges to beta, before beta merges to main, and before a new set's balance step (`CLAUDE.md`, `RULE-AUDIT-CADENCE`).
