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
  // 7(d) unseenTraps: the marks for HQ, R&D and facedown Archives against today's map by id over every hidden card
  d: [
    [
      'ai/runs.ts',
      `  const traps = codes.filter(isTrap);\n  const agendas = codes.filter(c => getCardDefinition(c).type_code === 'agenda').length;\n  return { traps, agendas };\n`,
      `  const traps = codes.filter(isTrap);\n  const agendas = codes.filter(c => getCardDefinition(c).type_code === 'agenda').length;\n` +
        `  const __hidden = [...corp.hq, ...corp.rd, ...corp.archives.faceDown, ...installed];\n  const __codes = __hidden.map(c => c.cardCode);\n` +
        `  for (const card of __hidden) {\n    const seen = memory?.get(card.instanceId);\n    if (seen === undefined) continue;\n    const at = __codes.indexOf(seen);\n    if (at >= 0) __codes.splice(at, 1);\n  }\n` +
        `  const __traps = __codes.filter(isTrap);\n  const __agendas = __codes.filter(c => getCardDefinition(c).type_code === 'agenda').length;\n` +
        `${L}  if (__traps.length !== traps.length || __agendas !== agendas || __traps.join() !== traps.join()) ${fire('d')};\n  return { traps, agendas };\n`,
    ],
  ],
  // 7(e) the deal by code and count: a deal where today's kept an HQ card by instance or an exact mark open to doubt, or
  // where a known code is dealt back to its zone; the Corp's guess of a shuffle's share
  e: [
    [
      'ai/runnerReply.ts',
      `  for (const card of ice) card.cardCode = dealt(take(code => typeOf(code) === 'ice'));\n`,
      `${L}  if (kept.size || (s.corp.knownToRunner ?? []).length || knownInRd(s).some(e => e.lo === e.hi && e.left)) ${fire('e')};\n  for (const card of ice) card.cardCode = dealt(take(code => typeOf(code) === 'ice'));\n`,
    ],
    ['ai/runnerReply.ts', `  if (!marks.length) return [];\n`, `  if (!marks.length) return [];\n${L}  if (marks.some(m => m.mark.n0)) ${fire('e')};\n`],
  ],
  // 7(h) runnerDecisionView's key: a view kept where today's key, with the whole map and no marks, would not have kept it
  h: [
    [
      'ai/turnPlanner.ts',
      `  const kept = runnerViews.get(state);\n  if (kept?.sig === sig) return kept.view;\n`,
      `  const kept = runnerViews.get(state);\n  const __old = memory ? [...memory].map(([id, code]) => \`\${id}:\${code}\`).join(',') : '';\n${L}  if (kept?.sig === sig && (kept as any).__old !== __old) ${fire('h')};\n  if (kept?.sig === sig) return kept.view;\n`,
    ],
    ['ai/turnPlanner.ts', `  runnerViews.set(state, { sig, view });\n`, `  runnerViews.set(state, { sig, view, __old } as never);\n`],
  ],
};
