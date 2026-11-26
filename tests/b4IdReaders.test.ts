import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// B4 brief b4-hidden-zones ruling 5 (red team b4 finding 4): no reader outside src/core/engine reads a mark's id. What
// one side knows of the other's hidden zones (the HQ list, the grip list, the Runner's R&D marks and shares, the
// facedown Archives list) is read by code and count; which instance the engine noted is the engine's own business (the
// fuzzer may read it, scripts/engine-fuzz-check.ts). A line that takes the marks and reads an `.id` of them fails here.

const ACCESSORS = /\b(knownInHand|knownInRd|rdSharesKnownToRunner|archivesKnownToRunner|runnerRdMarksForCorp)\(|\b(knownToRunner|knownToCorp|rdKnownToRunner|archKnownToRunner)\b/;
/** Lines allowed, with why: a file B4 may not change, or a cache key that holds the lists whole and reads nothing of them. */
const ALLOWED: Record<string, string> = {
  'src/ai/prompts.ts: const known = new Set(knownInHand(state, \'corp\').map(e => e.id));':
    "Peer Review's Corp prompt (prompts.ts is outside B4's files): an id reader left as a named debt (step 0, id readers)",
  'src/ai/turnPlanner.ts: const rdMemory = `${(state.corp.rdKnownToCorp ?? []).map(e => `${e.id}@${e.at}`).join(\',\')}/${JSON.stringify(state.corp.rdKnownToRunner ?? [])}`;':
    "the Corp view's cache key (ruling 13, F3): the ids are the Corp's own R&D memory; the Runner's marks are keyed whole",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('B4 ruling 5: no reader outside src/core/engine reads a mark id', () => {
  it('no line in src outside src/core/engine takes the marks and reads their id', () => {
    const bad: string[] = [];
    for (const file of files('src').filter(f => !f.replace(/\\/g, '/').startsWith('src/core/engine/'))) {
      const path = file.replace(/\\/g, '/');
      const lines = readFileSync(file, 'utf8').split('\n');
      // A name the file binds to the marks (const known = knownInRd(state)) counts as the marks too
      const names = lines.flatMap(l => (ACCESSORS.test(l) ? [...l.matchAll(/const (\w+) = /g)].map(m => m[1]) : []));
      const marks = names.length ? new RegExp(`${ACCESSORS.source}|\\bof (${names.join('|')})\\b|\\b(${names.join('|')})\\.(map|filter|some|find|forEach)\\(`) : ACCESSORS;
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line) || !marks.test(line)) return;
        // The variable a loop or a callback binds to each mark, read as `.id` on this line or the next few
        const bound = [...line.matchAll(/for \(const (\w+) of|\.(?:map|filter|some|find|findIndex|forEach|every|flatMap)\(\(?(\w+)/g)].map(m => m[1] ?? m[2]);
        const near = lines.slice(i, i + 6).join('\n');
        const reads = /\.\s*map\(\s*\w+\s*=>\s*\w+\.id\b/.test(line) || bound.some(v => new RegExp(`\\b${v}\\.id\\b`).test(near));
        if (reads && !ALLOWED[`${path}: ${line.trim()}`]) bad.push(`${path}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('every allowed line still exists (an allowance whose line is gone is removed)', () => {
    for (const key of Object.keys(ALLOWED)) {
      const [path, ...rest] = key.split(': ');
      expect(readFileSync(path, 'utf8').split('\n').map(l => l.trim())).toContain(rest.join(': '));
    }
  });
});
