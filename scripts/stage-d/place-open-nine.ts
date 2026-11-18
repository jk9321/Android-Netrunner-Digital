/**
 * Stage D item 5, the AI Coordinator's answer part 1 section 3 (item5-placement/design-answer.md): the losses where
 * re-placing the Corp's ice holds the losing server, traced at their Corp turns. Each deal is played again on this tree
 * (the base of place-open.ts, scripts/stage-a/harness.ts playDeal); each human game is replayed move for move. At every
 * Corp decision of the named turns: the hand (ice marked), credits, clicks, the move, each staked server's count, and
 * for each ice in hand where `place` would put it from each legal install (server, reason) with the line the candidate
 * list gives it. At the end of each named Corp turn: the ice still in hand and the ice put in Archives that turn.
 *    npx vite-node scripts/stage-d/place-open-nine.ts                      (all)
 *    CASES=deal:1241:13:15 npx vite-node scripts/stage-d/place-open-nine.ts
 * Rules read: 8.5.11a (ice install cost, in place's own count), 1.7.2a (the game's end).
 */
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, getLegalActions } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { asSide } from '../../src/ai/pricing';
import { serverHold } from '../../src/ai/corp/hold';
import { stake } from '../../src/ai/corp/pools';
import { place } from '../../src/ai/corp/placement';
import { clearCaches, dealState, playDeal } from '../stage-a/harness';

const ALL = 'deal:1041:9:10,deal:2401:12:12,deal:1721:6:6,human:report-25.json:11:11,deal:1241:13:15,human:report-37.json:11:11,deal:1361:9:12,deal:1761:3:7,deal:1961:5:10';
const CASES = (process.env.CASES ?? ALL).split(',').map(c => {
  const p = c.split(':');
  return { src: `${p[0]}:${p[1]}`, from: Number(p[2]), to: Number(p[3]) };
});

const isIce = (c: CardInstance) => cardDef(c).type_code === 'ice';
const title = (c: CardInstance) => cardDef(c).title;
function short(s: GameState, a: GameAction | null): string {
  if (!a) return 'none';
  const x = a as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const c = x.cardInstanceId ? [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice])].find(k => k.instanceId === x.cardInstanceId) : null;
  return `${a.type}${c ? ` ${title(c)}` : ''}${x.asNewRemote ? '->new' : x.targetServerId ? `->${x.targetServerId}` : ''}`;
}
function counts(s: GameState): string {
  return asSide('corp', () =>
    Object.keys(s.corp.servers)
      .filter(id => stake(s, id).loss > 0 || id === 'hq' || id === 'rd')
      .map(id => {
        const h = serverHold(s, id, { when: 'runnerTurn' });
        return `${id}${h.holds ? '+' : '-'}${s.corp.servers[id].ice.length}(loss ${stake(s, id).loss.toFixed(1)}${h.holds ? '' : `, need ${h.need}/${h.budget}, ${h.entries} in`})`;
      })
      .join(' '),
  );
}
function placements(s: GameState): string[] {
  if (s.pendingPrompts.length || s.activePlayer !== 'corp') return [];
  const legal = getLegalActions(s, 'corp').filter(a => a.type === 'INSTALL_CARD') as (GameAction & { cardInstanceId: string })[];
  return s.corp.hq.filter(isIce).map(card => {
    const seen = new Set<string>();
    for (const from of legal.filter(a => a.cardInstanceId === card.instanceId)) {
      try {
        const p = place(s, card, { from, held: null });
        if (p[0]) seen.add(`${p[0].server}:${p[0].reason}`);
      } catch (e) {
        seen.add(`error ${(e as Error).message}`);
      }
    }
    // The count with this ice installed on each central (unrezzed; serverHold 'runnerTurn' after the install)
    const after = legal
      .filter(a => a.cardInstanceId === card.instanceId && ['hq', 'rd'].includes((a as { targetServerId?: string }).targetServerId ?? ''))
      .map(a => {
        const id = (a as { targetServerId?: string }).targetServerId!;
        try {
          const n = executeAction(s, a);
          const h = asSide('corp', () => serverHold(n, id, { when: 'runnerTurn' }));
          return `${id} ${h.holds ? 'holds' : `open (need ${h.need}/${h.budget}, ${h.entries} in)`}`;
        } catch (e) {
          return `${id} error ${(e as Error).message}`;
        }
      });
    return `${title(card)} -> ${[...seen].join(', ') || 'no placement (a counted line takes the click)'}${after.length ? ` | installed there: ${after.join(', ')}` : ''}`;
  });
}

function report(src: string, s: GameState, a: GameAction | null, from: number, to: number, i: number) {
  if (s.turnNumber < from || s.turnNumber > to || s.activePlayer !== 'corp' || actingSide(s) !== 'corp') return;
  const hand = s.corp.hq.map(c => (isIce(c) ? `*${title(c)}*` : title(c))).join(', ');
  const main = !s.pendingPrompts.length;
  console.log(`  #${i} T${s.turnNumber} ${s.corp.credits}cr ${s.corp.clicks}cl ${main ? '' : '(prompt) '}-> ${short(s, a)} | hand: ${hand}${main ? ` | ${counts(s)}` : ''}`);
  for (const p of placements(s)) console.log(`      place: ${p}`);
}

function turnEnds(prev: GameState, next: GameState, from: number, to: number) {
  if (prev.activePlayer === 'corp' && next.activePlayer === 'runner' && prev.turnNumber >= from && prev.turnNumber <= to) {
    const arch = [...next.corp.archives.faceUp, ...next.corp.archives.faceDown];
    const before = new Set([...prev.corp.archives.faceUp, ...prev.corp.archives.faceDown].map(c => c.instanceId));
    const fresh = arch.filter(c => !before.has(c.instanceId));
    console.log(`  END of Corp T${prev.turnNumber}: ice in hand ${next.corp.hq.filter(isIce).map(title).join(', ') || 'none'}; to Archives ${fresh.map(c => `${title(c)}${isIce(c) ? ' (ice)' : ''}`).join(', ') || 'none'}; ${next.corp.credits}cr | ${counts(next)}`);
  }
}

for (const { src, from, to } of CASES) {
  console.log(`\n=== ${src} T${from}..T${to}`);
  if (src.startsWith('deal:')) {
    const seed = Number(src.slice(5));
    let i = 0;
    let last: GameState | null = null;
    const corp = createAgent('corp', 'normal');
    const watched = {
      side: 'corp',
      chooseAction(state: GameState) {
        clearCaches();
        if (last) turnEnds(last, state, from, to);
        const a = corp.chooseAction(state);
        report(src, state, a, from, to, i++);
        last = state;
        return a;
      },
      chooseRez(state: GameState, cards: CardInstance[]) {
        clearCaches();
        i++;
        return corp.chooseRez?.(state, cards) ?? null;
      },
    } as unknown as Agent;
    void dealState;
    const end = playDeal(seed, { corp: () => watched });
    console.log(`  game end T${end.turnNumber}: ${end.winner} ${end.corp.score}-${end.runner.score} (${end.winReason ?? ''})`);
  } else {
    const r = JSON.parse(readFileSync(`tests/fixtures/human-games/${src.slice(6)}`, 'utf8'));
    let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    if (r.startStops) s = { ...s, stops: r.startStops };
    let i = 0;
    for (const move of r.moves as GameAction[]) {
      if (actingSide(s) === 'corp' && s.turnNumber >= from && s.turnNumber <= to && s.activePlayer === 'corp') {
        clearCaches();
        let ai = '';
        try {
          ai = short(s, createAgent('corp', 'normal').chooseAction(s));
        } catch (e) {
          ai = `error ${(e as Error).message}`;
        }
        report(src, s, move, from, to, i);
        console.log(`      today's Normal Corp: ${ai}`);
      }
      if (actingSide(s) === 'corp') i++;
      let next: GameState;
      try {
        next = executeAction(s, move);
      } catch {
        break;
      }
      turnEnds(s, next, from, to);
      s = next;
    }
    console.log(`  game end T${s.turnNumber}: ${s.winner} ${s.corp.score}-${s.runner.score}`);
  }
}
