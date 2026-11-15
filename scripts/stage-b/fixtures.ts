/**
 * Writes the recorded rez windows tests/corpRez.test.ts reads (Stage B2, the hold owner's afford fix): the approach-ice
 * windows of report-23 #31 (Scatter Field) and report-20 #42 (Biawak), where the rez is legal though its printed cost
 * is more than the Corp's credit pool.
 *
 *   npx vite-node scripts/stage-b/fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { forEachRecorded } from '../stage-a/harness';

const want: Record<string, string> = { 'human:report-23.json #31': 'stage-b-rez-scatter-r23-31.json', 'human:report-20.json #42': 'stage-b-rez-biawak-r20-42.json' };
process.env.DEALS = 'none';
process.env.HUMAN = 'report-20,report-23';
const saved: string[] = [];
forEachRecorded({
  decision: d => {
    const name = want[`${d.src} #${d.i}`];
    if (!name || d.kind !== 'rez') return;
    writeFileSync(`tests/fixtures/${name}`, JSON.stringify(d.state));
    saved.push(name);
  },
});
console.log(`saved ${saved.join(', ') || 'NONE'}`);
