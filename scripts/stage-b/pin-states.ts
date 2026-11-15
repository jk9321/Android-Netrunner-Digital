/**
 * Stage B6: writes the recorded states of the Stage D pins (spec-step4-corp-core.md section 5) to tests/fixtures/, and
 * prints what each decision was: Part B install prompts (#49 #219, #50 #252) and the open case (#49 #82, #111; #53 #191,
 * #62, #112, #76).
 *
 *   npx vite-node scripts/stage-b/pin-states.ts
 */
import { writeFileSync } from 'node:fs';
import { activePrompt, cardDef, findCardAnywhere } from '../../src/core';
import { forEachRecorded } from '../stage-a/harness';

const want = new Set(['report-49.json #219', 'report-50.json #252', 'report-49.json #82', 'report-49.json #111', 'report-53.json #191', 'report-53.json #62', 'report-53.json #112', 'report-53.json #76']);
process.env.DEALS = 'none';
process.env.HUMAN = 'report-49,report-50,report-53';
forEachRecorded({
  decision: d => {
    const at = `${d.src.replace('human:', '')} #${d.i}`;
    if (!want.has(at)) return;
    const name = `stage-b-pin-${at.replace('.json', '').replace(' #', '-')}.json`;
    writeFileSync(`tests/fixtures/${name}`, JSON.stringify(d.state));
    const p = activePrompt(d.state);
    const card = (id?: string) => (id ? findCardAnywhere(d.state, id) : undefined);
    const a = d.action as unknown as Record<string, unknown>;
    console.log(JSON.stringify({ at, name, kind: d.kind, turn: d.turn, prompt: p ? { kind: p.kind, side: p.side, source: card((p as { sourceCardId?: string }).sourceCardId) ? cardDef(card((p as { sourceCardId?: string }).sourceCardId)!).title : undefined } : null, action: a, card: typeof a.cardInstanceId === 'string' && card(a.cardInstanceId) ? cardDef(card(a.cardInstanceId)!).title : undefined }));
  },
});
