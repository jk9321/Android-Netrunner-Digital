// Prints the Corp loss breakdown from scripts/corp-losses.ts shards (see corp-losses.sh).
import { readFileSync } from 'node:fs';
import { printLossSummary } from './loss-summary.mjs';

const games = process.argv.slice(2).flatMap(f => {
  const lines = readFileSync(f, 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
});
printLossSummary(games);
