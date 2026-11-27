/**
 * R-105 step 0 part 3 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/r105-upkeep-skip.md rev 0a): a prototype
 * of part 1 (the skip in updateHandKnowledge), as patches to a scratch checkout's src/core/engine/helpers.ts at bae7c82.
 * Measurement only: no src change. The scratch checkout is then timed by b4/lockstep.ts (CLEAR=1 PICKS=1 FOLLOW=1, no
 * hooks) with BASE=bae7c82, so base and control are bae7c82 and the branch is the prototype.
 *
 *   npx vite-node scripts/runner-rework/r105/proto.ts -- DIR=<scratch checkout>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Patch, applyPatches } from '../core-hooks';

for (const kv of process.argv.slice(2).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}

const SKIP = `type LossKind = keyof KnownLosses;

// R-105 prototype: the cheap tests that each walk of updateHandKnowledge would leave its list as it is
function sameIds(a: CardInstance[], b: CardInstance[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].instanceId !== b[i].instanceId) return false;
  return true;
}
const openFlag = (c: CardInstance): boolean => !!(c.isRezzed || c.faceUp || c.runnerKnows);
function sameCards(a: CardInstance[], b: CardInstance[], flag: boolean): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p.instanceId !== q.instanceId) return false;
    if (flag && openFlag(p) !== openFlag(q)) return false;
    const x = p.hostedCards;
    const y = q.hostedCards;
    const n = x ? x.length : 0;
    if (n !== (y ? y.length : 0)) return false;
    for (let j = 0; j < n; j++) if (x![j].instanceId !== y![j].instanceId) return false;
  }
  return true;
}
function sameOpen(prev: GameState, state: GameState): boolean {
  const ps = prev.corp.servers;
  const ss = state.corp.servers;
  let n = 0;
  for (const k in ss) {
    const p = ps[k];
    if (!p) return false;
    const s = ss[k];
    if (!sameCards(p.root, s.root, true) || !sameCards(p.ice, s.ice, true)) return false;
    n++;
  }
  for (const k in ps) if (k) n--;
  if (n !== 0) return false;
  const pr = prev.runner;
  const sr = state.runner;
  return (
    sameCards(prev.corp.archives.faceUp, state.corp.archives.faceUp, false) &&
    sameCards(prev.corp.scoreArea, state.corp.scoreArea, false) &&
    sameCards(pr.scoreArea, sr.scoreArea, false) &&
    sameCards(pr.heap, sr.heap, false) &&
    sameCards(pr.rig.programs, sr.rig.programs, false) &&
    sameCards(pr.rig.hardware, sr.rig.hardware, false) &&
    sameCards(pr.rig.resources, sr.rig.resources, false) &&
    sameCards(prev.removedFromGame, state.removedFromGame, false)
  );
}
function entriesFit(list: KnownHandCard[] | undefined, hand: CardInstance[]): boolean {
  if (!list) return true;
  if (list.length > hand.length) return false;
  for (let i = 0; i < list.length; i++) if (typeof list[i] !== 'object') return false;
  return true;
}
function handWalkIdle(prev: GameState, state: GameState): boolean {
  const hq = state.corp.hq;
  const grip = state.runner.grip;
  if (!sameIds(prev.corp.hq, hq) || !sameIds(prev.runner.grip, grip)) return false;
  const corp = state.corp.knownToRunner;
  if (!entriesFit(corp, hq) || !entriesFit(state.runner.knownToCorp, grip)) return false;
  const marks = state.corp.rdKnownToRunner;
  if (corp && marks && marks.length > 0) {
    for (let i = 0; i < corp.length; i++) {
      const id = corp[i].id;
      let inHq = false;
      for (let j = 0; j < hq.length && !inHq; j++) inHq = hq[j].instanceId === id;
      if (inHq) continue;
      for (let j = 0; j < marks.length; j++) if (marks[j].id === id) return false;
    }
  }
  return sameOpen(prev, state);
}`;

export const PROTO: Patch[] = [
  ['core/engine/helpers.ts', `type LossKind = keyof KnownLosses;`, SKIP],
  [
    'core/engine/helpers.ts',
    `    if (now.length === 0) continue;\n    const wasIds = new Set(was.map(c => c.instanceId));\n    const deck`,
    `    if (now.length === 0 || sameIds(was, now)) continue;\n    const wasIds = new Set(was.map(c => c.instanceId));\n    const deck`,
  ],
  [
    'core/engine/helpers.ts',
    `  updateArchivesKnowledge(prev, state);\n  noteOpenArrivals(prev, state);\n  if (knownList(state, 'corp').length === 0 && knownList(state, 'runner').length === 0) return;`,
    `  const arch = state.corp.archives.faceDown;\n  if (!sameIds(prev.corp.archives.faceDown, arch) || (state.corp.archKnownToRunner?.length ?? 0) > arch.length) updateArchivesKnowledge(prev, state);\n  noteOpenArrivals(prev, state);\n  if (knownList(state, 'corp').length === 0 && knownList(state, 'runner').length === 0) return;\n  if (handWalkIdle(prev, state)) return;`,
  ],
];

/**
 * The looser open test as a fallback (brief part 1, "A looser test for the open zones"): where the strict compare fails,
 * the walk would still write nothing if no card is open in \`state\` that was not open in \`prev\` (the walk's \`surfaced\`
 * is then empty; its departures need a hand change). One Map of prev's open cards, only on a strict miss.
 */
export const PROTO_LOOSE: Patch[] = [
  ...PROTO.slice(0, 2),
  [
    PROTO[2][0],
    PROTO[2][1],
    PROTO[2][2],
  ],
  [
    'core/engine/helpers.ts',
    `  return sameOpen(prev, state);\n}`,
    `  return sameOpen(prev, state) || noneSurfaced(prev, state);\n}\nfunction noneSurfaced(prev: GameState, state: GameState): boolean {\n  const before = publicCards(prev);\n  const all = (list: CardInstance[], flag: boolean): boolean => {\n    for (const c of list) {\n      if (flag && !openFlag(c)) continue;\n      if (!before.has(c.instanceId)) return false;\n      for (const h of c.hostedCards ?? []) if (!before.has(h.instanceId)) return false;\n    }\n    return true;\n  };\n  for (const k in state.corp.servers) {\n    const s = state.corp.servers[k];\n    if (!all(s.root, true) || !all(s.ice, true)) return false;\n  }\n  const r = state.runner;\n  return all(state.corp.archives.faceUp, false) && all(state.corp.scoreArea, false) && all(r.scoreArea, false) && all(r.heap, false) && all(r.rig.programs, false) && all(r.rig.hardware, false) && all(r.rig.resources, false) && all(state.removedFromGame, false);\n}`,
  ],
];

if (process.env.DIR) {
  applyPatches(process.env.DIR, process.env.LOOSE === '1' ? PROTO_LOOSE : PROTO, 'r105 prototype', p => readFileSync(p, 'utf8'), (p, t) => writeFileSync(p, t));
  console.log(`patched ${process.env.DIR}/src/core/engine/helpers.ts`);
}
