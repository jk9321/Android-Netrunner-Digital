/**
 * The count bound item, step 1 (brief: /mnt/project-files/netrunner-ai/stage-d/count-bound/brief.md), B1 and B2 on the
 * generated servers: tests/holdWalkReference.test.ts's generator (randomBoard and rng, copied below unchanged), 2,000
 * random servers (seed 20261117, the test's first seed), plus the test's 1,000 probe lines (seed 20261119: an outer ice
 * whose rez leaves the turn something) and 1,000 servers with Saci on the ice (seed 20261126), each named by `set`.
 * Each server is asked serverHold 'runnerTurn' on the instr tree twice, with the Corp's credits as they are and unlimited
 * (rezMoney's ask), and every question gathered is searched three ways (count-bound-lib.ts searchQuestion).
 *
 *   npx vite-node scripts/stage-d/count-bound-gen.ts > gen.jsonl
 */
import { createHash } from 'node:crypto';
import { GameState } from '../../src/core';
import { getCardDefinition } from '../../src/core/cards';
import { createCardInstance } from '../../src/core/engine/gameState';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';
import { breakerCodes, iceCodes } from './golden-prices';
import { cb, iceFacts, loadTree, makeTrees, out, pairCause, searchQuestion } from './count-bound-lib';

/** A small deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ICE = iceCodes();
const BREAKERS = breakerCodes();
const BOTULUS = '30004';
const IDENTITY_THUNDERBOLT = '34096';
const ENDERS = ICE.filter(code => /end the run\./i.test(getCardDefinition(code).text ?? ''));
const PROBES = ['30055', '35041', '35079', '34100', '36042', '34038', '34060', '34117'];
function randomBoard(r: () => number, first?: string, probe = false): { s: GameState; rez: string[] } {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const s = newGame(3);
  s.turnNumber = 7;
  s.corp.hq = s.corp.hq.slice(0, Math.floor(r() * 4));
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = Math.floor(r() * 9);
  s.runner.tags = r() < 0.3 ? Math.floor(r() * 3) : 0;
  s.runner.grip = s.runner.grip.slice(0, Math.floor(r() * 6));
  s.runner.maxClicks = probe ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 4);
  s.corp.credits = Math.floor(r() * 12);
  s.corp.badPublicity = r() < 0.15 ? 1 : 0;
  if (r() < (probe ? 0.3 : 0.1)) s.corp.identity = createCardInstance(s, IDENTITY_THUNDERBOLT);
  const ids: string[] = [];
  if (probe) {
    ids.push(installIceForTest(s, pick(ENDERS), 'remote1', r() < 0.5));
    if (r() < 0.4) ids.push(installIceForTest(s, pick(ICE), 'remote1', r() < 0.5));
    ids.push(installIceForTest(s, pick(PROBES), 'remote1', false));
  } else {
    if (first) ids.push(installIceForTest(s, first, 'remote1', r() < 0.5));
    for (let k = (first ? 0 : 1) + Math.floor(r() * 3); k > 0; k--) ids.push(installIceForTest(s, pick(ICE), 'remote1', r() < 0.6));
  }
  for (let k = Math.floor(r() * 3); k > 0; k--) installProgramForTest(s, pick(BREAKERS));
  if (r() < 0.15) {
    const b = createCardInstance(s, BOTULUS);
    b.isRezzed = true;
    b.hostedOnId = pick(ids);
    b.tokens = { virus: Math.floor(r() * 3) };
    s.runner.rig.programs.push(b);
  }
  if (first || r() < 0.25) installIceForTest(s, pick(ICE), 'hq', true);
  const unrezzed = s.corp.servers.remote1.ice.filter(c => !c.isRezzed).map(c => c.instanceId);
  const outer = ids[ids.length - 1];
  return { s, rez: unrezzed.filter(id => (probe && id === outer) || r() < 0.6) };
}
const saci = (s: GameState, r: () => number) => {
  const ice = s.corp.servers.remote1.ice;
  for (let k = r() < 0.25 ? 2 : 1; k > 0; k--) {
    const c = createCardInstance(s, '34017');
    c.isRezzed = true;
    c.hostedOnId = ice[Math.floor(r() * ice.length)].instanceId;
    s.runner.rig.programs.push(c);
  }
};

async function main() {
  const dirs = makeTrees(process.env.TROOT ?? 'node_modules/.cache/cb-gen', ['instr']);
  const t = await loadTree('instr', dirs.instr);
  const seen = new Set<string>();
  const SETS: [string, number, number, boolean, boolean][] = [
    ['random', 20261117, 2000, false, false],
    ['probe', 20261119, 1000, true, false],
    ['saci', 20261126, 1000, false, true],
  ];
  for (const [set, seed, count, probe, withSaci] of SETS) {
    const r = rng(seed);
    for (let n = 0; n < count; n++) {
      const { s } = randomBoard(r, undefined, probe);
      if (withSaci) saci(s, r);
      for (const credits of ['asIs', 'unlimited'] as const) {
        cb.on = true;
        cb.questions = new Map();
        cb.searches = [];
        cb.split = {};
        cb.stack = [];
        t.clear();
        try {
          t.asSide('corp', () => (t.decisionContext(s, 'corp'), t.hold.serverHold(s, 'remote1', { when: 'runnerTurn', ...(credits === 'unlimited' ? { corpCredits: Infinity } : {}) })));
        } finally {
          cb.on = false;
        }
        for (const [k, qq] of cb.questions) {
          const id = createHash('md5').update(k).digest('hex').slice(0, 16);
          if (seen.has(id)) continue;
          seen.add(id);
          const sq = searchQuestion(t, qq);
          const byMask = new Map(sq.rows.map(x => [x.mask, x]));
          const causes: Record<string, number> = {};
          for (const [a, b] of [...sq.v1, ...sq.v2.map(v => [v[0], v[1]] as [number, number])]) for (const c of pairCause(qq, a, b, byMask).causes) causes[c] = (causes[c] ?? 0) + 1;
          out({
            kind: 'q',
            src: `gen:${set}:${n}:${credits}`,
            qid: id,
            ...sq.facts,
            beta: sq.beta,
            arm: sq.arm,
            brute: sq.brute,
            same: sq.beta.holds === sq.arm.holds && (!sq.beta.holds || sq.beta.mask === sq.arm.mask) && sq.beta.need === sq.arm.need && sq.beta.entries === sq.arm.entries,
            setSame: sq.beta.mask === sq.arm.mask,
            armTie: sq.armTie,
            tieSame: sq.beta.holds === sq.armTie.holds && sq.beta.mask === sq.armTie.mask && sq.beta.need === sq.armTie.need && sq.beta.entries === sq.armTie.entries,
            cls: sq.cls,
            v1: sq.v1.length,
            v2: sq.v2.length,
            v1pairs: sq.v1.slice(0, 5),
            v2pairs: sq.v2.slice(0, 5),
            causes,
            ...(sq.v1.length || sq.v2.length ? { iceFacts: iceFacts(qq), sets: sq.rows.map(x => [x.mask, x.rez, x.need === Infinity ? 'inf' : x.need, x.holds ? 1 : 0]), board: { ice: s.corp.servers.remote1.ice.map(c => `${getCardDefinition(c.cardCode).title}${c.isRezzed ? '*' : ''}`), rig: s.runner.rig.programs.map(c => getCardDefinition(c.cardCode).title), runner: s.runner.credits, clicks: s.runner.maxClicks, tags: s.runner.tags, corp: s.corp.credits, bp: s.corp.badPublicity } } : {}),
          });
        }
      }
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
