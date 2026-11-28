/**
 * R-C1 Part 0, R-26: each ported tree loads and plays. For every arm of rank-cost-trees.ts, get-in-trees.ts,
 * decided-twice-trees.ts and decided-twice-pins.ts: build the tree (the script's own makeTrees, so a patch that misses
 * stops it), import its module graph and play one starter-deck game for STEPS steps (default 600) with Normal agents,
 * the arm's globals unset (each patch then does what the line did). A patch that matches but breaks the code (a name
 * not in scope, a syntax error) fails here. A smoke test only: no number is read.
 *
 *   PATCH_CHECK=1 npx vite-node scripts/runner-rework/rc1-part0/tree-smoke.ts [family ...]
 */
import { join, resolve } from 'node:path';
import { C_ARMS, D_ARMS, makeTrees as rankTrees } from '../rank-cost-trees';
import { ARMS, makeTrees as getInTrees } from '../get-in-trees';
import { makeTrees as dtTrees } from '../decided-twice-trees';
import { TREES as PIN_TREES } from '../decided-twice-pins';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const STEPS = Number(process.env.STEPS ?? 600);
const ROOT = resolve('node_modules/.cache/rc1-tree-smoke');
const want = new Set(process.argv.slice(2));
const on = (family: string) => want.size === 0 || want.has(family);

async function play(name: string, dir: string): Promise<string> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const po = await m('ai/playout.ts');
  const core = await m('core/index.ts');
  const decks = await m('data/decks.ts');
  const setup = decks.deckGameSetup(7, decks.STARTER_DECKS[0], decks.STARTER_DECKS[1]);
  const g = new po.GameRunner(core.createInitialGameState(setup), { corp: ai.createAgent('corp', 'normal'), runner: ai.createAgent('runner', 'normal') });
  let k = 0;
  for (; k < STEPS && !g.state.winner; k++) if (!g.step()) break;
  return `ok   ${name}: ${k} steps, turn ${g.state.turnNumber}`;
}

async function main() {
  rmSync(ROOT, { recursive: true, force: true });
  const out: string[] = [];
  let bad = 0;
  const run = async (name: string, dir: () => string) => {
    try {
      out.push(await play(name, dir()));
    } catch (e) {
      bad++;
      out.push(`FAIL ${name}: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`);
    }
    console.log(out[out.length - 1]);
  };
  if (on('rank-cost')) for (const arm of ['control', 'instr', 'deckRootA', ...C_ARMS, ...D_ARMS]) await run(`rank-cost-trees ${arm}`, () => rankTrees(join(ROOT, 'rc', arm), [arm])[arm]);
  if (on('get-in')) for (const arm of ARMS) await run(`get-in-trees ${arm}`, () => getInTrees(join(ROOT, 'gi', arm), [arm])[arm]);
  if (on('decided-twice')) {
    const dirs = dtTrees(join(ROOT, 'dt'));
    for (const [t, d] of Object.entries(dirs)) await run(`decided-twice-trees ${t}`, () => d);
  }
  if (on('decided-twice-pins'))
    for (const [t, patches] of Object.entries(PIN_TREES))
      await run(`decided-twice-pins ${t}`, () => {
        const dir = join(ROOT, 'dp', t);
        mkdirSync(dir, { recursive: true });
        cpSync('src', join(dir, 'src'), { recursive: true });
        for (const [f, at, to] of patches) {
          const path = join(dir, 'src', f);
          const text = readFileSync(path, 'utf8');
          if (text.split(at).length !== 2) throw new Error(`${t}: a patch does not match once in ${f}`);
          writeFileSync(path, text.replace(at, () => to));
        }
        return dir;
      });
  console.log(bad === 0 ? `every tree loads and plays ${STEPS} steps` : `${bad} trees fail`);
  if (bad > 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
