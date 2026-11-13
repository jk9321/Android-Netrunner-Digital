/**
 * Why asset cover did not fire (AI Coordinator 2026-11-13, play test round 3): replays report-format fixtures and, at
 * every Corp install of an asset or upgrade from HQ, asks assetCover and assetPartner with the move as the pick and
 * prints the reason each returns null (assetCoverStats / assetPartnerStats deltas, plus the inputs). With TURNS=a-b,
 * also every Corp main-phase decision in those turns: scoreInTwo's line, the scoring remote, whether it holds, and the
 * iced remotes with an open root. Measurement only.
 *
 *   FIX=round3-game1-claude-runner.json [TURNS=7-10] npx vite-node scripts/asset-cover-why.ts
 */
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { assetCover, assetCoverStats, assetPartner, holdCost, isCorpMain, knownIncome, runnerBudget, scoreInTwo, scoringRemote } from '../src/ai/countedScore';
import { profileOf } from '../src/ai/cardProfiles';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

import { applyPlanOff } from '../src/ai/synergy';
applyPlanOff(process.env.PLAN_OFF ?? '');
const file = process.env.FIX!;
const report = JSON.parse(readFileSync(file, 'utf8'));
const [t0, t1] = (process.env.TURNS ?? '0-0').split('-').map(Number);
let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
if (report.startStops) s = { ...s, stops: report.startStops };
const title = (c?: CardInstance) => (c ? cardDef(c).title : '-');
const inCorp = <T>(st: GameState, f: () => T): T => asSide('corp', () => (decisionContext(st, 'corp'), f()));
const remoteText = (st: GameState) => Object.values(st.corp.servers).filter(v => v.isRemote).map(v => `${v.id}[${v.ice.map(c => title(c) + (c.isRezzed ? '*' : '')).join(',')}|${v.root.map(c => title(c) + (c.isRezzed ? '*' : '')).join(',')}]`).join(' ');
for (const [i, move] of (report.moves as GameAction[]).entries()) {
  const corpMain = s.activePlayer === 'corp' && isCorpMain(s) && s.pendingPrompts.length === 0;
  const card = move.type === 'INSTALL_CARD' && move.player === 'corp' ? s.corp.hq.find(c => c.instanceId === move.cardInstanceId) : undefined;
  const root = card && ['asset', 'upgrade'].includes(cardDef(card).type_code);
  const inTurns = corpMain && s.turnNumber >= t0 && s.turnNumber <= t1;
  if (root || inTurns) {
    inCorp(s, () => {
      const before = { ...assetCoverStats };
      const cover = root ? assetCover(s, move) : null;
      const why = root ? Object.keys(assetCoverStats).filter(k => k !== 'asked' && assetCoverStats[k as keyof typeof assetCoverStats] !== before[k as keyof typeof before]) : [];
      const p = card ? profileOf(card.cardCode) : undefined;
      const partner = root ? assetPartner(s, move) : null;
      const scoring = scoringRemote(s);
      const agendas = s.corp.hq.filter(c => cardDef(c).type_code === 'agenda').map(title);
      const hqIce = s.corp.hq.filter(c => cardDef(c).type_code === 'ice').map(c => `${title(c)}(${cardDef(c).cost})`);
      const end = s.corp.credits + Math.max(0, s.corp.clicks - 1);
      const hold = scoring ? holdCost(s, scoring.ice, end) : null;
      const line = scoreInTwo(s);
      const where = (move as { asNewRemote?: boolean; targetServerId?: string }).asNewRemote ? 'new remote' : (move as { targetServerId?: string }).targetServerId;
      console.log(JSON.stringify({
        move: i, turn: s.turnNumber, clicks: s.corp.clicks, credits: s.corp.credits, income: knownIncome(s), runner: runnerBudget(s),
        pick: card ? `${title(card)} -> ${where}` : `${move.type}${(move as { cardInstanceId?: string }).cardInstanceId ? ':' + title(s.corp.hq.find(c => c.instanceId === (move as { cardInstanceId: string }).cardInstanceId)) : ''}`,
        ...(root ? { econ: !!p && p.pay > 0 && p.load > (cardDef(card!).cost ?? 0), cover: cover ? `${cover.form} ${cover.server}${cover.iceId ? ' ice ' + title(s.corp.hq.find(c => c.instanceId === cover.iceId)) : ''}` : null, coverWhy: why, partner: partner ? (partner as { targetServerId?: string }).targetServerId : null } : {}),
        scoring: scoring?.id ?? null, scoringHolds: scoring ? hold !== null : null, holdRez: hold, scoreInTwo: line ? `${line.agenda} ${line.form} ${line.server}` : null,
        hqAgendas: agendas, hqIce, remotes: remoteText(s),
      }));
    });
  }
  try {
    s = executeAction(s, move);
  } catch (e) {
    console.error(`move ${i}: ${e}`);
    break;
  }
}
