/**
 * Stage C (AI Coordinator 2026-11-15 12:50Z): the ice redirect was a measured gain (+2.1 ± 0.7). On the recorded states
 * where the old Corp (planner on) installed ice on the scoring remote while it was short (scoringShort: iceRedirect's
 * target; the recorded move is the pick after the rewrite, so a pick that chose that server itself is counted too),
 * what does the new Corp play, with the look-ahead and without it?
 *   SHARD=0/2 npx vite-node scripts/stage-c/redirect-follow.ts > rf-0.json
 */
import { GameAction, GameState, cardDef, findCardAnywhere } from '../../src/core';
import { HeuristicCorpAI } from '../../src/ai/corpAI';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { isCorpMain } from '../../src/ai/corp/lines';
import { scoringShort } from '../../src/ai/corp/placement';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

type Install = GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
const out = { redirects: 0, planner: {} as Record<string, number>, nolook: {} as Record<string, number>, examples: [] as string[] };
const inc = (t: Record<string, number>, k: string) => (t[k] = (t[k] ?? 0) + 1);
const typeOf = (s: GameState, a: Install) => {
  const c = a.cardInstanceId ? findCardAnywhere(s, a.cardInstanceId) : undefined;
  return c ? cardDef(c).type_code : '';
};
const label = (s: GameState, a: Install) => {
  const c = a.cardInstanceId ? findCardAnywhere(s, a.cardInstanceId) : undefined;
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${a.targetServerId ? '@' + a.targetServerId : a.asNewRemote ? '@new' : ''}`;
};
function kind(s: GameState, played: Install, a: Install, scoring: string): string {
  if (JSON.stringify(a) === JSON.stringify(played)) return 'same move';
  if (a.type === 'INSTALL_CARD' && typeOf(s, a) === 'ice') return a.targetServerId === scoring ? 'other ice, same remote' : ['hq', 'rd', 'archives'].includes(a.targetServerId ?? '') ? 'ice to a central' : 'ice elsewhere';
  return a.type === 'INSTALL_CARD' ? `install ${typeOf(s, a)}` : a.type;
}

forEachRecorded({
  decision: d => {
    const s = d.state;
    const played = d.action as Install | null;
    if (d.kind !== 'action' || !played || played.type !== 'INSTALL_CARD' || !isCorpMain(s) || typeOf(s, played) !== 'ice') return;
    const scoring = asSide('corp', () => (decisionContext(s, 'corp'), scoringShort(s)?.id));
    if (!scoring || played.targetServerId !== scoring) return;
    out.redirects++;
    const core = { ...plan(), corpCore: true, rolloutLines: true };
    const off = { ...core, turnPlanner: { ...(core.turnPlanner ?? {}), corp: false } };
    const play = (p: typeof core) => withPricing({ plan: p }, () => (clearCaches(), new HeuristicCorpAI({ synergy: true }).chooseAction(structuredClone(s)) as Install));
    const a = play(core);
    const b = play(off);
    inc(out.planner, kind(s, played, a, scoring));
    inc(out.nolook, kind(s, played, b, scoring));
    if (out.examples.length < 30) out.examples.push(`${d.src} T${s.turnNumber} c${s.corp.clicks} $${s.corp.credits}: old ${label(s, played)}; planner ${label(s, a)}; no look-ahead ${label(s, b)}`);
  },
});
console.log(JSON.stringify(out));
