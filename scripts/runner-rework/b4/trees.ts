/**
 * B4 step 0 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b4-hidden-zones.md rev 1a): the trees step0.ts
 * reads. Measurement only: no src change.
 *
 *  source   this checkout's src (or ARM_BASE's, armSource) copied unchanged; it plays the source games and is never asked
 *           or cleared mid-game
 *  shadowW  a copy with the W engine patch only (below); it replays the source game's actions in lockstep and is never
 *           asked: its state is the source state with the Runner's R&D marks kept through a shuffle
 *  probe    a copy with the arm hooks only; every control ask and the arms that need no engine change are asked here
 *  probeW   a copy with the W engine patch and the hooks; the R&D arms are asked here, on the shadow's state, so the
 *           look-ahead keeps its marks through a shuffle too
 *
 * W (ruling 1, R&D): `shuffleRD` turns every Runner R&D mark into "in R&D, share 1 / N0 per place" (lo 0, hi last, and
 * `n0` = R&D's size at the shuffle) instead of emptying it; a mark that may already have left R&D (`left`) is dropped, as today. The Corp's own marks (`rdKnownToCorp`) are emptied as today.
 * With no hook set, every reader of `rdKnownToRunner` in the AI skips an entry with `n0` (rdWorth, knownRdSlots,
 * runnerRdMemoryOnDeal), so probeW with no hook plays as today: the prototype of ruling 3's play-identical engine commit
 * (asked as `ctrlW`).
 *
 * Hooks (`globalThis.__B4_<tree>`; unset = the line as it was). Each reads the step's data from `state.corp.__b4` (set on
 * the asked board; carried, stale, through the look-ahead's copies):
 *  odds(state, server, card, trap)  top of remoteAgendaOdds: a number replaces the answer
 *  upgradeOnly(card)                serverWorth's trap share is 0 for that card (an upgrade is no trap)
 *  deal(card)                       dealRunnerUnknowns: that unadvanced facedown root slot takes an upgrade code first
 *  hq(state, known, size, odds)     hqAgendaOdds: a number replaces the answer (7a)
 *  rdShare                          rdWorth reads an `n0` entry at share 1 / n0 (7b)
 *  archUnknown(state)               the Archives price's count of facedown cards (7c)
 *  traps {skip(state, card), codes(state)}   unseenTraps: the map's entries for those cards are not read; these codes
 *                                   come out of the trap pool instead (7d)
 *  dealHq, place(s, loose)          runnerUnknownSlots keeps no HQ card by id; after the deal, place() puts marked codes
 *                                   in their zones (7e)
 *  gripIds(state)                   corpSeenGrip, muWorth and winNow's grip: the ids it returns, chosen by code and count
 *  saveView, nbView, dvView, crView saveUpTarget, needsBiggerHand, digValue, chainReactionBonus read the Runner's view
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
    `  { const last = Math.max(0, state.corp.rd.length - 1); state.corp.rdKnownToRunner = (state.corp.rdKnownToRunner ?? []).filter(e => !e.left).map(e => ({ id: e.id, code: e.code, lo: 0, hi: last, n0: state.corp.rd.length }) as typeof e); }\n`,
  ],
];

const hooks = (name: string): Patch[] => {
  const G = `((globalThis as any).__B4_${name} ?? {})`;
  const L = '  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n';
  return [
    ['ai/runs.ts', `export function remoteAgendaOdds(state: GameState, server: { ice: CardInstance[] }, card: CardInstance, trap: number): number {\n`, `export function remoteAgendaOdds(state: GameState, server: { ice: CardInstance[] }, card: CardInstance, trap: number): number {\n${L}  const __b4 = ${G}.odds?.(state, server, card, trap);\n  if (__b4 !== undefined) return __b4;\n`],
    ['ai/runs.ts', `      const trapShare = Math.min(1 - agenda, trap);\n`, `${L}      const trapShare = ${G}.upgradeOnly?.(card) ? 0 : Math.min(1 - agenda, trap);\n`],
    ['ai/runs.ts', `  return (agendas + (size - known.length) * odds) / size;\n`, `${L}  const __b4hq = ${G}.hq?.(state, known, size, odds);\n  if (__b4hq !== undefined) return __b4hq;\n  return (agendas + (size - known.length) * odds) / size;\n`],
    ['ai/runs.ts', `      const share = 1 / (e.hi - e.lo + 1);\n`, `${L}      const share = (e as any).n0 ? (${G}.rdShare ? 1 / (e as any).n0 : 0) : 1 / (e.hi - e.lo + 1);\n`],
    ['ai/runs.ts', `Math.min(3, state.corp.archives.faceDown.length) * odds * chosen`, `Math.min(3, ${G}.archUnknown ? ${G}.archUnknown(state) : state.corp.archives.faceDown.length) * odds * chosen`],
    ['ai/runs.ts', `  for (const card of hidden) {\n    const seen = memory?.get(card.instanceId);\n`, `${L}  const __b4t = ${G}.traps;\n  for (const card of hidden) {\n    if (__b4t?.skip(state, card)) continue;\n    const seen = memory?.get(card.instanceId);\n`],
    ['ai/runs.ts', `  const traps = codes.filter(isTrap);\n`, `  if (__b4t)\n    for (const code of __b4t.codes(state)) {\n      const at = codes.indexOf(code);\n      if (at >= 0) codes.splice(at, 1);\n    }\n  const traps = codes.filter(isTrap);\n`],
    ['ai/runnerReply.ts', `  for (const e of knownInRd(state)) if (e.lo === e.hi && state.corp.rd[e.lo]?.instanceId === e.id) slots.add(e.lo);\n`, `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  for (const e of knownInRd(state)) if (!(e as any).n0 && e.lo === e.hi && state.corp.rd[e.lo]?.instanceId === e.id) slots.add(e.lo);\n`],
    ['ai/runnerReply.ts', `  const known = state.corp.rdKnownToRunner;\n  if (!known?.length) return known;\n`, `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  const known = state.corp.rdKnownToRunner?.filter(e => !(e as any).n0);\n  if (!known?.length) return known;\n`],
    ['ai/runnerReply.ts', `  const knownHq = new Set(knownInHand(state, 'corp').map(k => k.id));\n`, `${L}  const knownHq = ${G}.dealHq ? new Set<string>() : new Set(knownInHand(state, 'corp').map(k => k.id));\n`],
    ['ai/runnerReply.ts', `  loose.forEach((card, i) => (card.cardCode = codes[i]));\n`, `  loose.forEach((card, i) => (card.cardCode = codes[i]));\n${L}  ${G}.place?.(s, loose);\n`],
    [
      'ai/runnerReply.ts',
      `  for (const card of root.filter(c => c.advancementCounters <= 0)) card.cardCode = dealt(take(isRoot));\n`,
      `${L}  const __b4deal = ${G}.deal;\n  for (const card of root.filter(c => c.advancementCounters <= 0)) card.cardCode = dealt((__b4deal?.(card) ? take(code => typeOf(code) === 'upgrade') : undefined) ?? take(isRoot));\n`,
    ],
    ['ai/oracle.ts', `  return new Set(knownInHand(state, 'runner').map(k => k.id));\n`, `${L}  if (${G}.gripIds) return ${G}.gripIds(state);\n  return new Set(knownInHand(state, 'runner').map(k => k.id));\n`],
    ['ai/effectValues.ts', `  const seen = actingSide() === 'corp' ? new Set(knownInHand(state, 'runner').map(k => k.id)) : undefined;\n`, `${L}  const seen = actingSide() === 'corp' ? (${G}.gripIds ? ${G}.gripIds(state) : new Set(knownInHand(state, 'runner').map(k => k.id))) : undefined;\n`],
    ['ai/winNow.ts', `  const known = new Set(knownInHand(state, 'runner').map(e => e.id));\n`, `${L}  const known: Set<string> = ${G}.gripIds ? ${G}.gripIds(state) : new Set(knownInHand(state, 'runner').map(e => e.id));\n`],
    ['ai/runnerAI.ts', `    this.savingFor = this.synergy ? saveUpTarget(state, this.memory) : null;\n`, `${L}    this.savingFor = this.synergy ? saveUpTarget(${G}.saveView ? view : state, this.memory) : null;\n`],
    ['ai/runnerAI.ts', `needsBiggerHand(state, this.memory)`, `needsBiggerHand(${G}.nbView ? view : state, this.memory)`],
    ['ai/runnerAI.ts', `score += digValue(state, 'runner');`, `score += digValue(${G}.dvView ? view : state, 'runner');`],
    ['ai/runnerAI.ts', `successBonus: chainReactionBonus(state, action.targetServerId)`, `successBonus: chainReactionBonus(${G}.crView ? view : state, action.targetServerId)`],
    ['ai/runnerAI.ts', `\nfunction saveUpTarget(state: GameState, memory: RunnerMemory): string | null {`, `\nexport function saveUpTarget(state: GameState, memory: RunnerMemory): string | null {`],
  ];
};

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
