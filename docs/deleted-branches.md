# Deleted branches

Branches deleted on purpose that still had commits not in `beta` or `main`.
Each tip is kept as a tag `archive/<branch>`, so nothing is lost. The 2026-11-18 list ran 2026-11-19 (run 44604277506): all 8 deleted and tagged.

**Restore one:** on GitHub open the repo's Tags, pick `archive/<branch>`, or create
the branch again from that tag (or from the SHA below).

## 2026-11-18: one-time delete list (Jeff asked; `.github/workflows/cleanup-branches.yml`, `ONE_TIME_DELETE`)

Checked 2026-11-18 against beta (`git cherry`, merge-base) and against CLAUDE.md,
PROJECT_STATUS.md, docs/, project memory and the AI hand-off/leads/Stage D files.

| Branch | Tip SHA | Last commit | Why it could go |
|---|---|---|---|
| ai-corp-core-c-stealbase | 97d167d757d6251b6adbf0e0c22f97ab7bb3fbf8 | 2026-11-15 | Its one commit is already in beta (cherry-picked, same content) |
| ai-corp-core-c-g1base | e32341d6ff356dab8ef7c2f273de0e24ff9180d6 | 2026-11-15 | Stage C7/C8 measurement base; Stage C merged; referenced nowhere |
| ai-ice-discard | 591a18b7d08b1fddf1ce75e7a50023bc577ca630 | 2026-11-13 | Arms closed 2026-11-13 (neutral result); pins kept in bars/ice-discard.md |
| ai-assets | ac9e53484d05faed9e5894b46312f2096e28d2df | 2026-11-12 | Asset arms closed 2026-11-12; tables already in project files |
| ai-runner-reading | 2304ec2b49c5cd91922dd2d547e627a87381d8c9 | 2026-11-12 | R0 done, R1 stopped 2026-11-12; report in project files |
| ai-placement | bf4c1125e29137566e7878f848b971095b832220 | 2026-11-12 | Step 4 placement arms failed the gate; superseded by Stage C |
| ai-click-cache | ed390e090dae1abfca9b163540b6ce6e35479d45 | 2026-11-12 | WIP "not for merge" cache experiment |
| ai-tag-cache | 11ccef974b3c0430774ecfe383a169b5c1a7fbfb | 2026-11-12 | WIP "not for merge" cache experiment |

Kept on purpose (named as parked or still needed): `ai-terminal-e`, `ai-tag-rig-cache`,
`ai-rig-loss` (Stage D hand-off: parked, Jeff's call; the Stage D item 4 brief reads
`ai-terminal-e`), `ai-decision-time` (scripts parked for Stage D, not on beta),
`ai-tag-loss-time` (kept for measurements; scripts newer than beta's), `ai-search-first`
(Step S switches; re-runs were planned), `ai-human-holes` (Part B chainEnd lives only
there), `ai-draw-worth` (arm B drawResearch parked), plus `ai-hold-trash`,
`ai-prompt-place`, `ai-value-b5` and the active Stage D branches.

## 2026-11-20: second one-time delete list (Jeff asked, after beta went to main 555b956a)

Abandoned or parked AI branches whose work is closed, ruled or moved to the Runner
rework. Each tip is tagged `archive/<branch>` by the workflow before the delete.
Kept on purpose: `main`, `beta`, `ai-batch-results` (batch results) and `ai-value-b5`
(parked B5, now on the workflow's protected list).

| Branch | Tip SHA | Last commit |
|---|---|---|
| ai-search-first | 7d0e2c708f33666f6466a8b8f0b6f2e315504c79 | 2026-11-16 |
| ai-hold-trash | c742520be32e7efa651c3e60a51f52a7d311b8ae | 2026-11-18 |
| ai-grip-money | 15686903ce4731525d150657fd452e2d1eded976 | 2026-11-18 |
| ai-human-holes | 0b819f75638d141aa99042d0664814dcbf4fea05 | 2026-11-13 |
| ai-prompt-place | e188cc6b4bc107c3ed8bf6687e2bbac43fb0c8b4 | 2026-11-18 |
| ai-madani-count | c340705ab9930e60a63a6b7575fab08a6b412280 | 2026-11-19 |
| ai-draw-worth | 62830939d7fa091f31b84c5fdf26c1c3fac80884 | 2026-11-12 |
| ai-decision-time | 150d2b27efce007ba6e2278c6e4ebaf4fbc2ac41 | 2026-11-16 |
| ai-rig-loss | 564ea14692d648c3056ab8802240c2668d5fa6b4 | 2026-11-13 |
| ai-tag-loss-time | 2799b1878651149d0054de781f799b9f24c85a2b | 2026-11-16 |
| ai-tag-rig-cache | 165eb2b8d0ea8ed0b579bd8cb1f7f149e4559951 | 2026-11-13 |
| ai-terminal-e | bdf30b8a067866c4fb8ce1d9154b4dc5c45fd98c | 2026-11-14 |
