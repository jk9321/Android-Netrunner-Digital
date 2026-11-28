/**
 * Speed pass G0, a difference's reader: one tree (this checkout's src with lever G patched in, g-patches.ts) plays one
 * deal; from step FROM on, memoAudit (valueModel.ts) re-works every memo hit, and the hits whose value differs are
 * listed by name with whether they were served from another frame or from a frame that knew other hands. G shares one
 * board object between callers that today get two equal objects, so a memo key that leaves part of the context out can
 * now be hit across that part: this names the memo.
 *   npx vite-node scripts/speed-pass/g-audit.ts -- POOL=batch DEAL=2691 FROM=195 TO=204 [ARM=off]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { HOOKS, applyPatches } from '../runner-rework/core-hooks';
import { loadTree } from '../runner-rework/facts-trees';
import { gPatches } from './g-patches';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const ARM = process.env.ARM ?? 'on';
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));

async function main() {
  const dir = resolve(process.env.TROOT ?? 'node_modules/.cache/g-audit', ARM);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync('src', join(dir, 'src'), { recursive: true });
  const read = (p: string) => readFileSync(p, 'utf8');
  const write = (p: string, t: string) => writeFileSync(p, t);
  applyPatches(dir, HOOKS.filter(([, , to]) => to.includes('__ans') || to.includes("__lkScope: 'oracle'")), 'hooks', read, write);
  applyPatches(dir, gPatches(ARM === 'off'), `G ${ARM}`, read, write);
  // Each listed mismatch with the context it was made in and the asker's (pricing.ts buildKeys: frozen|known corp|known
  // runner|anchor id:credits:side:root|decision seed|rezzing), so the part of the context the key leaves out is named
  const at = '    if (memoAudit.errors.length < 200) memoAudit.errors.push({ name, otherFrame: other, otherKnown });';
  applyPatches(dir, [['ai/valueModel.ts', at, at.replace('otherKnown });', 'otherKnown, made, now } as any);')]], 'audit', read, write);
  const t = (await loadTree(ARM, dir)) as any;
  const vm = await import(/* @vite-ignore */ join(dir, 'src', 'ai/valueModel.ts'));
  const pools: Record<string, string> = { batch: 'scripts/f117/recs/deals-45940481387.json', nrdb: 'scripts/runner-rework/facts-deals-45458221138.json' };
  const deals = JSON.parse(readFileSync(pools[process.env.POOL ?? 'batch'], 'utf8')) as { seed: number; corpDeck: string; runnerDeck: string }[];
  const d = deals.find(x => String(x.seed) === process.env.DEAL);
  if (!d) throw new Error(`no deal ${process.env.DEAL}`);
  const pool = [...ALL_DECKS, ...NRDB_TEST_DECKS];
  const c = pool.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = pool.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  t.clear();
  const g = new t.GameRunner(t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r)), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
  const FROM = Number(process.env.FROM ?? 0);
  const TO = Number(process.env.TO ?? 4000);
  for (let i = 0; i < TO; i++) {
    vm.memoAudit.reset();
    vm.memoAudit.on = i >= FROM;
    const T = g.state.turnNumber;
    let more: boolean;
    try {
      more = g.step();
    } finally {
      vm.memoAudit.on = false;
    }
    const a = vm.memoAudit;
    if (i >= FROM) {
      const bad = Object.fromEntries([...a.byName].filter(([, row]: any) => row.mismatches > 0));
      out({ kind: 'step', arm: ARM, i, T, checked: a.checked, mismatches: a.mismatches, otherFrameMismatches: a.otherFrameMismatches, otherKnownMismatches: a.otherKnownMismatches, bad, errors: a.errors.slice(0, 5), last: g.last });
    }
    if (!more) break;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
