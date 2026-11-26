/**
 * B3 commit 2, bar 3 (brief runner-rework/briefs/b3-prompt-view.md rev 2): one board per Runner prompt kind that step 0.2
 * found answered on the real state (runner-rework/b3/step0.md, 0.2), saved as a fixture for tests/runnerPromptView.test.ts.
 * Plays the base pools' deals (g1 45716865309, NRDB g1 45721175528) Normal against Normal by GameRunner on this checkout's
 * src, and keeps the first board of each kind where the deciding Runner is asked: the state, the Runner's memory, the
 * answer played. A kind is the prompt's source card and step, and whether a run is on. Only deals whose decks hold a
 * wanted kind's card are played.
 *
 *   ONLY=<keys> npx vite-node scripts/runner-rework/b3/prompt-fixtures.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { GameState, activePrompt, actingSide, createInitialGameState, getCardDefinition } from '../../../src/core';
import { createAgent } from '../../../src/ai';
import { GameRunner } from '../../../src/ai/playout';
import { deckGameSetup } from '../../../src/data/decks';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';

type Deal = { seed: number; corpDeck: string; runnerDeck: string };
/** The kinds, by source title and step, with the run flag and the pool and deals step 0.2 lists them in first. */
const KINDS: { key: string; title: string; step: string; inRun: boolean; pool: 'batch' | 'nrdb'; deals?: number[] }[] = [
  { key: 'muslihat-top', title: 'MuslihaT: Multifarious Marketeer', step: 'top', inRun: false, pool: 'batch' },
  { key: 'tao-swap', title: 'Tāo Salonga: Telepresence Magician', step: 'swap', inRun: false, pool: 'batch' },
  { key: 'tao-swap-access', title: 'Tāo Salonga: Telepresence Magician', step: 'swap', inRun: true, pool: 'batch' },
  { key: 'topan-host', title: 'Topan: Ormas Leader', step: 'host', inRun: false, pool: 'batch' },
  { key: 'scrounge-host', title: 'Scrounge', step: 'host', inRun: false, pool: 'batch', deals: [3071, 3001, 3011] },
  { key: 'magdalene-host', title: 'Magdalene Keino-Chemutai: Cryptarchitect', step: 'host', inRun: false, pool: 'batch', deals: [3071, 1381] },
  { key: 'hermes-bounce', title: 'Hermes', step: 'bounce', inRun: false, pool: 'nrdb' },
  { key: 'hermes-bounce-access', title: 'Hermes', step: 'bounce', inRun: true, pool: 'nrdb' },
  { key: 'cataloguer-arrange', title: 'Cataloguer', step: 'arrange', inRun: true, pool: 'nrdb', deals: [1471, 1971] },
  { key: 'burner-where', title: 'Burner', step: 'where', inRun: true, pool: 'nrdb', deals: [1871, 1671] },
  // today's path (runner/prompt.ts todayPathKind): a host step in a run, and R-93's class (a stack card shown by face)
  { key: 'bahia-host-run', title: 'Bahia Bands', step: 'host', inRun: true, pool: 'nrdb', deals: [2051] },
  { key: 'muse-install', title: 'Muse', step: 'install', inRun: false, pool: 'nrdb', deals: [1371, 1691] },
];
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const RECORDS = { batch: '45716865309', nrdb: '45721175528' };
const DECKS = [...ALL_DECKS, ...NRDB_TEST_DECKS];
const MAX_STEPS = 6000;
const LIMIT = Number(process.env.LIMIT ?? 400);
const out = 'tests/fixtures/runner-prompt-view';
mkdirSync(out, { recursive: true });

const kindOf = (s: GameState): string | null => {
  const p = activePrompt(s);
  if (!p || p.side !== 'runner' || actingSide(s) !== 'runner' || !('source' in p)) return null;
  const title = getCardDefinition(p.source.cardCode)?.title;
  const k = KINDS.find(x => x.title === title && x.step === p.source.step && x.inRun === !!s.activeRun);
  return k?.key ?? null;
};

const left = new Set(KINDS.map(k => k.key).filter(k => !ONLY.length || ONLY.includes(k)));
const wanted = (pool: string) => KINDS.filter(k => left.has(k.key) && k.pool === pool);
for (const pool of ['batch', 'nrdb'] as const) {
  const deals: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/b3/deals-${RECORDS[pool]}.json`, 'utf8'));
  const listed = KINDS.filter(k => k.pool === pool).flatMap(k => k.deals ?? []);
  const order = [...deals.filter(d => listed.includes(d.seed)), ...deals.filter(d => !listed.includes(d.seed))].slice(0, LIMIT);
  for (const d of order) {
    if (!wanted(pool).length) break;
    const corp = DECKS.find(x => x.side === 'corp' && x.name === d.corpDeck);
    const runner = DECKS.find(x => x.side === 'runner' && x.name === d.runnerDeck);
    if (!corp || !runner) continue;
    const holds = (t: string) => [corp, runner].some(x => x.identity === t || t in x.cards);
    if (!wanted(pool).some(k => holds(k.title))) continue;
    const agents = { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') };
    const g = new GameRunner(createInitialGameState(deckGameSetup(d.seed, corp, runner)), agents);
    for (let i = 0; i < MAX_STEPS && !g.state.winner; i++) {
      const s = g.state;
      const key = kindOf(s);
      const memory = [...((agents.runner as unknown as { memory: Map<string, string> }).memory ?? new Map())];
      if (!g.step()) break;
      if (!key || !left.has(key)) continue;
      left.delete(key);
      const source = `${pool} base ${RECORDS[pool]} deal ${d.seed} T${s.turnNumber}, ${key}, Normal v Normal by GameRunner (ai-runner-prompt-view, B3 commit 2's tree)`;
      writeFileSync(`${out}/${key}.json`, JSON.stringify({ source, played: g.last, memory, state: s }));
      console.log(`${key}: ${source}`);
    }
  }
}
console.log(`not found: ${[...left].join(', ') || 'none'}`);
