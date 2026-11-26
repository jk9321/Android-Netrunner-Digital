/**
 * B4 step 0 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b4-hidden-zones.md rev 0): the trees step0.ts
 * reads. Measurement only: no src change.
 *
 *  source   this checkout's src (or ARM_BASE's, armSource) copied unchanged; it plays the source games and is never asked
 *           or cleared mid-game
 *  shadowW  a copy with the W engine patch only (below); it replays the source game's actions in lockstep and is never
 *           asked: its state is the source state with the Runner's R&D marks widened on a shuffle
 *  probe    a copy with the arm hooks only (they read `globalThis.__B4_probe`, unset = the line as it was); every control
 *           ask and the H, Ra, Rad and Rb arms are asked here
 *  probeW   a copy with the W engine patch and the hooks (`globalThis.__B4_probeW`); arm W is asked here, on the shadow's
 *           state, so its look-ahead widens on a shuffle too
 *
 * W (the engine fact's R&D part as the design states it, rev 0, part 1): `shuffleRD` widens every Runner R&D mark to the
 * whole deck (lo 0, hi last; rules 4.2.2, 8.7.3: a shuffle loses the order, not the contents) instead of emptying it.
 * The Corp's own marks (`rdKnownToCorp`) are emptied as today.
 * Hooks: `odds(state, server, card, trap)` at the top of `remoteAgendaOdds` (a number replaces the answer; undefined: as
 * it was), and `deal(card)` in `dealRunnerUnknowns` (true: that unadvanced facedown root slot takes an upgrade code
 * first, then any root code as before).
 *
 * Each patch must match exactly once (a stop otherwise, as the other counts' trees).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { armSource } from '../../tag-owner/trees';

type Patch = [file: string, at: string, to: string];
export const TREES = ['source', 'shadowW', 'probe', 'probeW'] as const;
export type TreeName = (typeof TREES)[number];

const W: Patch[] = [
  [
    'core/engine/rdKnowledge.ts',
    `  state.corp.rdKnownToRunner = [];\n`,
    `  { const last = Math.max(0, state.corp.rd.length - 1); state.corp.rdKnownToRunner = (state.corp.rdKnownToRunner ?? []).map(e => ({ ...e, lo: 0, hi: last })); }\n`,
  ],
];

const hooks = (name: string): Patch[] => [
  [
    'ai/runs.ts',
    `export function remoteAgendaOdds(state: GameState, server: { ice: CardInstance[] }, card: CardInstance, trap: number): number {\n`,
    `export function remoteAgendaOdds(state: GameState, server: { ice: CardInstance[] }, card: CardInstance, trap: number): number {\n  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  const __b4 = (globalThis as any).__B4_${name}?.odds?.(state, server, card, trap);\n  if (__b4 !== undefined) return __b4;\n`,
  ],
  [
    'ai/runnerReply.ts',
    `  for (const card of root.filter(c => c.advancementCounters <= 0)) card.cardCode = dealt(take(isRoot));\n`,
    `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  const __b4deal = (globalThis as any).__B4_${name}?.deal;\n  for (const card of root.filter(c => c.advancementCounters <= 0)) card.cardCode = dealt((__b4deal?.(card) ? take(code => typeOf(code) === 'upgrade') : undefined) ?? take(isRoot));\n`,
  ],
];

const PATCHES: Record<TreeName, Patch[]> = { source: [], shadowW: W, probe: hooks('probe'), probeW: [...W, ...hooks('probeW')] };

export function makeB4Trees(root: string, shard = 0): Record<TreeName, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const from = armSource(root, shard);
  const dirs = {} as Record<TreeName, string>;
  for (const name of TREES) {
    const dir = join(root, name);
    dirs[name] = dir;
    cpSync(from, join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of PATCHES[name]) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`${name} tree: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(
        path,
        text.replace(at, () => to)
      );
    }
  }
  return dirs;
}
