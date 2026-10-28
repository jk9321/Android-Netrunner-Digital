// Appends one self-play batch to the running log (Jeff, 2026-10-28: log Corp performance for every change).
//   node scripts/batch-log.mjs "<label>" <corp-losses output.txt> [commit] [date]
// Adds a row to docs/ai-batch-log.md and keeps the full breakdown in docs/batch-logs/.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const [label, file, commitArg, dateArg] = process.argv.slice(2);
const text = readFileSync(file, 'utf8');
const commit = commitArg ?? execSync('git rev-parse --short HEAD').toString().trim();
const date = dateArg ?? new Date().toISOString().slice(0, 10);
const grab = re => text.match(re)?.[1] ?? '';
const games = grab(/(\d+) games: Corp/);
const corp = grab(/games: Corp ([\d.]+%)/);
const ending = name => grab(new RegExp(`${name}: \\d+ \\(([\\d.]+%)\\)`));
const server = name => grab(new RegExp(`Runner points in Corp losses, by server:[\\s\\S]*?${name}: \\d+ \\(([\\d.]+%)\\)`));
const credits = grab(/Corp money in Corp losses[\s\S]*?credits at end of turn ([\d.]+)/);
const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
mkdirSync('docs/batch-logs', { recursive: true });
const full = `docs/batch-logs/${date}-${slug}.txt`;
copyFileSync(file, full);
const log = 'docs/ai-batch-log.md';
if (!existsSync(log)) {
  writeFileSync(log, `# AI self-play batch log

Every self-play batch, newest last (Jeff, 2026-10-28). Made with \`scripts/corp-losses.sh 10 normal > out.txt\`, then \`node scripts/batch-log.mjs "<change>" out.txt\`. Noise: about ±2 points of Corp win rate at 2,210 games. Corp loss columns are the share of the Runner's points in Corp losses; full breakdowns (with per-deck win rates from 2026-10-28 on) are in \`docs/batch-logs/\`.

| Date | Change | Commit | Games | Corp win | Corp wins: points / flatline | Runner wins: points / Corp decked | Runner pts from remote / R&D / HQ / Archives | Corp credits at turn end (losses) | Full |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
`);
}
appendFileSync(log, `| ${date} | ${label} | ${commit} | ${games} | **${corp}** | ${ending('corp corp points')} / ${ending('corp flatline')} | ${ending('runner runner points')} / ${ending('runner corp decked')} | ${server('remote')} / ${server('rd')} / ${server('hq')} / ${server('archives')} | ${credits} | [txt](batch-logs/${full.split('/').pop()}) |\n`);
console.log(`logged ${label}: Corp ${corp}`);
