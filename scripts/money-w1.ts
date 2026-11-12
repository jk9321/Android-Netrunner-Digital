/**
 * Money W1 (AI Coordinator 2026-11-12, after W0: the AI spends 2.95 clicks a game drawing against Jeff's 1.64, with
 * money and playable cards in HQ, and what it draws mostly sits). Measurement only. The Normal Corp AI on the decks of
 * Jeff's Corp games (tests/fixtures/human-games, config.ai 'runner'; same seed plus EXTRA more), Corp turns 1-10. For
 * each draw click (rule 5.6.2):
 *   - where the pick came from: the planner's search, the planner's remembered line, or the rule ranking (no search);
 *   - every planner candidate's value by class (install ice / agenda / asset, advance, money, other) beside the draw's,
 *     and the best non-draw candidate's fate under the counted rules (scoreInTwoPick veto, moneyPick override);
 *     classes the rule ranking had but the planner did not play out are listed with their rank;
 *   - what a draw is priced at (handValues drawWorth at the decision) and the deck-average cache hits it took during
 *     the decision, with how many were stale (worked out again with HQ and clicks as they are: drawWorthStats.check);
 *   - the drawn card's type and whether it was installed or played by the end of turn T+2.
 * Jeff's games are replayed too, for his agenda installs in the positions where only agendas were playable at 3-5
 * credits: what became of those agendas (scored, stolen, still installed, trashed).
 *
 *   [EXTRA=3] [SHARD=0/2] [SKIP=done.jsonl] npx vite-node scripts/money-w1.ts > w1.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere, getLegalActions } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { cardSynergy } from '../src/ai/synergyTags';
import { plannerStats } from '../src/ai/turnPlanner';
import { drawWorthAt, drawWorthStats } from '../src/ai/handValues';
import { scoreInTwoPick } from '../src/ai/countedScore';
import { moneyPick } from '../src/ai/incomeLine';
import { asSide } from '../src/ai/pricing';

const DIR = 'tests/fixtures/human-games';
const TURNS = 10;
const EXTRA = Number(process.env.EXTRA ?? 3);
drawWorthStats.check = true;

const econ = (c: CardInstance) => (cardSynergy(cardDef(c)).gives?.econ ?? 0) > 0;
const type = (c: CardInstance) => cardDef(c).type_code;
const bucket = (c: CardInstance) => (type(c) === 'agenda' ? 'agenda' : type(c) === 'ice' ? 'ice' : econ(c) ? 'econ' : 'other');

/** The class of a main-phase action. */
function classOf(s: GameState, a: GameAction): string {
  const id = 'cardInstanceId' in a ? (a as { cardInstanceId?: string }).cardInstanceId : undefined;
  const card = id ? findCardAnywhere(s, id) : undefined;
  switch (a.type) {
    case 'DRAW_CARD': return 'draw';
    case 'GAIN_CREDIT': return 'money';
    case 'ADVANCE_CARD': return 'advance';
    case 'INSTALL_CARD': return !card ? 'install ?' : type(card) === 'ice' ? 'install ice' : type(card) === 'agenda' ? 'install agenda' : 'install asset/upgrade';
    case 'PLAY_OPERATION_OR_EVENT':
    case 'USE_ABILITY': return card && econ(card) ? 'money' : 'other';
    default: return 'other';
  }
}

/** The position class W0 used: kinds legal to install or play now, and credits. */
function positionClass(s: GameState): { what: string; money: string } {
  const legal = new Set(getLegalActions(s, 'corp').filter(x => x.type === 'INSTALL_CARD' || x.type === 'PLAY_OPERATION_OR_EVENT').map(x => (x as { cardInstanceId: string }).cardInstanceId));
  const p: Record<string, number> = {};
  for (const c of s.corp.hq) if (legal.has(c.instanceId)) p[bucket(c)] = (p[bucket(c)] ?? 0) + 1;
  const what = [p.ice ? 'ice' : '', p.econ ? 'econ' : '', p.other ? 'other' : ''].filter(Boolean).join('+') || (p.agenda ? 'agendas only' : 'nothing');
  const c = s.corp.credits;
  return { what, money: c <= 2 ? '0-2cr' : c <= 5 ? '3-5cr' : c <= 8 ? '6-8cr' : '9+cr' };
}

interface Draw {
  turn: number;
  clicks: number;
  credits: number;
  position: string;
  source: 'search' | 'memory' | 'rule';
  /** For a memory or rule draw: the class a fresh search here picks */
  freshPick?: string | null;
  /** Planner candidates: class -> best value; the draw's own value */
  candidates?: Record<string, number>;
  drawValue?: number;
  bestOther?: { cls: string; value: number; vetoed: boolean; money: boolean };
  /** Classes the rule ranking had (finite) that were not among the planner's candidates: class -> best rank index */
  missing?: Record<string, number>;
  rankOfDraw: number;
  drawWorth: number;
  hits: number;
  stale: number;
  drawn?: { type: string; usedBy?: number };
}

interface AgendaFate { turn: number; position: string; fate?: string }

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const done = new Set((process.env.SKIP ? readFileSync(process.env.SKIP, 'utf8') : '').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.game}|${r.who}|${r.seed}`; }));
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().filter(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')).config.ai === 'runner');

/** What became of an installed agenda by the end of the replay. */
function fate(end: GameState, id: string): string {
  if (end.corp.scoreArea?.some((c: CardInstance) => c.instanceId === id)) return 'scored';
  if (end.runner.scoreArea?.some((c: CardInstance) => c.instanceId === id)) return 'stolen';
  if (Object.values(end.corp.servers).some(v => v.root.some(c => c.instanceId === id))) return 'still installed';
  return 'trashed/other';
}

for (const [index, file] of files.entries()) {
  if (index % shards !== shard) continue;
  const report = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  if (!report.moves?.length) continue;
  const { seed, corpDeck, runnerDeck } = report.config;
  // Jeff: agenda installs where only agendas were playable at 3-5 credits, and their fate
  if (!done.has(`${file}|jeff|${seed}`)) {
    let s: GameState = createInitialGameState(deckGameSetup(seed, corpDeck, runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    const agendas = new Map<string, AgendaFate>();
    let draws = 0;
    for (const move of report.moves as GameAction[]) {
      let n: GameState;
      try {
        n = executeAction(s, move);
      } catch {
        break;
      }
      const click = s.turnNumber <= TURNS && s.activePlayer === 'corp' && move.player === 'corp' && n.corp.clicks < s.corp.clicks;
      if (click && move.type === 'DRAW_CARD') draws++;
      if (click && move.type === 'INSTALL_CARD') {
        const card = findCardAnywhere(s, move.cardInstanceId);
        if (card && type(card) === 'agenda') {
          const p = positionClass(s);
          agendas.set(card.instanceId, { turn: s.turnNumber, position: `${p.what} ${p.money}` });
        }
      }
      s = n;
    }
    for (const [id, a] of agendas) a.fate = fate(s, id);
    console.log(JSON.stringify({ game: file, who: 'jeff', seed, draws, agendas: [...agendas.values()] }));
  }
  for (let k = 0; k <= EXTRA; k++) {
    if (done.has(`${file}|ai|${seed + k}`)) continue;
    valueLoops.clear();
    const corp = createAgent('corp', 'normal') as HeuristicCorpAI;
    const game = new GameRunner(createInitialGameState(deckGameSetup(seed + k, corpDeck, runnerDeck)), { corp, runner: createAgent('runner', 'normal') });
    const draws: Draw[] = [];
    const pending = new Map<string, Draw>();
    const agendas = new Map<string, AgendaFate>();
    const seen: { cur: { values: number[]; actions: GameAction[] } | null } = { cur: null };
    plannerStats.onCandidates = (side, values, actions) => {
      if (side === 'corp') seen.cur = { values, actions };
    };
    const memory = () => (corp as unknown as { planMemory: { line: { action: GameAction }[] } }).planMemory.line;
    const heldLine = () => (corp as unknown as { heldLine: Parameters<typeof scoreInTwoPick>[2] }).heldLine;
    for (let i = 0; i < 6000 && game.state.turnNumber <= TURNS + 3; i++) {
      const before = game.state;
      const main = before.activePlayer === 'corp' && !before.activeRun && before.pendingPrompts.length === 0 && before.corp.clicks > 0 && before.turnNumber <= TURNS && !before.turnStep;
      seen.cur = null;
      const lineBefore = main ? [...memory()] : [];
      const h0 = drawWorthStats.hits;
      const st0 = drawWorthStats.stale;
      if (!game.step()) break;
      const a = game.last!;
      const n = game.state;
      // A drawn card installed or played
      if (a.player === 'corp' && 'cardInstanceId' in a) {
        const d = pending.get((a as { cardInstanceId: string }).cardInstanceId);
        if (d?.drawn && d.drawn.usedBy === undefined && (a.type === 'INSTALL_CARD' || a.type === 'PLAY_OPERATION_OR_EVENT')) d.drawn.usedBy = before.turnNumber;
      }
      if (main && a.player === 'corp' && a.type === 'INSTALL_CARD') {
        const card = findCardAnywhere(before, a.cardInstanceId);
        if (card && type(card) === 'agenda') {
          const p = positionClass(before);
          agendas.set(card.instanceId, { turn: before.turnNumber, position: `${p.what} ${p.money}` });
        }
      }
      if (!main || a.player !== 'corp' || a.type !== 'DRAW_CARD') continue;
      const p = positionClass(before);
      const ranked = asSide('corp', () => corp.rankMainActions(before));
      const live = ranked.filter(r => r.score > -Infinity);
      const d: Draw = {
        turn: before.turnNumber,
        clicks: before.corp.clicks,
        credits: before.corp.credits,
        position: `${p.what} ${p.money}`,
        source: seen.cur ? 'search' : lineBefore[0] && JSON.stringify(lineBefore[0].action) === JSON.stringify(a) ? 'memory' : 'rule',
        rankOfDraw: live.findIndex(r => r.action.type === 'DRAW_CARD'),
        drawWorth: asSide('corp', () => drawWorthAt(before, 'corp')),
        hits: drawWorthStats.hits - h0,
        stale: drawWorthStats.stale - st0,
      };
      // A draw from the remembered line or the rule ranking: the planner's search run again here, to read what it
      // would score each class at (its memory put back after, so the game plays on as it did)
      if (!seen.cur) {
        const keep = [...memory()];
        const fresh = asSide('corp', () => (corp as unknown as { plan(s: GameState, r: typeof ranked): GameAction | null }).plan(before, ranked));
        d.freshPick = fresh ? classOf(before, fresh) : null;
        memory().splice(0, memory().length, ...keep);
      }
      const cand = seen.cur as { values: number[]; actions: GameAction[] } | null;
      if (cand) {
        d.candidates = {};
        let best: { cls: string; value: number; action: GameAction } | null = null;
        cand.actions.forEach((x, j) => {
          const cls = classOf(before, x);
          const v = cand.values[j];
          if (d.candidates![cls] === undefined || v > d.candidates![cls]) d.candidates![cls] = v;
          if (cls === 'draw') d.drawValue = Math.max(d.drawValue ?? -Infinity, v);
          else if (!best || v > best.value) best = { cls, value: v, action: x };
        });
        const b = best as { cls: string; value: number; action: GameAction } | null;
        if (b) {
          const two = scoreInTwoPick(before, b.action, heldLine());
          d.bestOther = { cls: b.cls, value: b.value, vetoed: JSON.stringify(two.action) !== JSON.stringify(b.action), money: !!moneyPick(before, b.action) };
        }
        const inSearch = new Set(cand.actions.map(x => JSON.stringify(x)));
        d.missing = {};
        live.forEach((r, j) => {
          const cls = classOf(before, r.action);
          if (!inSearch.has(JSON.stringify(r.action)) && d.missing![cls] === undefined && !d.candidates![cls]) d.missing![cls] = j;
        });
      }
      const drawn = n.corp.hq.find(c => !before.corp.hq.some(x => x.instanceId === c.instanceId));
      if (drawn) {
        d.drawn = { type: bucket(drawn) };
        pending.set(drawn.instanceId, d);
      }
      draws.push(d);
    }
    plannerStats.onCandidates = undefined;
    for (const [id, x] of agendas) x.fate = fate(game.state, id);
    console.log(JSON.stringify({ game: file, who: 'ai', seed: seed + k, draws, agendas: [...agendas.values()] }));
  }
}
