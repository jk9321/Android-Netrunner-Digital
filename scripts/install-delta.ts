/**
 * Install-worth side check (AI Coordinator, 2026-11-08): is the install delta itself too big? At Jeff's positions where
 * the planner installed one of the cards it keeps picking and Jeff made an agenda move, the one-step evaluate(corp) split:
 * the card installed (unrezzed, its board worth), the same card as one card in HQ (the hand's worth with and without
 * it), the click (the click price), the credits; and the same for Jeff's move. Priced as the planner's leaf prices
 * (turnPlanner.ts leafValue), no Runner reply.
 *
 * Usage: npx vite-node scripts/install-delta.ts -- [--cards=Mitra Aman,Anoetic Void,...]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { corpBoardValue, evaluate, handAndClicks } from '../src/ai/evaluate';
import { sideCreditValue } from '../src/ai/valueModel';
import { asSide, plan, pricing, withPricing } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { applyPlanOff } from '../src/ai/synergy';

applyPlanOff(process.env.PLAN_OFF ?? '');
const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const CARDS = (opt('cards') ?? 'Mitra Aman,Anoetic Void,Diviner,Manegarm Skunkworks,Regolith Mining License,Public Access Plaza').split(',');
const dir = 'tests/fixtures/human-games';

const cardOf = (s: GameState, a: GameAction) => ('cardInstanceId' in a && a.cardInstanceId ? findCardAnywhere(s, a.cardInstanceId) : undefined);
const describe = (s: GameState, a: GameAction) => {
  const c = cardOf(s, a);
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${'targetServerId' in a && a.targetServerId ? ' @' + a.targetServerId : ''}`;
};
const mainPhase = (s: GameState) => !s.activeRun && s.pendingPrompts.length === 0 && !(s.priority && s.priority.holder !== s.activePlayer);
const agendaMove = (s: GameState, a: GameAction) => ['ADVANCE_CARD', 'INSTALL_CARD', 'SCORE_AGENDA'].includes(a.type) && cardOf(s, a) && cardDef(cardOf(s, a)!).type_code === 'agenda';

/** One state's parts as the leaf prices them. */
function parts(s: GameState) {
  const clicks = s.corp.clicks;
  const hc = handAndClicks(s, 'corp', 'corp');
  const noClicks = handAndClicks({ ...s, corp: { ...s.corp, clicks: 0 } }, 'corp', 'corp');
  return { total: evaluate(s, 'corp'), board: corpBoardValue(s, 'corp'), hand: noClicks, clicks: hc - noClicks, clickPrice: clicks ? (hc - noClicks) / clicks : NaN, credits: sideCreditValue(s, 'corp', 'corp') };
}
const leaf = <T,>(s: GameState, fn: () => T) => asSide('corp', () => { decisionContext(s, 'corp'); return withPricing({ frozen: true }, () => withPricing({ leaves: [...pricing().leaves, { side: 'corp', plan: plan() }] }, fn)); });

const seen = new Set<string>();
const f = (x: number) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : '  -');
console.log('| card (position) | AI install: total | card on board | card in HQ | click | credits | Jeff move | its total | its board | its click | its credits |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const file of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
  const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (!report.moves?.length || report.config.ai !== 'runner') continue;
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const move of report.moves as GameAction[]) {
    const main = move.player === 'corp' && s.activePlayer === 'corp' && mainPhase(s) && actingSide(s) === 'corp' && move.type !== 'START_TURN' && move.type !== 'END_TURN';
    if (main && agendaMove(s, move)) {
      const ai = createAgent('corp', 'normal').chooseAction(s);
      const card = ai.type === 'INSTALL_CARD' ? cardOf(s, ai) : undefined;
      const title = card ? cardDef(card).title : '';
      if (card && CARDS.includes(title) && !seen.has(title)) {
        seen.add(title);
        const before = leaf(s, () => parts(s));
        const afterAi = executeAction(s, ai);
        const a = leaf(afterAi, () => parts(afterAi));
        const placed = findCardAnywhere(afterAi, card.instanceId)!;
        void placed;
        const afterJ = executeAction(s, move);
        const j = leaf(afterJ, () => parts(afterJ));
        // The card in HQ: the hand's worth with it less without it (the handValue slope at this hand size)
        const without = { ...s, corp: { ...s.corp, hq: s.corp.hq.filter(c => c.instanceId !== card.instanceId) } };
        const inHq = before.hand - leaf(without, () => parts(without)).hand;
        const onBoard = a.board - before.board;
        console.log(`| ${title} (${file.replace('.json', '')} T${s.turnNumber}, ${s.corp.clicks} clicks, ${s.corp.credits}cr) | ${f(a.total - before.total)} | ${f(onBoard)} | ${f(-inHq)} | ${f(a.clicks - before.clicks)} | ${f(a.credits - before.credits)} | ${describe(s, move)} | ${f(j.total - before.total)} | ${f(j.board - before.board)} | ${f(j.clicks - before.clicks)} | ${f(j.credits - before.credits)} |`);
      }
    }
    s = executeAction(s, move);
  }
}
const missing = CARDS.filter(c => !seen.has(c));
if (missing.length) console.log(`\nno position where the AI installed it over an agenda move of Jeff's: ${missing.join(', ')}`);
