/**
 * Speed pass L-42 count (netrunner-ai/speed-pass/l42-bar.md; scripts only): updateRootKinds (core/engine/helpers.ts),
 * which updateHandKnowledge runs after every action. Three arms are patched into the lockstep's BRANCH tree copy (the
 * core-faults mechanism), never into src; FAULT=l42noop,l42skip,l42audit gives each arm every third shard. Base and
 * control are BASE unpatched.
 *   l42noop   the call removed (the most any L-42 lever can save; not exact)
 *   l42skip   return at once when the two boards' roots match (servers in order, isRemote, root cards in order by
 *             instanceId, cardCode and hidden flag: everything the function reads)
 *   l42audit  the skip test, then the whole function: counts calls, identity-equal servers, matching roots (the skip
 *             rate) and the matching-roots calls where the marks changed anyway (a wrong skip)
 * The skip and audit arms print an `l42` line at the end of each shard. Time per arm:
 *   FAULT=<arm> node scripts/speed-pass/time-sum.mjs <dir>
 *
 *   SHARD=0/64 npx vite-node scripts/speed-pass/l42.ts -- POOL=batch,nrdb,human CORP=1 VALUES=0 TIMES=1 BASE=<full sha> FAULT=l42noop,l42skip,l42audit
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FAULTS } from '../runner-rework/core-faults';

const F = 'core/engine/helpers.ts';
const HEAD = `function updateRootKinds(prev: GameState, state: GameState): void {\n`;
const SAME = `  const __same = (a: GameState, b: GameState): boolean => {
    const x = a.corp.servers;
    const y = b.corp.servers;
    const kx = Object.keys(x);
    const ky = Object.keys(y);
    if (kx.length !== ky.length) return false;
    for (let i = 0; i < kx.length; i++) {
      if (kx[i] !== ky[i]) return false;
      const p = x[kx[i]];
      const q = y[kx[i]];
      if (p.isRemote !== q.isRemote || p.root.length !== q.root.length) return false;
      for (let j = 0; j < p.root.length; j++) {
        const c = p.root[j];
        const d = q.root[j];
        if (c.instanceId !== d.instanceId || c.cardCode !== d.cardCode || hiddenRoot(c) !== hiddenRoot(d)) return false;
      }
    }
    return true;
  };
  const __c = ((globalThis as any).__l42 ??= { calls: 0, sameServers: 0, sameRoots: 0, wrongSkips: 0 });
  __c.calls++;
  if (prev.corp.servers === state.corp.servers) __c.sameServers++;
  const __match = __same(prev, state);
  if (__match) __c.sameRoots++;
`;
const END = `  else delete state.corp.rootUpgradesKnownToRunner;\n`;

FAULTS.l42noop = [[F, `  updateRootKinds(prev, state);\n`, '']];
FAULTS.l42skip = [[F, HEAD, `${HEAD}${SAME}  if (__match) return;\n`]];
FAULTS.l42audit = [
  [F, HEAD, `${HEAD}${SAME}  const __in = JSON.stringify(state.corp.rootUpgradesKnownToRunner ?? []);\n`],
  [F, END, `${END}  if (__match && JSON.stringify(state.corp.rootUpgradesKnownToRunner ?? []) !== __in) __c.wrongSkips++;\n`],
];

process.on('exit', () => {
  const c = (globalThis as any).__l42;
  if (c) console.log(JSON.stringify({ kind: 'l42', fault: process.env.__L42_FAULT ?? null, ...c }));
});
// The arm this shard runs (core-lockstep's FAULT rule: shard % arms), for the l42 line
{
  const args = Object.fromEntries(
    `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`
      .split(/\s+/)
      .filter(x => x.includes('='))
      .map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]),
  );
  const list = (args.FAULT ?? process.env.FAULT ?? '').split(',').filter(Boolean);
  const [shard] = (args.SHARD ?? process.env.SHARD ?? '0/1').split('/').map(Number);
  if (list.length) process.env.__L42_FAULT = list[shard % list.length];
}
await import('../runner-rework/core-lockstep');
