#!/usr/bin/env node
// Decodes the saved-game snapshot from a player bug report (the first
// comment on a "[Bug report]" issue) into JSON: { config, state, table },
// the same shape the app keeps in localStorage (src/ui/savedGame.ts).
//
//   node scripts/bug-report-state.mjs comment.txt > state.json
//
// The file may hold the whole comment or just the base64 text.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/bug-report-state.mjs <file with the snapshot comment>');
  process.exit(1);
}
const text = readFileSync(file, 'utf8');
const base64 = text
  .split('\n')
  .filter(line => /^[A-Za-z0-9+/=]+$/.test(line.trim()))
  .join('');
process.stdout.write(JSON.stringify(JSON.parse(gunzipSync(Buffer.from(base64, 'base64')).toString('utf8')), null, 2) + '\n');
