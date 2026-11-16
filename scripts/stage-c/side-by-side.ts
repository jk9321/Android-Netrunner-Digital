/**
 * Step 4 Stage C3: recorded decisions side by side. At each recorded Corp main-phase decision (local deals and human
 * games, split by SHARD), a fresh Normal Corp of each core decides on a copy of the state: old = the ranking
 * (corpCore off), new = the order (corpCore and rolloutLines on). Caches are cleared before each, the order of the two
 * alternates. One JSON line per decision: where, the two moves, the two times. Sum with side-by-side-sum.mjs.
 *   SHARD=0/64 npx vite-node scripts/stage-c/side-by-side.ts > sbs-0.txt
 */
import { GameAction, GameState, cardDef, findCardAnywhere } from '../../src/core';
import { createAgent } from '../../src/ai';
import { plan, withPricing } from '../../src/ai/pricing';
import { isCorpMain } from '../../src/ai/corp/lines';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

const name = (s: GameState, a: GameAction) => {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  const to = 'targetServerId' in a && a.targetServerId ? '@' + a.targetServerId : a.type === 'INSTALL_CARD' ? '@new' : '';
  return { move: `${a.type}${c ? ' ' + cardDef(c).title : ''}${to}`, card: `${a.type}${c ? ' ' + cardDef(c).title : ''}` };
};
const decide = (core: 'old' | 'new', s: GameState) => {
  const p = { ...plan(), corpCore: core === 'new', rolloutLines: core === 'new' };
  return withPricing({ plan: p }, () => {
    const agent = createAgent('corp', 'normal');
    clearCaches();
    const copy = structuredClone(s);
    const t = performance.now();
    const a = agent.chooseAction(copy);
    return { ...name(s, a), ms: Math.round(performance.now() - t) };
  });
};
let k = 0;
forEachRecorded({
  decision: d => {
    if (d.kind !== 'action' || !isCorpMain(d.state)) return;
    let o, n;
    if (k++ % 2) {
      o = decide('old', d.state);
      n = decide('new', d.state);
    } else {
      n = decide('new', d.state);
      o = decide('old', d.state);
    }
    const s = d.state;
    // Anoetic Void (30050) where a reply can meet it: installed, or in HQ to be installed in a playout (AI Coordinator
    // 17:18Z: its fixed-count HQ-trash prompt; the prompt itself is not counted, prompts.ts is outside Stage C)
    const av = [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => v.root)].some(c => c.cardCode === '30050');
    console.log(JSON.stringify({ src: d.src, i: d.i, T: s.turnNumber, av, clicks: s.corp.clicks, credits: s.corp.credits, old: o.move, new: n.move, sameCard: o.card === n.card, msOld: o.ms, msNew: n.ms }));
  },
});
