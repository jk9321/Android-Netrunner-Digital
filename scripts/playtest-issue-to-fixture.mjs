#!/usr/bin/env node
// Turns a "[Playtest game]" issue (label playtest-game) into a human-games fixture.
//   node scripts/playtest-issue-to-fixture.mjs <issue number> <comments.json> [outDir]
// comments.json is the issue's comments from the GitHub API. The fixture has the
// shape of tests/fixtures/human-games/report-N.json ({config, state, moves, startStops},
// the decoded snapshot without the table), named after the issue number.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [number, commentsFile, outDir = 'tests/fixtures/human-games'] = process.argv.slice(2);
if (!number || !commentsFile) {
  console.error('Usage: node scripts/playtest-issue-to-fixture.mjs <issue number> <comments.json> [outDir]');
  process.exit(1);
}
const comments = JSON.parse(readFileSync(commentsFile, 'utf8'));
const first = comments.find(c => (c.body ?? '').startsWith('Saved game snapshot'));
if (!first) {
  console.error('No snapshot comment found');
  process.exit(2);
}
const base64 = first.body
  .split('\n')
  .filter(line => /^[A-Za-z0-9+/=]{20,}$/.test(line.trim()))
  .join('');
const snap = JSON.parse(gunzipSync(Buffer.from(base64, 'base64')).toString('utf8'));
if (!snap.config || !snap.state || !Array.isArray(snap.moves) || !snap.moves.length) {
  console.error('Snapshot has no config, state or moves');
  process.exit(3);
}
const { table: _table, ...fixture } = snap;
const path = `${outDir}/report-${Number(number)}.json`;
writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
console.log(path);
