# Brief A-log: the Runner's card facts, logged and pinned to golden values (scripts only)

From the Runner rework AI Coordinator (thread "Coordinate the Runner AI rework", id cmsg_013UNycUZbB5MfsLyJaSoKuFEqczEp3ecM68HA2caTpekx). **Rev 1, 2026-11-20, after the red team of its stage spec. PARKED: Jeff, 2026-11-20 14:06Z, paused the rework until his go; this thread is not started before it.** For a fresh Opus thread. Message me when you start, at step 0, and at the end.

## The job in one paragraph
The rework's next step moves 26 card cases out of the Runner's run model into the card entries with play identical. Before that move, two things must exist and you make both: a log of every place the Runner and the Corp read the same card fact differently, and a file of golden values, computed on today's code, that the move will be proven against. You change no `src` file and fix nothing.

## Read first
`CLAUDE.md` and `docs/ai-process.md` (whole); `../r0/standing-rules.md` (whole: scripts, sources, hidden information, the one local minute before a launch, the queue); **`../specs/r-a.md` (whole: it is your spec; the tables L1 to L12 and "The golden values" are your work list)**; `../r0/count1-audit-map/count-note.md` part B (the 26 codes, the seven cards, the five encodings); `../r0/count3-get-in/count-note.md` section 4 and its ruling's section 5; the red team's A1, A2, A6, A7 in `/mnt/project-files/adversarial/2026-11-20-runner-stage-specs/findings.md`; `src/ai/runs.ts`, `src/ai/corp/hold.ts`, `src/ai/cards/types.ts`.

## Branch and files
Branch `ai-runner-facts-log` from `origin/beta`. Allowed: `scripts/runner-rework/facts-*` (new), `tests/fixtures/runner-facts/` (new: the built boards and `golden.json`; no test file), `docs/ai-batch-log.md`, `PROJECT_STATUS.md` (one line at the merge, mine). Forbidden: `src/**`, every test file, `.claude/**`, `.github/**`, everything else. Notes and outputs: `/mnt/project-files/netrunner-ai/runner-rework/a-log/` (network mount: trailing slash, never search the whole folder, re-read a shared file ten seconds after writing it).

**The base:** the g1 base of the beta commit you branch from. On 2026-11-20 that is run 44680798149 (beta 38ab2a97, `src/ai` logic unchanged through dd4004c). Ask me for the current id when you start; check with one plain `GameRunner` game that your sources are that run's games.

## Step 0 (send it to me before going on)
1. **The source table:** for each of the 26 cases and each of the seven cards, the number of decks holding it in the batch pool (13 x 17), in the NRDB=1 pool, and the number of people's files where it was met in play (not merely in a deck list). The red team's text count is in its A1 and A2; yours replaces it.
2. **A timed sample:** 20 recorded boards (10 self-play, 10 people's) through every log line; the script time per board; your estimate for the whole. If the whole is over about 3 hours of runner time or 4 workflow runs, I cut it with you.

## What to make
**The logs, L1 to L12 of the spec**, on the 221 deals of the base, the 38 human files, and the deals of one NRDB=1 g1 of the same commit (launch it as your first run; self-play, the NRDB pool and people reported apart everywhere). One table per line, by kind and count. With every count write the number of boards that met the fact at all.

**The golden values** (`scripts/runner-rework/facts-golden.ts`, `tests/fixtures/runner-facts/golden.json`), as the spec's section lists them: one built board per branch of each case; every reader's answer on it today; the Corp's rez decision for the ice on that board. The script's header and the JSON both state the commit they were made on. Build boards as the pins do (`tests/exploitPins.test.ts`, `tests/runnerPins.test.ts`): a `structuredClone` edited before any legality call, never after. Run the script twice and show the two files are byte-identical. For each board also play the fact in the engine (L11) and record whether the engine agrees with what the readers assume.

## Reading rules (written before your numbers; I rule by these)
1. The log decides nothing and you propose no fix. Every fact with a difference above 0 is listed with its count, its kinds and three example boards (deal, turn, the two readings).
2. "0 differences" is written only beside the number of boards that met the fact. Under 10 boards met is reported as "not shown".
3. A difference on fewer than 10 people's boards is marked "thin" and listed.
4. L5 and L6: boards where the two views are the same are counted apart from boards where a difference is by construction (a hidden ice, money cards in the grip).
5. L9: feasibility against feasibility as the spec defines it; the three policy differences each get their own count; only what is left is "unexplained", and every unexplained board is listed.
6. Unit of every count: one board is one (deal or file, turn, decision index); one fact-reading is one (board, ice or server). Say which in each table's header.

## Stops
A decision that changes in a control tree; a hidden-information read by anything but the measuring script (mark each place it reads); a source game that does not match the batch's record; a golden board on which two runs of the script differ.

## The end
`/mnt/project-files/netrunner-ai/runner-rework/specs/r-a-log-note.md` (the tables, where they are thin, which way each reading errs; do not pick the answer), the `handoff` skill for the branch (light tier: scripts and one fixture, CI green), then a message to me. I merge after my read; A-move's branch is cut from the commit that holds your golden file.
