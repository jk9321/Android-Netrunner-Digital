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
/**
 * The seat's legality without the real state, shared by the local and the online table (chunk 2c): the own-side
 * probes (isLegalAction) and the reason text of a blocked action (executeAction), on the viewer's reconstruction only.
 */
const SEAT_LEGALITY = 'src/ui/seatLegality.ts';
const SEAT_LEGALITY_MAY = ['isLegalAction', 'executeAction'];

function files(dir: string, deep: boolean): string[] {
  return readdirSync(join(ROOT, dir)).flatMap(name => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return deep ? files(path, true) : [];
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// The online client (src/net: the online table and the lobby calls) is screen code too: it holds only the seat's view.
// src/net/protocol.ts is shared with the game server (types and the action sanitizer, no engine calls) and is not listed.
const screen = [...files('src/ui/components', true), ...files('src/ui', false), ...files('src/net', true).filter(f => !f.endsWith('protocol.ts')), 'src/App.tsx'].map(p =>
  relative(ROOT, join(ROOT, p)),
);

describe('UI boundary: only the table runs the engine', () => {
  it('finds the screen files', () => {
    expect(screen).toContain('src/App.tsx');
    expect(screen).toContain('src/ui/useGameController.ts');
    expect(screen).toContain('src/ui/components/ActionBars.tsx');
    expect(screen).toContain('src/ui/useOnlineController.ts');
    expect(screen).toContain('src/net/client.ts');
    expect(screen).toContain(ALLOWED);
    expect(screen).toContain(SEAT_LEGALITY);
  });

  for (const file of screen.filter(f => f !== ALLOWED && f !== SEAT_LEGALITY)) {
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
      'playCost', 'playableHostZones', 'requiredAgendaPoints', 'rezCost', 'rezCostOf', 'runnerInstallCost', 'stateFromView', 'trashableFirst',
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
          if (file === SEAT_LEGALITY && SEAT_LEGALITY_MAY.includes(name)) continue;
          if (!imported.has(name)) imported.set(name, file);
        }
      }
    }
    expect([...imported].filter(([name]) => !ALLOWED_CORE.includes(name)).map(([name, file]) => `${name} (${file})`)).toEqual([]);
    // The list stays current: every name on it is still imported somewhere
    expect(ALLOWED_CORE.filter(name => !imported.has(name))).toEqual([]);
  });

  it(`${SEAT_LEGALITY} uses only ${SEAT_LEGALITY_MAY.join(' and ')}, for the own-side probes on the reconstruction`, () => {
    const src = readFileSync(join(ROOT, SEAT_LEGALITY), 'utf8');
    expect(ENGINE_ONLY.filter(name => new RegExp(`\\b${name}\\b`).test(src)).sort()).toEqual([...SEAT_LEGALITY_MAY].sort());
    // Nothing in it reaches a real state: it takes only the seat's legal list and the viewer's reconstruction
    expect(src).not.toMatch(/\bTableCore\b|\bviewFor\b|\bLocalTable\b/);
  });

  it('the table may', () => {
    const src = readFileSync(join(ROOT, ALLOWED), 'utf8');
    expect(ENGINE_ONLY.filter(name => new RegExp(`\\b${name}\\b`).test(src)).length).toBeGreaterThan(0);
  });
});
