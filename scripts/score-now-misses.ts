/**
 * Corp redesign stage 0b follow-up (AI Coordinator 2026-11-10): at the Corp decisions where the exact score-this-turn
 * search (countedScore.ts scoreThisTurn, plan.winNow's search with the score set to 6) finds a score and the Corp's own
 * move differs from the line's next action, did the Corp score that agenda later in the same turn anyway (ordering only)
 * or end the turn without it (a true miss)? Reads games recorded by plan-measure-record.ts.
 *
 *   npx vite-node scripts/score-now-misses.ts -- --ai=dir [--examples=3]
 *
 * Measurement only. A true miss is grouped by the Corp's first move off the line that is not on the agenda itself.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, findCardAnywhere } from '../src/core';
import { scoreThisTurn } from './plan-measure-lib';
import { isCorpMain } from '../src/ai/corp/lines';
import { replayGame, serverOf } from './plan-measure-lib';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const dir = opt('ai') ?? '';
const examples = Number(opt('examples') ?? 3);

const idOf = (a: GameAction) => (a as { cardInstanceId?: string }).cardInstanceId;
const same = (a: GameAction, b: GameAction) => a.type === b.type && idOf(a) === idOf(b) && (a as { targetServerId?: string }).targetServerId === (b as { targetServerId?: string }).targetServerId;
const typeOf = (s: GameState, id?: string) => {
  const c: CardInstance | undefined = id ? findCardAnywhere(s, id) : undefined;
  return c ? cardDef(c).type_code : '?';
};
const title = (s: GameState, id?: string) => {
  const c = id ? findCardAnywhere(s, id) : undefined;
  return c ? cardDef(c).title : '?';
};
/** One word for a move, relative to the agenda the line scores. */
function kind(s: GameState, a: GameAction, agenda: string): string {
  const id = idOf(a);
  switch (a.type) {
    case 'ADVANCE_CARD':
      return id === agenda ? 'advance it' : typeOf(s, id) === 'agenda' ? 'advance another agenda' : 'advance a non-agenda';
    case 'SCORE_AGENDA':
      return id === agenda ? 'score it' : 'score another';
    case 'INSTALL_CARD':
      return `install ${typeOf(s, id)}${(a as { targetServerId?: string }).targetServerId && ['hq', 'rd', 'archives'].includes((a as { targetServerId?: string }).targetServerId!) ? ' on a central' : ''}`;
    case 'PLAY_OPERATION_OR_EVENT':
      return 'play an operation';
    case 'GAIN_CREDIT':
      return 'click for a credit';
    case 'DRAW_CARD':
      return 'draw';
    case 'REZ_CARD':
      return `rez ${typeOf(s, id)}`;
    case 'USE_ABILITY':
      return `use ${typeOf(s, id)}`;
    case 'END_TURN':
      return 'end turn';
    default:
      return a.type.toLowerCase();
  }
}
const text = (s: GameState, a: GameAction, after: GameState) => {
  const k = kind(s, a, '');
  const t = title(s, idOf(a));
  if (a.type === 'INSTALL_CARD') return `install ${t} in ${serverOf(after, idOf(a) ?? '') ?? '?'}`;
  return t !== '?' ? `${k.split(' ')[0]} ${t}` : k;
};

let games = 0;
let decisions = 0;
let differ = 0;
const turnsWith = { total: 0, ordering: 0, miss: 0, stolenOrLost: 0 };
const patterns = new Map<string, { n: number; eg: string[] }>();
for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort((a, b) => parseInt(a) - parseInt(b))) {
  for (const g of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (g.crashed || !g.moves) continue;
    games++;
    const game = replayGame(g);
    for (const t of game.turns) {
      let first: { i: number; agenda: string; line: GameAction[] } | null = null;
      for (let i = 0; i < t.steps.length; i++) {
        const st = t.steps[i];
        if (!isCorpMain(st.before) || st.before.corp.clicks <= 0) continue;
        const now = scoreThisTurn(st.before);
        if (!now.feasible || !now.line.length) continue;
        decisions++;
        if (same(st.action, now.line[0])) continue;
        differ++;
        if (!first) first = { i, agenda: now.agendaId!, line: now.line };
      }
      if (!first) continue;
      turnsWith.total++;
      const scored = t.end.corp.scoreArea.some(c => c.instanceId === first!.agenda);
      if (scored) {
        turnsWith.ordering++;
        continue;
      }
      turnsWith.miss++;
      if (t.end.runner.scoreArea.some(c => c.instanceId === first.agenda)) turnsWith.stolenOrLost++;
      const rest = t.steps.slice(first.i);
      const off = rest.find(st => !(idOf(st.action) === first!.agenda && st.action.type === 'ADVANCE_CARD'));
      const key = off ? kind(off.before, off.action, first.agenda) : 'only advanced it, ran out';
      const p = patterns.get(key) ?? { n: 0, eg: [] };
      p.n++;
      if (p.eg.length < examples) {
        const s0 = t.steps[first.i].before;
        const ag = findCardAnywhere(s0, first.agenda);
        p.eg.push(
          `deal ${g.config.seed} turn ${t.turn}: ${ag ? `${cardDef(ag).title} +${ag.advancementCounters} of ${cardDef(ag).advancement_cost}` : '?'}, Corp ${s0.corp.credits} cr ${s0.corp.clicks} clicks; did: ${rest
            .map(st => text(st.before, st.action, st.after))
            .join('; ')}; line: ${first.line.map(a => kind(s0, a, first!.agenda)).join(', ')}`,
        );
      }
      patterns.set(key, p);
    }
  }
}
console.log(`${games} games; main-phase decisions with a score this turn found: ${decisions}; the Corp's move differed from the line: ${differ} (${(differ / games).toFixed(2)} a game)`);
console.log(`Corp turns with such a decision: ${turnsWith.total}; the agenda scored later that turn anyway (ordering): ${turnsWith.ordering} (${((100 * turnsWith.ordering) / turnsWith.total).toFixed(1)}%); not scored that turn (true miss): ${turnsWith.miss}, of which stolen by turn end ${turnsWith.stolenOrLost}`);
console.log('True misses by the first move off the line:');
for (const [k, p] of [...patterns].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k}: ${p.n}`);
  for (const e of p.eg) console.log(`    - ${e}`);
}
