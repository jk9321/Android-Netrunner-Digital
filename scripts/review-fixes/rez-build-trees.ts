/**
 * Bundle R, the build's reading (rez-build brief rev 1, "Judged by": the count's reading again on the built tree).
 * Trees for the count's own driver (rez-count.ts, run by rez-build.ts with this module in place of rez-count-trees.ts):
 *  - beta, control, source: the merge base's src (beta 522ed857; src unchanged through beta 900bc5e4);
 *  - builtA: the commit of fix A (e2cb957: rez.ts built, rezMoney.ts as beta);
 *  - builtB: the commit of fix B (25e25e2, the hand-off's src: both built).
 * Each tree gets the count's record patches for its 'beta' arm (rez-count-trees.ts makeTrees: fires and measures only;
 * no counted arm's patch). The checkout this runs on is the hand-off's tree; the base and builtA files are made from it
 * by undoing the build's edits (BUILT, each matched exactly once), and every one of the two files of every tree is checked
 * against its git blob id at the commit it stands for, so a tree is that commit's file or the script stops.
 * builtB: the count's R&D patch matches beta's `const out = ['rd'];` (and would put R&D back); on builtB it is matched
 * on beta's line and the built line is then put back in its place, with the count's `rdOut` fire on it (asserted).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Tree, loadTree, makeTrees as makeCountTrees } from './rez-count-trees';

export { loadTree };
export type { Tree };
export const ARMS = ['beta', 'control', 'source', 'builtA', 'builtB'] as const;
export type Arm = (typeof ARMS)[number];
export const RZ_ARMS: Arm[] = ['builtA', 'builtB'];

const REZ = 'ai/corp/rez.ts';
const MONEY = 'ai/corp/rezMoney.ts';
/** git blob ids (git rev-parse <commit>:src/<file>) of the two files at each commit. */
const BLOB: Record<'base' | 'builtA' | 'builtB', Record<string, string>> = {
  base: { [REZ]: '07ae07d985e5a70534cb20beb16d67551e4d1a8e', [MONEY]: 'b14a9f007aa02b9d044f0491fccdcda07d7ff5d0' },
  builtA: { [REZ]: 'eff607f7f2724794513fe032c5869a5b2f0e91b0', [MONEY]: 'b14a9f007aa02b9d044f0491fccdcda07d7ff5d0' },
  builtB: { [REZ]: 'eff607f7f2724794513fe032c5869a5b2f0e91b0', [MONEY]: 'bb38f4c7679367f1af04115b1934b1881eedd531' },
};
const blob = (text: string) => {
  const buf = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
};

/** The build's edits, [file, built text, beta's text]: undone to make beta's file from the built one. */
const BUILT: [string, string, string][] = [
  [
    REZ,
    `/**
 * A run stopper, when the Runner is about to get into something that matters. LEO when its trash is worth it (leoGain
 * above 0); else (or unpriced, -Infinity) the others by the thresholds every identity uses (registry debt; rez-build A).
 */`,
    `/** LEO Construction or Proprionegation, when the Runner is about to get into something that matters. */`,
  ],
  [REZ, `  if (leo && leoGain(state, leo, synergy) > 0) return leo;\n`, `  if (leo) return leoGain(state, leo, synergy) > 0 ? leo : null;\n`],
  [
    REZ,
    `    const code = findCardAnywhere(state, action.cardInstanceId)?.cardCode;\n    if (code === '35048'`,
    `    const code = findCardAnywhere(state, action.cardInstanceId)?.cardCode;\n    if (code === '35035') return action; // LEO: trash a bioroid, end the run\n    if (code === '35048'`,
  ],
  [MONEY, `import { memo } from '../valueModel';\nimport { agendasUnseen } from './pools';\n`, `import { memo } from '../valueModel';\n`],
  [
    MONEY,
    ` * R&D while the deck list has an agenda left there (agendasUnseen, the pools' owner; rule 10.2.2a: the set, never its
 * order); HQ while it holds an agenda; a remote with an agenda in its root. A card the caller is about to score or install leaves the pools (\`without\`).`,
    ` * R&D always (the deck list's agendas still there, rule 10.2.2a: never its order); HQ while it holds an agenda; a remote
 * with an agenda in its root. A card the caller is about to score or install leaves the pools (\`without\`).`,
  ],
  [
    MONEY,
    `/** The servers that stake an agenda through the Runner's next turn: R&D (while agendasUnseen is above 0), then HQ, then remotes in id order. */`,
    `/** The servers that stake an agenda through the Runner's next turn, R&D first, then HQ, then remotes in id order. */`,
  ],
  [MONEY, `  const out = agendasUnseen(state) > 0 ? ['rd'] : [];\n`, `  const out = ['rd'];\n`],
];
const BUILT_RD = `  const out = agendasUnseen(state) > 0 ? ['rd'] : [];`;
const PATCHED_RD = `  const out = false && __unseen(state) <= 0 ? (__rzF('rdOut'), [] as string[]) : ['rd'];`;
const FIRED_RD = `  const out = agendasUnseen(state) > 0 ? ['rd'] : (__rzF('rdOut'), [] as string[]);`;

const once = (text: string, at: string, to: string, what: string) => {
  if (text.split(at).length !== 2) throw new Error(`rez-build trees: ${what} does not match once: ${at.slice(0, 80)}`);
  return text.replace(at, () => to);
};

/** src for one commit: the checkout's src with the edits of the later fixes undone, each file checked by its blob id. */
function srcFor(dir: string, which: 'base' | 'builtA' | 'builtB', from = 'src') {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(from, dir, { recursive: true });
  for (const f of [REZ, MONEY]) {
    const head = readFileSync(join(from, f), 'utf8');
    if (blob(head) !== BLOB.builtB[f]) throw new Error(`rez-build trees: the checkout's src/${f} is not the hand-off's (blob ${blob(head)})`);
    let text = head;
    const undo = BUILT.filter(([file]) => file === f && (which === 'base' || (which === 'builtA' && f === MONEY)));
    for (const [, built, beta] of undo) text = once(text, built, beta, `undo ${f}`);
    if (blob(text) !== BLOB[which][f]) throw new Error(`rez-build trees: src/${f} for ${which} is not that commit's (blob ${blob(text)})`);
    writeFileSync(join(dir, f), text);
  }
}

/** The trees, each in root/<arm>/src (as the count's makeTrees). */
export function makeTrees(root: string, arms: readonly Arm[]): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  const base = arms.filter(a => a === 'beta' || a === 'control' || a === 'source');
  if (base.length) {
    srcFor(join(root, 'src-base'), 'base');
    Object.assign(dirs, makeCountTrees(join(root, 'base'), base, join(root, 'src-base')));
  }
  if (arms.includes('builtA')) {
    srcFor(join(root, 'src-builtA'), 'builtA');
    dirs.builtA = makeCountTrees(join(root, 'builtA'), ['beta'], join(root, 'src-builtA')).beta;
  }
  if (arms.includes('builtB')) {
    const src = join(root, 'src-builtB');
    srcFor(src, 'builtB');
    // The count's R&D patch is matched on beta's line, then the built line is put back with the fire
    const money = join(src, MONEY);
    writeFileSync(money, once(readFileSync(money, 'utf8'), BUILT_RD, `  const out = ['rd'];`, 'builtB R&D line (in)'));
    const dir = makeCountTrees(join(root, 'builtB'), ['beta'], src).beta;
    const tree = join(dir, 'src', MONEY);
    writeFileSync(tree, once(readFileSync(tree, 'utf8'), PATCHED_RD, FIRED_RD, 'builtB R&D line (out)'));
    dirs.builtB = dir;
  }
  return dirs;
}
