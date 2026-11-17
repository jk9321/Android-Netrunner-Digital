// Labels the changed decisions of runner-runs-truth.ts output with card titles: npx vite-node scripts/stage-d/runner-runs-label.ts truth.jsonl T2
import { readFileSync } from 'node:fs';
import { createInitialGameState, cardDef } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
const names: Record<string, Record<string, string>> = {};
function title(src: string, id: string) {
  if (!names[src]) {
    const r = JSON.parse(readFileSync(`/home/user/Android-Netrunner-Digital/tests/fixtures/human-games/${src}`, 'utf8'));
    const s = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    const all = [...s.corp.hq, ...s.corp.rd, ...s.runner.grip, ...s.runner.stack, s.corp.identity, s.runner.identity].filter(Boolean);
    names[src] = Object.fromEntries(all.map(c => [c!.instanceId, cardDef(c!).title]));
  }
  return names[src][id] ?? id;
}
const f = (src: string, x: string) => {
  if (x === '=') return '=';
  const a = JSON.parse(x);
  return [a.type.replace('_CARD', ''), a.cardInstanceId ? title(src, a.cardInstanceId) : '', a.targetServerId ?? (a.asNewRemote ? '→new' : ''), a.abilityIndex !== undefined ? `ab${a.abilityIndex}` : '', a.choice ?? ''].filter(v => v !== '').join(' ');
};
for (const l of readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (!l.startsWith('{')) continue;
  const d = JSON.parse(l);
  if (d.summary) continue;
  const want = process.argv[3] ?? 'T2';
  if (d[want] === '=') continue;
  const af = d.after ? `after hq ${d.after.hq.toFixed(2)} rd ${d.after.rd.toFixed(2)} rem ${d.after.remote.toFixed(2)} steal ${d.after.steal.toFixed(2)}` : '';
  console.log(`${d.src} #${d.i} T${d.turn} next[${d.next}] ${af} | base: ${f(d.src, d.base)} | T1: ${f(d.src, d.T1)} | T2: ${f(d.src, d.T2)} | T3: ${f(d.src, d.T3)}`);
}
