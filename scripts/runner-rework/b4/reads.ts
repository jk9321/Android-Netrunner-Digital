/**
 * B4 reader hooks for lockstep.ts READS=<name>: patches on the branch tree only (core-hooks.ts Patch: each must match
 * once). Each reports through `globalThis.__b4Fire(name)` the calls where the reader's new reading differs from today's,
 * so a reader commit's first difference can be traced to its own reader. Filled in with each reader commit.
 */
import type { Patch } from '../core-hooks';

const L = '  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n';
const fire = (name: string) => `(globalThis as any).__b4Fire?.('${name}')`;

export const READ_HOOKS: Record<string, Patch[]> = {
  // 7(a) hqAgendaOdds: the count against today's list (`slice(-size)`, every entry taken as there)
  a: [
    [
      'ai/runs.ts',
      `  known = Math.min(known, size);\n  return (Math.min(agendas, known) + (size - known) * odds) / size;\n}`,
      `  known = Math.min(known, size);\n  const __new = (Math.min(agendas, known) + (size - known) * odds) / size;\n  const __k = (state.corp.knownToRunner ?? []).slice(-size);\n  const __old = (__k.filter(k => getCardDefinition(k.code).type_code === 'agenda').length + (size - __k.length) * odds) / size;\n${L}  if (__new !== __old) ${fire('a')};\n  return __new;\n}`,
    ],
  ],
  // 7(b) rdWorth: a shuffle's share counted at a place (today's reader read no share)
  b: [
    [
      'ai/runs.ts',
      `      if (i < e.lo || i > e.hi || (e.n0 && exact.has(i))) continue;\n`,
      `      if (i < e.lo || i > e.hi || (e.n0 && exact.has(i))) continue;\n${L}      if (e.n0) ${fire('b')};\n`,
    ],
  ],
  // 7(c) the Archives price: a facedown card the Runner surely knows (today's reader priced every one unseen)
  c: [
    [
      'ai/runs.ts',
      `    const unseen = state.corp.archives.faceDown.length - known.reduce((n, k) => n + k.n, 0);\n`,
      `    const unseen = state.corp.archives.faceDown.length - known.reduce((n, k) => n + k.n, 0);\n${L}    if (known.length) ${fire('c')};\n`,
    ],
  ],
};
