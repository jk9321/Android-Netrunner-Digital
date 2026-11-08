/**
 * The screen never runs the engine on what it draws (multiplayer phase 1,
 * chunk 2): only the table (src/ui/table.ts) holds the real GameState and
 * works out legality; every component asks the viewer's seat. Read from the
 * sources, like the health checks (kept out of tests/codeHealth.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const ENGINE_ONLY = ['executeAction', 'getLegalActions', 'isLegalAction', 'uncommittedChoice', 'createInitialGameState', 'wantsStop'];
const ALLOWED = 'src/ui/table.ts';

function files(dir: string, deep: boolean): string[] {
  return readdirSync(join(ROOT, dir)).flatMap(name => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return deep ? files(path, true) : [];
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const screen = [...files('src/ui/components', true), ...files('src/ui', false), 'src/App.tsx'].map(p => relative(ROOT, join(ROOT, p)));

describe('UI boundary: only the table runs the engine', () => {
  it('finds the screen files', () => {
    expect(screen).toContain('src/App.tsx');
    expect(screen).toContain('src/ui/useGameController.ts');
    expect(screen).toContain('src/ui/components/ActionBars.tsx');
    expect(screen).toContain(ALLOWED);
  });

  for (const file of screen.filter(f => f !== ALLOWED)) {
    it(`${file} does not use ${ENGINE_ONLY.join(', ')}`, () => {
      const src = readFileSync(join(ROOT, file), 'utf8');
      // Any mention counts (an import, a call, a re-export under another name), so no detour through another module goes unseen
      const used = ENGINE_ONLY.filter(name => new RegExp(`\\b${name}\\b`).test(src));
      expect(used).toEqual([]);
    });
  }

  it('the table may', () => {
    const src = readFileSync(join(ROOT, ALLOWED), 'utf8');
    expect(ENGINE_ONLY.filter(name => new RegExp(`\\b${name}\\b`).test(src)).length).toBeGreaterThan(0);
  });
});
