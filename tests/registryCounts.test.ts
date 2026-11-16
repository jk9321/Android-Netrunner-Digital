import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The valuation registry's "Counts" table (docs/ai-priced-quantities.md) is the output of scripts/value-owners/counts.mjs
 * at this tree (V-B B3, the AI Coordinator's B2 review: the table had gone stale). A branch that changes src/ai or the
 * copy lines re-runs `node scripts/value-owners/counts.mjs --write`.
 */
describe('valuation registry counts', () => {
  it('the Counts table is what counts.mjs prints', () => {
    const printed = execFileSync('node', ['scripts/value-owners/counts.mjs'], { encoding: 'utf8' }).trim();
    const text = readFileSync('docs/ai-priced-quantities.md', 'utf8');
    const section = text.slice(text.indexOf('### Counts\n'), text.indexOf('<!-- valuation:end -->'));
    expect(section, 'run node scripts/value-owners/counts.mjs --write').toContain(printed);
  });
});
