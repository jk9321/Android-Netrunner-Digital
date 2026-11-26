/**
 * Owed count 8 (the loader side finding): does a script that loads a scratch tree's modules one dynamic import each
 * (`import(join(dir, 'src', 'ai/x.ts'))`, the pattern of tag-owner/count.ts, runner-rework/facts-trees.ts and
 * cache-keys/count.ts) get the same module instances the tree's own `./x` imports load, or second copies? A tree of this
 * checkout's src with a recorder at the top of each module the scripts read (each evaluation pushes its URL); loaded
 * three ways, each in its own process: STYLE=abs (the old loaders: an absolute dir, from `resolve()`), STYLE=rel (a
 * relative dir, as corp-owed/trees.ts's rootOf gave before its entry file), STYLE=entry (corp-owed/trees.ts loadTree).
 * Then a functional check: the copy's valueModel registration as the AI's agent sees it, and clearHandCaches reaching the
 * cache the agent fills.
 *
 *   for s in abs rel entry; do STYLE=$s npx vite-node scripts/corp-owed/loaders.ts; done
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadTree } from './trees';

const STYLE = process.env.STYLE ?? 'abs';
const FILES = ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/evaluate.ts', 'ai/handValues.ts', 'ai/valueModel.ts', 'ai/effectValues.ts', 'ai/iceValues.ts', 'ai/threatModel.ts', 'ai/pricing.ts', 'ai/cardPlans.ts', 'ai/synergyTags.ts', 'ai/runs.ts', 'core/engine/cardEffects.ts', 'ai/turnPlanner.ts'];
const rel = `node_modules/.cache/corp-owed-loaders-${STYLE}`;
const dir = STYLE === 'abs' ? resolve(rel) : rel;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
cpSync('src', join(dir, 'src'), { recursive: true });
for (const f of FILES) {
  const p = join(dir, 'src', f);
  writeFileSync(p, `((globalThis as any).__owLoads ??= []).push(${JSON.stringify(f)} + ' ' + import.meta.url);\n` + readFileSync(p, 'utf8'));
}
const G = globalThis as any;

async function main() {
  let m: Record<string, any>;
  if (STYLE === 'entry') {
    const t: any = await loadTree('loaders', dir);
    m = { 'ai/index.ts': t.ai, 'ai/playout.ts': t.po, 'core/index.ts': t.core, 'data/decks.ts': t.decks, 'ai/handValues.ts': t.hv, 'ai/valueModel.ts': t.vm, 'ai/pricing.ts': t.pricing, 'ai/evaluate.ts': t.ev };
  } else {
    m = {};
    for (const f of FILES) m[f] = await import(/* @vite-ignore */ join(dir, 'src', f));
  }
  const loads: string[] = G.__owLoads;
  const per = new Map<string, string[]>();
  for (const l of loads) {
    const [f, url] = l.split(' ');
    per.set(f, [...(per.get(f) ?? []), url]);
  }
  const twice = [...per].filter(([, u]) => u.length > 1);
  console.log(`STYLE=${STYLE} dir=${dir}`);
  console.log(`  module evaluations: ${loads.length} for ${per.size} files; evaluated more than once: ${twice.length ? twice.map(([f, u]) => `${f} x${u.length}`).join(', ') : 'none'}`);
  if (twice.length) console.log(`  e.g. ${twice[0][0]}: ${twice[0][1].join(' | ')}`);
  // Functional: an agent move on a fresh game, then the hand cache the agent filled, cleared through the script's copy
  const core = m['core/index.ts'];
  const decks = m['data/decks.ts'];
  const ai = m['ai/index.ts'];
  const hv = m['ai/handValues.ts'];
  const s = core.createInitialGameState(decks.deckGameSetup(1001, decks.STARTER_DECKS.find((d: any) => d.side === 'corp'), decks.STARTER_DECKS.find((d: any) => d.side === 'runner')));
  console.log(`  hv exports: ${Object.keys(hv).filter(k => /cache|Cache/.test(k)).join(', ')}`);
  let ok = 'not read';
  try {
    const agent = ai.createAgent(s.activePlayer, 'normal');
    agent.chooseAction(structuredClone(s));
    ok = 'agent moved';
  } catch (e) {
    ok = `agent threw: ${(e as Error).message.slice(0, 120)}`;
  }
  console.log(`  ${ok}`);
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
