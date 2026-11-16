/**
 * ai-corp-rd-memory (brief "Stops": decision time above 1.05x): the time of every Corp decision on the recorded
 * human games (the same states on both trees, since a replay follows the recorded moves), one line per decision.
 * Runs unchanged in a checkout of the base (reads only scripts/stage-a/harness.ts).
 *   DEALS=none SHARD=0/4 npx vite-node scripts/corp-rd-memory/time.ts > t-0.txt
 */
import { forEachRecorded } from '../stage-a/harness';

forEachRecorded({ decision: d => console.log(JSON.stringify({ src: d.src, i: d.i, kind: d.kind, ms: Math.round(d.ms * 10) / 10 })) });
