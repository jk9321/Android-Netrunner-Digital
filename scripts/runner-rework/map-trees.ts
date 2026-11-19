/**
 * R0 count 1 (Runner rework; brief /mnt/project-files/netrunner-ai/runner-rework/r0/count1-audit-map/brief.md): the trees.
 *
 * A tree is a plain copy of this checkout's src/ loaded as its own module graph (as scripts/stage-vc/breaker-once-trees.ts,
 * whose loadTree this reuses). No tree is patched: this count builds no arm that changes a rule.
 *  - source: plays the source games (the g1 base deals) with a plain GameRunner. Never asked, never cleared mid-game
 *    (found row 71b); its agents are only read (their private fields copied) between steps.
 *  - probe: every ask (the control ask and the asks on changed boards), with fresh agents restored from the copied fields.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Tree, loadTree } from '../stage-vc/breaker-once-trees';

export type MapTree = Tree & { reply: any; helpers: any; rdKnowledge: any; runs: any };

export async function mapTrees(root: string): Promise<{ source: MapTree; probe: MapTree }> {
  rmSync(root, { recursive: true, force: true });
  const out: Record<string, MapTree> = {};
  for (const name of ['source', 'probe']) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    const t = (await loadTree(name, dir)) as MapTree;
    const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
    t.reply = await m('ai/runnerReply.ts');
    t.helpers = await m('core/engine/helpers.ts');
    t.rdKnowledge = await m('core/engine/rdKnowledge.ts');
    t.runs = await m('ai/runs.ts');
    out[name] = t;
  }
  return out as { source: MapTree; probe: MapTree };
}
