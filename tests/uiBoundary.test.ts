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

  it('screen files import only the listed core functions and constants (a new one fails until added here)', () => {
    // Everything here runs on the viewer's reconstruction (src/core/view/reconstruct.ts), never on the real state.
    // Adding a name: check it reads only what the view carries, then list it.
    const ALLOWED_CORE = [
      'DEFAULT_FORMAT', 'FORMATS', 'HIDDEN_CORP',
      'actingSide', 'activePrompt', 'availableCredits', 'boostCostOf', 'breakerScript', 'breakerStrength', 'cardDef', 'counters',
      'creditSources', 'describeFormatStatuses', 'effectTrashableFirst', 'encounteredIce', 'findCardAnywhere', 'formatStatuses',
      'getCardDefinition', 'getCardScript', 'getFormat', 'iceScript', 'iceStrength', 'iceSubroutines', 'iceSubtypes', 'influenceCost',
      'installedIce', 'installedIcebreakers', 'isBanned', 'isHidden', 'isInCardPool', 'knownInHand', 'knownInRd', 'locateCorpCard',
      'playCost', 'playableHostZones', 'requiredAgendaPoints', 'rezCost', 'rezCostOf', 'runnerInstallCost', 'trashableFirst',
      'validateDeck', 'virusCountersInPlay',
    ];
    const imported = new Map<string, string>();
    for (const file of screen.filter(f => f !== ALLOWED)) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
        if (m[1] || !/(^|\/)core(\/|$)/.test(m[3])) continue;
        for (const spec of m[2].split(',').map(x => x.trim())) {
          const name = spec.split(/\s+as\s+/)[0].trim();
          // Types (PascalCase) carry no behaviour
          if (!name || spec.startsWith('type ') || /^[A-Z][a-z]/.test(name)) continue;
          if (!imported.has(name)) imported.set(name, file);
        }
      }
    }
    expect([...imported].filter(([name]) => !ALLOWED_CORE.includes(name)).map(([name, file]) => `${name} (${file})`)).toEqual([]);
    // The list stays current: every name on it is still imported somewhere
    expect(ALLOWED_CORE.filter(name => !imported.has(name))).toEqual([]);
  });

  it('the table may', () => {
    const src = readFileSync(join(ROOT, ALLOWED), 'utf8');
    expect(ENGINE_ONLY.filter(name => new RegExp(`\\b${name}\\b`).test(src)).length).toBeGreaterThan(0);
  });
});
