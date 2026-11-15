/**
 * Step 4 Stage C5: how often the old Corp's recorded installs trash ice first (rule 8.5.6a; the ranking's
 * withDeadIceTrashed and iceTrashInstalls), and the cases. Output: one JSON line.
 *   npx vite-node scripts/stage-c/trash-first-count.ts > trash-first.json
 */
import { GameAction, cardDef, findCardAnywhere } from '../../src/core';
import { isCorpMain } from '../../src/ai/corp/lines';
import { forEachRecorded } from '../stage-a/harness';

const out = { installs: 0, iceInstalls: 0, trashFirst: 0, byServer: {} as Record<string, number>, examples: [] as string[] };
forEachRecorded({
  decision: d => {
    const s = d.state;
    const a = d.action as (GameAction & { cardInstanceId?: string; targetServerId?: string; trashFirst?: string[] }) | null;
    if (d.kind !== 'action' || !a || a.type !== 'INSTALL_CARD' || !isCorpMain(s)) return;
    out.installs++;
    const card = findCardAnywhere(s, a.cardInstanceId ?? '');
    if (card && cardDef(card).type_code === 'ice') out.iceInstalls++;
    if (!a.trashFirst?.length) return;
    out.trashFirst++;
    const server = a.targetServerId ?? 'new';
    out.byServer[server] = (out.byServer[server] ?? 0) + 1;
    if (out.examples.length < 20) {
      const trashed = a.trashFirst.map(id => findCardAnywhere(s, id)).map(c => (c ? cardDef(c).title + (c.isRezzed ? '*' : '') : '?'));
      out.examples.push(`${d.src} T${s.turnNumber} ${card ? cardDef(card).title : '?'} -> ${server}, trashing ${trashed.join(',')}; credits ${s.corp.credits}, ice there ${s.corp.servers[server]?.ice.length ?? 0}`);
    }
  },
});
console.log(JSON.stringify(out));
