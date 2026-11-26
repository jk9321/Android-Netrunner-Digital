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
  // Ruling 6, corpSeenGrip: the grip cards chosen by code and count against today's list by id
  g1: [
    [
      'ai/oracle.ts',
      `  return new Set(certainHandCards(state, 'runner').map(c => c.instanceId));\n`,
      `  const __new = new Set(certainHandCards(state, 'runner').map(c => c.instanceId));\n  const __old = new Set((state.runner.knownToCorp ?? []).map(k => k.id).filter(id => state.runner.grip.some(c => c.instanceId === id)));\n${L}  if (__new.size !== __old.size || [...__new].some(id => !__old.has(id))) ${fire('g1')};\n  return __new;\n`,
    ],
  ],
  // Ruling 6, muWorth: the grip programs counted by code and count against today's list by id
  g2: [
    [
      'ai/effectValues.ts',
      `  return state.runner.memoryUnitsUsed + grip > BASE_MU ? 2 * MU : MU;\n`,
      `  const __ids = actingSide() === 'corp' ? new Set((state.runner.knownToCorp ?? []).map(k => k.id)) : undefined;\n  const __old = state.runner.grip.filter(c => cardDef(c).type_code === 'program' && (!__ids || __ids.has(c.instanceId))).reduce((n, c) => n + (cardDef(c).memory_cost ?? 0), 0);\n${L}  if ((state.runner.memoryUnitsUsed + grip > BASE_MU) !== (state.runner.memoryUnitsUsed + __old > BASE_MU)) ${fire('g2')};\n  return state.runner.memoryUnitsUsed + grip > BASE_MU ? 2 * MU : MU;\n`,
    ],
  ],
  // Ruling 6, winNow's blind grip: the cards the Corp counts as seen by code and count against today's list by id
  g3: [
    [
      'ai/winNow.ts',
      `  const known = new Set(certainHandCards(state, 'runner').map(c => c.instanceId));\n`,
      `  const known = new Set(certainHandCards(state, 'runner').map(c => c.instanceId));\n  const __old = new Set((state.runner.knownToCorp ?? []).map(k => k.id));\n${L}  if (state.runner.grip.some(c => known.has(c.instanceId) !== __old.has(c.instanceId))) ${fire('g3')};\n`,
    ],
  ],
  // B4b (a) the deal by kind: an upgrade-only slot, or a remote root that already holds its one agenda or asset
  Ba: [
    ['ai/runnerReply.ts', `  for (const card of upgradeOnly) card.cardCode =`, `${L}  if (upgradeOnly.size) ${fire('Ba')};\n  for (const card of upgradeOnly) card.cardCode =`],
    ['ai/runnerReply.ts', `    const server = serverOf.get(card);\n`, `    const server = serverOf.get(card);\n${L}    if (holdsOne.has(server)) ${fire('Ba')};\n`],
  ],
  // Bar 3's part (trace only): the Hard determinize ran (SearchAI, Hard only; Hard is off in the batch pools)
  H: [['ai/search.ts', `        const world = determinize(state, this.side, mulberry(seed), this.memory);\n`, `${L}        ${fire('H')};\n        const world = determinize(state, this.side, mulberry(seed), this.memory);\n`]],
  // Gap 1 (trace only; the engine at e31c807): the HQ list drops, or keeps uncounted, a card the Runner followed into R&D
  G1: [
    [
      'core/engine/helpers.ts',
      `    if (followed?.size) known = known.filter(e => inHand.has(e.id) || !followed.has(e.id));\n`,
      `    if (followed?.size) {\n      const __n = known.length;\n      known = known.filter(e => inHand.has(e.id) || !followed.has(e.id));\n${L}      if (known.length !== __n || (owner === 'corp' ? prev.corp.hq : prev.runner.grip).some(c => !inHand.has(c.instanceId) && !after.has(c.instanceId) && followed.has(c.instanceId))) ${fire('G1')};\n    }\n`,
    ],
  ],
  // Gap 3 (trace only; the engine at 9f9d039): a card from the open joins the other side's list as it goes back to a hand
  G3: [['core/engine/helpers.ts', `    if (seen.length > 0) revealInHand(state, owner, seen);\n`, `${L}    if (seen.length > 0) ${fire('G3')};\n    if (seen.length > 0) revealInHand(state, owner, seen);\n`]],
  // Gap 4 (trace only; the engine at 1889861): a shuffle's action applies its other moves to the shares, a card seen in
  // the action before the shuffle gets a share, a drawn share joins HQ
  G4: [
    ['core/engine/rdKnowledge.ts', `    if (card && !marks.some(e => e.id === id)) marks.push(share(id, card.cardCode));\n`, `${L}    if (card && !marks.some(e => e.id === id)) ${fire('G4')};\n    if (card && !marks.some(e => e.id === id)) marks.push(share(id, card.cardCode));\n`],
    [
      'core/engine/rdKnowledge.ts',
      `  if (note?.shuffled) known = afterShuffle(prev, state, known);\n`,
      `  if (note?.shuffled) {\n    const __k = JSON.stringify(known);\n    known = afterShuffle(prev, state, known);\n${L}    if (JSON.stringify(known) !== __k) ${fire('G4')};\n  }\n`,
    ],
    ['core/engine/rdKnowledge.ts', `  const drawn = gone.filter(e => e.left === 'hq')`, `${L}  if (gone.some(e => e.left === 'hq' && e.n0)) ${fire('G4')};\n  const drawn = gone.filter(e => e.left === 'hq')`],
  ],
  // Gap 2 (trace only; the engine at c7bc53a): a card from the open shuffled into R&D gets a share
  G2: [
    [
      'core/engine/rdKnowledge.ts',
      `  for (const c of state.corp.rd)\n    if (!wasInRd.has(c.instanceId) && openBefore.has(c.instanceId) && !out.some(e => e.id === c.instanceId)) out =`,
      `  for (const c of state.corp.rd) {\n${L}    if (!wasInRd.has(c.instanceId) && openBefore.has(c.instanceId) && !out.some(e => e.id === c.instanceId)) ${fire('G2')};\n    if (!wasInRd.has(c.instanceId) && openBefore.has(c.instanceId) && !out.some(e => e.id === c.instanceId)) out =`,
    ],
    ['core/engine/rdKnowledge.ts', `{ id: c.instanceId, code: c.cardCode, lo: 0, hi: Math.max(0, n0 - 1), n0 }];\n  return out;\n`, `{ id: c.instanceId, code: c.cardCode, lo: 0, hi: Math.max(0, n0 - 1), n0 }];\n  }\n  return out;\n`],
  ],
};
