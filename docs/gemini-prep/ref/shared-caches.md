# The shared value caches in self-play, sized on today's tree (found row 90)

AI Coordinator (Corp side), 2026-11-20 06:25Z. For the V-C checkpoint's g10 reading (`bar-g10.md`, "Shared caches").

Run **44685391035**: a NULL head-to-head g1 (script `head-to-head`, h2h corp, old = new = beta 85972cee, so the Corp and the Runner are the same AI loaded as two module graphs and share no cache), against the plain g1 base **44680798149** (one graph, caches shared), same 221 deals. Read by me on the deals records (winner, cr, sc).

- **12 of 221 deals differ** (5.4%); 5 change winner (3 to the Corp, 2 to the Runner). Deals: 1131, 1211, 1371, 1881, 2181, 2211, 2241, 2391, 2471, 2751, 3041, 3051.
- Corp wins 115 without sharing against 114 with it: **+0.5 ± 1.0 points paired, no lean either way.**
- Alarms and steals from remotes: level (Corp stayed broke -1.4 ± 1.2 per 100 games; steals from remotes +0.000 ± 0.011).
- The Runner rework's null pairs on beta 6919a82 read 13 and 14 of 221 with 5 winners: the same size before and after V-C's merges.

**Reading.** A self-play game takes a different path in about 1 deal in 18 because one AI reads a value the other wrote; over 221 deals it moves the Corp's win rate by nothing measurable. So the g10's win rate is reported as "self-play, caches shared" with this note beside it, and no line of the bar changes: base and branch share alike. What it does NOT show: that the cached values are right. A value that depends on who asked first still has no single owner (row 90 a); that stays a debt for the Runner rework's shared card facts and the registry's cache lines, and a head-to-head cell is still read against a null cell of the same commit, never against a plain g1.
