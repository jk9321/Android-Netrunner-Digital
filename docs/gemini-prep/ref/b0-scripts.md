# Brief B0: two script counts before R-B (deal 2211, and the losses a defensive line avoided)

From the Runner rework AI Coordinator (thread "Coordinate the Runner AI rework", id cmsg_013UNycUZbB5MfsLyJaSoKuFEqczEp3ecM68HA2caTpekx). **Rev 1, 2026-11-20, after the red team of its stage spec. PARKED: Jeff, 2026-11-20 14:06Z, paused the rework until his go; this thread is not started before it.** For a fresh Opus thread. Message me when you start, at step 0, and at the end.

## Read first
`CLAUDE.md` and `docs/ai-process.md` (whole); `../r0/standing-rules.md` (whole); `../specs/r-b.md` (B0, and "Decided here" 1); `../r0/count4-two-roles/ruling.md` and `count-note.md` (the null cell, deal 2211, the outcome reading A3 and what it leaves out); the red team's B5 in `/mnt/project-files/adversarial/2026-11-20-runner-stage-specs/findings.md`; found row 90 in `/mnt/project-files/netrunner-ai/stage-d/found-during-stage-d.md` (self-play shares value caches).

## Branch and files
Branch `ai-runner-b0-count` from `origin/beta`. Allowed: `scripts/runner-rework/b0-*` (new), `docs/ai-batch-log.md`. Forbidden: `src/**`, `tests/**`, `.claude/**`, `.github/**`, everything else. Notes and outputs: `/mnt/project-files/netrunner-ai/runner-rework/b0/`. The base: the g1 base of the beta commit you branch from (ask me for the id; 44680798149 on 2026-11-20).

## Step 0 (send it to me before going on)
A timed sample of part D on 10 Runner losses, and your estimate for the whole. Over about 3 hours of runner time or 4 workflow runs, I cut it with you.

## Part T: the trace of deal 2211
In count 4's null head-to-head pair one deal differed with no cause found (its ruling: about an hour of compute). Find the first differing decision by lockstep, then the first differing value under it (which cache, which key, which of the two AIs wrote it). Report the cause in one paragraph and say whether it is found row 90's class or a new one. If it is not found within two hours of runner time, stop and say how far the trace got.

## Part D: the losses a defensive line avoided
Sources: every Runner loss by flatline, and every Runner loss in which a tag punishment (a card that needs the Runner tagged) fired in the Corp's last three turns, on the 221 deals of the base and on one NRDB=1 g1 of the same commit (launch it, or reuse A-log's if I send you its id); and the people's files where our Normal Runner played (report-54 and any newer file I send), read apart.
For each such loss, go back to the Runner's last turn before the punishment or the damage. From that board, on the Runner's own view, try each legal defensive line of at most the clicks it had: remove the tags it could pay for; draw up to the grip size that survives the damage that followed; both; neither run nor install otherwise. Play each line by `GameRunner` with the Corp's recorded hand and the same seed, and record whether the Corp's punishment still fires and whether the Runner survives the next Corp turn. The measuring script may read hidden cards to say what was true; the line itself is chosen from public facts only, and you state the public condition that would have named it (the Corp's credits against the known punishment's cost, the Runner's tags, the grip against the damage a rezzed or known card deals). Also record what the defensive line gave up, by count 4's outcome reading for that turn.

## Reading rules (written before your numbers; I rule by these)
1. Unit: one loss is one game. The pool is said in every table: batch pool, NRDB pool, people.
2. A loss is "avoidable" if at least one defensive line makes the Runner survive the Corp's next turn and the public condition for it held at the start of the Runner's turn. It is "avoidable, blind" if a line survives but no public condition named it. Listed apart.
3. **The class is real** if avoidable losses are at least 2% of all games of either pool, or at least 10% of that pool's Runner losses by flatline and tag punishment together. Then "do not die" goes to Jeff as a counted question with R-C2, with your public conditions as its candidates. Below both lines it is recorded as counted and parked, and decision 1 of r-b.md stands.
4. Report beside it, deciding nothing: how often the public condition held in games the Runner did not lose (what the line would cost if it were always taken), and the same reading of tag removal's condition for R-C2 ("the Corp can punish a tag this turn").
5. You propose no fix and build no arm of the Runner.

## Stops
As the standing rules: a decision that changes in a control tree; a hidden read by a line's choice; a source game that does not match the record.

## The end
`/mnt/project-files/netrunner-ai/runner-rework/b0/count-note.md`, the `handoff` skill (light tier), a message to me.
