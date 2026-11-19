/**
 * Count 2 (brief-count2.md): builds scripts/stage-d/madani-hosted-arms2.json, the arms as text patches on copies of src/
 * (runner-money-trees.ts makeTrees), from edited copies of the files:
 *   node scripts/stage-d/madani-hosted-arms2.mjs <hosted arm dir> <onboard arm dir>
 * Each <dir>/src/... holds that arm's versions of the files it changes. `hosted` is count 1's arm (madani-hosted-arms.json
 * holds the same patches); `onboard` reads every walked hosted program as installed, one way, nothing charged, with the
 * classing ladder behind globalThis.__mhFlags (measuring only). The probe is count 1's.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const files = ['ai/corp/hold.ts', 'ai/cards/types.ts', 'ai/cards/elevation.ts'];
function patchesOf(dir) {
  const patches = [];
  for (const f of files) {
    const base = readFileSync(join('src', f), 'utf8');
    let out = '';
    try {
      execFileSync('diff', ['-U6', join('src', f), join(dir, 'src', f)], { encoding: 'utf8' });
    } catch (e) {
      out = e.stdout;
    }
    const hunks = out.split('\n').slice(2).join('\n').split(/^@@[^\n]*@@\n/m).slice(1);
    for (const h of hunks) {
      const lines = h.replace(/\n$/, '').split('\n').filter(l => !l.startsWith('\\'));
      const from = lines.filter(l => !l.startsWith('+')).map(l => l.slice(1)).join('\n');
      const to = lines.filter(l => !l.startsWith('-')).map(l => l.slice(1)).join('\n');
      if (base.split(from).length !== 2) throw new Error(`${f}: a hunk does not match once: ${from.slice(0, 80)}`);
      patches.push([f, from, to]);
    }
  }
  return patches;
}
const one = JSON.parse(readFileSync('scripts/stage-d/madani-hosted-arms.json', 'utf8'));
const hosted = patchesOf(process.argv[2]);
const onboard = patchesOf(process.argv[3]);
if (JSON.stringify(hosted) !== JSON.stringify(one.hosted)) throw new Error('the hosted arm differs from count 1');
writeFileSync('scripts/stage-d/madani-hosted-arms2.json', JSON.stringify({ hosted, onboard, probe: one.probe, _arms: { beta: [], control: [], hosted: ['hosted'], onboard: ['onboard'], probe: ['probe'] } }, null, 1) + '\n');
console.log(`${hosted.length} hosted, ${onboard.length} onboard patches`);
