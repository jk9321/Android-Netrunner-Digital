/**
 * Stage D item 4 step 1 (brief stage-d/item4-game-end/brief.md section 2): the arms, as text patches of a copy of src/
 * (no source change). Each entry is [file under src/, text that must occur once, replacement]. `probe` is applied to
 * every tree, base included: it only records which layer made the deciding Corp's pick (globalThis.__geLayer).
 *
 *  - a1  order outright: every place that compares servers by stake(...).loss or centralStake puts a server whose one
 *        access can take the Runner to 7 (canEnd, rule 1.7.2a) first, whatever the odds; ties and the rest as today.
 *        The places (the reader list of brief 3.2): candidates.ts iceMove line 2 (`-fall`) and line 6 (`-loss`) keys;
 *        placement.ts iceFallback's `thinnest` (lethal before thinness, then the stake as today); placement.ts
 *        centralIce's bare-central sort. iceRedirect's plan.lethalHq clause is already the order and stays.
 *  - a2  by the odds: stake's loss and centralStake price a steal that takes the Runner to 7 at the game-end owner's
 *        price on the points clock (spec 1.7: pointsTerm + pointValue(7), the sampledEndWorth difference), times the
 *        access odds (HQ: each agenda over the hand by accesses, as today; R&D: each agenda the list still has there over
 *        R&D's cards, per agenda when one of them ends the game). No order.
 *  - a2e as a2 with variant E's price (the loser also forfeits what it could still score: + pointValue(7) - its points).
 *  - b1  variant E's price in the look-ahead (sampledEndWorth, from ai-terminal-e bdf30b8, KNOBS.corpPoints kept).
 *  - b2  the old fixed terminal in the look-ahead (a sampled game end read at the leaf's ±1000): the upper bound.
 */
type Patch = [string, string, string];

const L = '(globalThis as unknown as { __geLayer?: string }).__geLayer';

export const probe: Patch[] = [
  ['ai/corp/core.ts', 'if (win) return { action: win, note: true };', `if (win) { ${L} = 'Q1 winNow'; return { action: win, note: true }; }`],
  ['ai/corp/core.ts', 'if (score && activePrompt(view)) return { action: score.first, note: true };', `if (score && activePrompt(view)) { ${L} = 'Q3 scoreNow'; return { action: score.first, note: true }; }`],
  ['ai/corp/core.ts', "if (activePrompt(view)) return { action: answerPrompt(view, 'corp', undefined, ctx.synergy), note: false };", `if (activePrompt(view)) { ${L} = 'Q0 prompt'; return { action: answerPrompt(view, 'corp', undefined, ctx.synergy), note: false }; }`],
  [
    'ai/corp/core.ts',
    '    return chosen;\n  };',
    `    ${L} = lineFirst ? 'Q5 line step' : money ? 'Q6 money' : planned ? (ranked[0] && JSON.stringify(planned) === JSON.stringify(ranked[0].action) ? 'list first (planner agrees)' : 'planner') : 'list first';\n    return chosen;\n  };`,
  ],
  ['ai/corp/core.ts', '    if (!keepsScore(view, picked, score)) picked = score.first;', `    if (!keepsScore(view, picked, score)) { picked = score.first; ${L} = 'Q3 scoreNow'; }`],
  ['ai/corp/core.ts', '  return { action: two.action!, note: true, held: two.held };', `  if (two.action !== two.chosen) ${L} = 'Q4/5 line'; return { action: two.action!, note: true, held: two.held };`],
  ['ai/corp/rez.ts', "      if (call === 'rez') return { type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId };", `      if (call === 'rez') { ${L} = 'countedRez'; return { type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId }; }`],
  ['ai/corp/rez.ts', "  if (best) return { type: 'REZ_CARD', player: 'corp', cardInstanceId: best.card.instanceId };", `  if (best) { ${L} = 'pricedRez'; return { type: 'REZ_CARD', player: 'corp', cardInstanceId: best.card.instanceId }; }`],
];

/** canEnd: the one test the A arms read (pools.ts, beside stake). Applied to every A arm. */
const canEnd: Patch = [
  'ai/corp/pools.ts',
  'export function agendasUnseen(state: GameState): number {\n  return rdAgendas(state).length;\n}',
  'export function agendasUnseen(state: GameState): number {\n  return rdAgendas(state).length;\n}\n\n/** One access to `server` can take the Runner to 7 agenda points (rule 1.7.2a), by the stake owner\'s points. */\nexport function canEnd(state: GameState, server: string, opts: StakeOptions = {}): boolean {\n  return state.runner.score + stake(state, server, opts).points >= 7;\n}',
];

const a1: Patch[] = [
  canEnd,
  ['ai/corp/placement.ts', "import { centralStake, stake } from './pools';", "import { canEnd, centralStake, stake } from './pools';"],
  [
    'ai/corp/placement.ts',
    '  return { server, loss, scoring, was, now, improves, staked: improves && (loss > 0 || scoring) };',
    '  return { server, loss, scoring, was, now, improves, staked: improves && (loss > 0 || scoring), ends: canEnd(state, server, { leaving: card.instanceId }) };',
  ],
  ['ai/corp/candidates.ts', 'keys: root ? [-margin, cost, id] : [0, -margin, cost, id]', 'keys: root ? [-margin, cost, id] : [0, 0, -margin, cost, id]'],
  ['ai/corp/candidates.ts', 'keys: [-fall, cost, -now.margin, id]', 'keys: [count.ends ? -1 : 0, -fall, cost, -now.margin, id]'],
  ['ai/corp/candidates.ts', 'keys: [-loss, -(now.margin - was.margin), cost, id]', 'keys: [count.ends ? -1 : 0, -loss, -(now.margin - was.margin), cost, id]'],
  [
    'ai/corp/placement.ts',
    '    [...ids].sort((x, y) => state.corp.servers[x].ice.length - state.corp.servers[y].ice.length || centralStakes[y] - centralStakes[x])[0];',
    '    [...ids].sort((x, y) => +canEnd(state, y, { leaving: card.instanceId }) - +canEnd(state, x, { leaving: card.instanceId }) || state.corp.servers[x].ice.length - state.corp.servers[y].ice.length || centralStakes[y] - centralStakes[x])[0];',
  ],
  [
    'ai/corp/placement.ts',
    '  const to = bare.sort((x, y) => stake[y] - stake[x])[0];',
    '  const to = bare.sort((x, y) => +canEnd(state, y, { leaving: card.instanceId }) - +canEnd(state, x, { leaving: card.instanceId }) || stake[y] - stake[x])[0];',
  ],
];

/** A2: the game-ending steal at the owner's price by the odds. `extra` is added to the owner's points-clock loss (E). */
const a2 = (extra: string): Patch[] => [
  canEnd,
  ['ai/corp/pools.ts', "import { pointGain, sideCards } from '../valueModel';", `import { pointGain, pointValue, pointsTerm, sideCards } from '../valueModel';\n\n/** The game end on the points clock (spec 1.7 endLoss: sampledEndWorth('runner') less the root board) and an ordinary steal otherwise. */\nconst stealPrice = (state: GameState, points: number): number => (state.runner.score + points >= 7 ? pointsTerm(state) + pointValue(7)${extra} : pointGain(state.runner.score, points));`],
  ['ai/corp/pools.ts', '  const steal = (c: CardInstance) => pointGain(state.runner.score, cardDef(c).agenda_points ?? 0);', '  const steal = (c: CardInstance) => stealPrice(state, cardDef(c).agenda_points ?? 0);'],
  [
    'ai/corp/pools.ts',
    '    loss += Math.min(accesses, state.corp.rd.length) * odds * pointGain(state.runner.score, points);',
    '    const left = rdAgendas(state);\n    loss += left.some(c => state.runner.score + pts(c) >= 7) ? Math.min(accesses, state.corp.rd.length) * (odds / left.length) * left.reduce((n, c) => n + steal(c), 0) : Math.min(accesses, state.corp.rd.length) * odds * pointGain(state.runner.score, points);',
  ],
  ['ai/corp/pools.ts', '    hq: hand.length ? hand.filter(isAgenda).reduce((n, c) => n + pointGain(score, cardDef(c).agenda_points ?? 0), 0) / hand.length : 0,', '    hq: hand.length ? hand.filter(isAgenda).reduce((n, c) => n + stealPrice(state, cardDef(c).agenda_points ?? 0), 0) / hand.length : 0,'],
  [
    'ai/corp/pools.ts',
    '    rd: rd.odds * pointGain(score, rd.points),',
    '    rd: rdAgendas(state).some(c => score + pts(c) >= 7) ? (rd.odds / rdAgendas(state).length) * rdAgendas(state).reduce((n, c) => n + stealPrice(state, pts(c)), 0) : rd.odds * pointGain(score, rd.points),',
  ],
];

const sampled = "  return logValue('gameEnd', 'sampledEndWorth', undefined, (winner === 'corp' ? pointValue(7, KNOBS.corpPoints) : -pointValue(7)) + rootBoard, winner, rootBoard);";

export const PATCHES: Record<string, Patch[]> = {
  a1,
  a2: a2(''),
  a2e: a2(' + pointValue(7) - pointValue(state.corp.score)'),
  b1: [
    ['ai/valueModel.ts', 'export function sampledEndWorth(winner: SideCode, rootBoard: number): number {', 'export function sampledEndWorth(winner: SideCode, rootBoard: number, root?: GameState): number {'],
    [
      'ai/valueModel.ts',
      sampled,
      "  const forfeit = root ? (winner === 'corp' ? pointValue(7) - pointValue(root.runner.score) : pointValue(7, KNOBS.corpPoints) - pointValue(root.corp.score, KNOBS.corpPoints)) : 0;\n  return logValue('gameEnd', 'sampledEndWorth', undefined, (winner === 'corp' ? pointValue(7, KNOBS.corpPoints) + forfeit : -pointValue(7) - forfeit) + rootBoard, winner, rootBoard);",
    ],
    ['ai/runnerReply.ts', '? sampledEndWorth(last.winner!, rootBoard!)', '? sampledEndWorth(last.winner!, rootBoard!, end)'],
  ],
  b2: [['ai/runnerReply.ts', '? sampledEndWorth(last.winner!, rootBoard!)', '? leaf(last)']],
};
