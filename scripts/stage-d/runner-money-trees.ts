/**
 * Stage D item 1 follow-up 4 (brief section 2.3): the arms of the Runner's money, as copies of this tree's src/ with text
 * patches (scripts/stage-d/runner-money-arms.json: `{ "<group>": [[file under src/, beta text, arm text], ...],
 * "_arms": { "<arm>": ["<group>", ...] } }`). Unlike value-b1/fire-count.ts, whose patches put the base back, these
 * ADD to beta: this tree is beta (nothing under src/ changes in step 1) and each arm is beta with its groups' patches.
 * Also: which group's cards are in play on a board (the "where a card of the group is in play" counts).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameState, cardDef } from '../../src/core';
import { counters } from '../../src/core/engine/cardEffects';

export type Patch = [file: string, from: string, to: string];
export interface ArmFile {
  groups: Record<string, Patch[]>;
  arms: Record<string, string[]>;
}

export function readArms(path = 'scripts/stage-d/runner-money-arms.json'): ArmFile {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const arms = raw._arms as Record<string, string[]>;
  delete raw._arms;
  const only = (process.env.ARMS ?? '').split(',').filter(Boolean);
  return { groups: raw as Record<string, Patch[]>, arms: only.length ? Object.fromEntries(Object.entries(arms).filter(([a]) => only.includes(a))) : arms };
}

/** One copy of src/ per arm under `root` (each patch must match exactly once); returns arm -> directory. */
export function makeTrees(file: ArmFile, root: string): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const [arm, groups] of Object.entries(file.arms)) {
    const dir = resolve(join(root, arm));
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [f, from, to] of groups.flatMap(g => file.groups[g])) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(from).length !== 2) throw new Error(`arm ${arm}: a patch does not match once in ${f}: ${from.slice(0, 60)}`);
      writeFileSync(path, text.replace(from, to));
    }
    dirs[arm] = dir;
  }
  return dirs;
}

const rig = (s: GameState): CardInstance[] => [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
/** Money events of the F2 arms (net credits over a click; runner-money-arms.json GRIP_MONEY). */
export const GRIP_MONEY = new Set(['30030', '30020', '34001', '30029', '34087', '36011']);

/**
 * The groups whose cards are in play on a board, by what the arm reads: an installed card (and, for the counter
 * group, a counter on it), Lightning Laboratory's turn flag, and for F2 a money event unseen (grip and stack) with a
 * card in the grip. Plus "known": the installed cards of the inventory the arms do not model (listed by title).
 */
export function present(s: GameState): Record<string, boolean | string[]> {
  const r = rig(s);
  const has = (code: string) => r.some(c => c.cardCode === code);
  const unseen = [...s.runner.grip, ...s.runner.stack];
  const known = r.filter(c => UNMODELLED.has(c.cardCode)).map(c => cardDef(c).title);
  return {
    counter: r.some(c => c.cardCode === '34089' && counters(c, 'power') > 0),
    runBegin: has('35034') || has('35033'),
    saci: has('34017'),
    lightning: s.corp.scoreArea.some(a => !!s.turnFlags?.[`lightning:${a.instanceId}`]),
    arru: has('34073'),
    f2: s.runner.grip.length > 0 && unseen.some(c => GRIP_MONEY.has(c.cardCode)),
    known: [...new Set(known)],
  };
}

/** Installed cards of the inventory that the arms leave out (runner-money-inventory.ts, groups C to F), for the presence counts. */
const UNMODELLED = new Set([
  '36024', // Stowaway: a successful run on its server
  '30014', // Pennyshaver: a successful run adds to its click ability
  '30018', // Red Team: a click-run, if successful
  '34019', // Debbie "Downtown" Moreira: hosted credits on its own click-run
  '36020', // Methuselah: a hardware from the grip when a run begins (hidden)
  '36003', // The Tungsten Tailor: 1 credit on a break at 0 strength
  '34084', // Juli Moreira Lee: a click
  '34008', // Hannah "Wheels" Pilintra: clicks
  '34025', // Pichação: a click passing its host
  '34013', // Capybara: a derez on a bypass
  '34016', // Laser Pointer: a bypass
  '34081', // Malandragem: a bypass
  '34015', // Curupira: a bypass with counters
  '34022', // AirbladeX: prevents a "when encountered" ability
  '35021', // Fransofia Ward: a bypass when the Corp has 15
  '34078', // Alarm Clock: a turn-start run on HQ, a bypass for 2 clicks
  '34007', // Eru Ayase-Pessoa: R&D through Archives
  '34028', // Beatriz Friere Gonzalez: R&D through HQ
  '36015', // Baker: HQ or R&D through Archives
  '35019', // Maglectric Rapid: a derez after an HQ run
]);
