import type { Patch } from '../corp-owed/trees';

/** Scratch-only counters (MODE=time, step 9): the use part's work-outs by n, damageWorth / agendaWorth in the use part, the hand plan's time. */
export const COUNT: Patch[] = [
  [
    'ai/evaluate.ts',
    `export function tagUsePerTurn(state: GameState, viewer: SideCode, n: number): number {\n  return withPricing(`,
    `export function tagUsePerTurn(state: GameState, viewer: SideCode, n: number): number {\n  if ((globalThis as any).__f119Count) ((c: any) => void (c[\`miss \${viewer} n\${Number.isFinite(n) ? Math.min(n, 4) : 'Inf'}\`] = (c[\`miss \${viewer} n\${Number.isFinite(n) ? Math.min(n, 4) : 'Inf'}\`] ?? 0) + 1))((globalThis as any).__f119Count);\n  return withPricing(`,
  ],
  [
    'ai/evaluate.ts',
    `  if (e.damage) w += damageWorth(state, e.damage);`,
    `  if (e.damage) w += ((globalThis as any).__f119Count && ((globalThis as any).__f119Count.damageWorth = ((globalThis as any).__f119Count.damageWorth ?? 0) + 1), damageWorth(state, e.damage));`,
  ],
  [
    'ai/evaluate.ts',
    `  if (e.corpAgenda) w += agendaWorth(`,
    `  if (e.corpAgenda && (globalThis as any).__f119Count) (globalThis as any).__f119Count.agendaWorth = ((globalThis as any).__f119Count.agendaWorth ?? 0) + 1;\n  if (e.corpAgenda) w += agendaWorth(`,
  ],
  [
    'ai/evaluate.ts',
    `export function tagUseHandWorth(state: GameState, code: string): number {\n  const use = tagUseOf(code);`,
    `export function tagUseHandWorth(state: GameState, code: string): number {\n  const t0 = performance.now();\n  try { return tagUseHandWorthIn(state, code); } finally { const c = (globalThis as any).__f119Count; if (c) { c.handMs = (c.handMs ?? 0) + performance.now() - t0; c.hand = (c.hand ?? 0) + 1; } }\n}\nfunction tagUseHandWorthIn(state: GameState, code: string): number {\n  const use = tagUseOf(code);`,
  ],
  [
    'ai/evaluate.ts',
    `  if (A.dbg) A.dbg({ part: 'clock', trashPart, usePart, viewer, tags });`,
    `  if (A.dbg) A.dbg({ part: 'clock', trashPart, usePart, viewer, tags });\n  if ((globalThis as any).__f119Count) (globalThis as any).__f119Count.clock = ((globalThis as any).__f119Count.clock ?? 0) + 1;`,
  ],
  // step 4: V18 without the two cards' tag-gated damage (Mindscaping, Orbital Superiority), both modes
  [
    'ai/effectValues.ts',
    `export function ownTurnDamage(state: GameState, code: string): number {`,
    `export function ownTurnDamage(state: GameState, code: string): number {\n  if ((globalThis as any).__f119NoTagDamage && (code === '34045' || code === '30068')) return 0;`,
  ],
  ['ai/effectValues.ts', `function cardDamage(code: string): number {`, `function cardDamage(code: string): number {\n  if ((globalThis as any).__f119NoTagDamage && (code === '34045' || code === '30068')) return 0;`],
];

