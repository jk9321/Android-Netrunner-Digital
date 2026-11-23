/**
 * R-A A-log Step 0a: Source table for the 26 card cases and 7 cross-side cards.
 *
 * Counts, for each card:
 *   - batchPool: number of decks holding it in scripts/nsg-sample-decks.ts (13 Corp x 17 Runner)
 *   - nrdbPool:  number of decks holding it in scripts/nrdb-test-decks.ts (11 Corp x 10 Runner)
 *   - humanDeck: number of files in tests/fixtures/human-games/ (38 files) whose decklist holds it
 *   - humanMet:  number of human files where the card was actually MET IN PLAY (active identity,
 *                installed, played, rezzed, encountered, or accessed during replay — not merely in a decklist)
 *
 * Usage:
 *   npx vite-node scripts/runner-rework/facts-source-table.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  GameAction,
  GameState,
  createInitialGameState,
  executeAction,
  findCardAnywhere,
  getCardDefinition,
} from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { ALL_DECKS as BATCH_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS as NRDB_DECKS } from '../nrdb-test-decks';

export const CASES_26: { code: string; name: string; group: 'case26' | 'seven' | 'both' }[] = [
  { code: '34077', name: 'Window of Opportunity', group: 'case26' },
  { code: '30028', name: 'Jailbreak', group: 'case26' },
  { code: '36022', name: 'Read-Write Share', group: 'case26' },
  { code: '30004', name: 'Botulus', group: 'both' },
  { code: '30017', name: 'Tranquilizer', group: 'both' },
  { code: '30032', name: 'Mayfly', group: 'case26' },
  { code: '35068', name: 'BANGUN', group: 'case26' },
  { code: '35008', name: 'Hantu', group: 'case26' },
  { code: '34004', name: 'Audrey v2', group: 'case26' },
  { code: '34005', name: 'Banner', group: 'case26' },
  { code: '34090', name: 'Lobisomem', group: 'case26' },
  { code: '34092', name: 'Pressure Spike', group: 'case26' },
  { code: '36004', name: 'Corsair', group: 'case26' },
  { code: '34026', name: 'Slap Vandal', group: 'case26' },
  { code: '34082', name: 'Physarum Entangler', group: 'both' },
  { code: '30054', name: 'Funhouse', group: 'both' },
  { code: '34012', name: 'S-Dobrado', group: 'case26' },
  { code: '34078', name: 'Alarm Clock', group: 'case26' },
  { code: '30042', name: 'Manegarm Skunkworks', group: 'case26' },
  { code: '35061', name: 'Idiosyncresis', group: 'case26' },
  { code: '34081', name: 'Malandragem', group: 'case26' },
  { code: '34016', name: 'Laser Pointer', group: 'case26' },
  { code: '34015', name: 'Curupira', group: 'case26' },
  { code: '35021', name: 'Fransofia Ward', group: 'case26' },
  { code: '36001', name: 'Chain Reaction', group: 'case26' },
  // 26th case: note count1 B3 lists 25 distinct codes (Botulus+Tranquilizer counted together as 2 -> 25 total; check Mycoweb too)
  // Plus the remaining 3 of the 7 cross-side cards (L3):
  { code: '34035', name: 'Jaguarundi', group: 'seven' },
  { code: '34118', name: 'Seraph', group: 'seven' },
  { code: '36052', name: 'Paywall', group: 'seven' },
  // Plus L12 Mycoweb:
  { code: '35053', name: 'Mycoweb', group: 'seven' },
];

function deckHasCode(deck: any, code: string): boolean {
  const def = getCardDefinition(code);
  const title = def?.title ?? '';
  if (deck.identity === title || deck.identity === code) return true;
  if (deck.cards) {
    if (deck.cards[title] > 0 || deck.cards[code] > 0) return true;
  }
  return false;
}

function collectActiveCodes(state: GameState, seen: Set<string>) {
  seen.add(state.corp.identity.cardCode);
  seen.add(state.runner.identity.cardCode);
  for (const c of [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources]) {
    seen.add(c.cardCode);
    for (const h of c.hostedCards ?? []) seen.add(h.cardCode);
  }
  for (const sv of Object.values(state.corp.servers)) {
    for (const c of [...sv.ice, ...sv.root]) {
      if (c.isRezzed || c.faceUp || c.runnerKnows) seen.add(c.cardCode);
      for (const h of c.hostedCards ?? []) seen.add(h.cardCode);
    }
  }
  for (const c of [...state.corp.archives.faceUp, ...state.corp.scoreArea, ...state.runner.scoreArea, ...state.runner.heap]) {
    seen.add(c.cardCode);
  }
}

function main() {
  const hdir = 'tests/fixtures/human-games';
  const files = readdirSync(hdir)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));

  const humanDeckCounts = new Map<string, number>();
  const humanMetCounts = new Map<string, number>();

  for (const f of files) {
    const fix = JSON.parse(readFileSync(join(hdir, f), 'utf8'));
    for (const item of CASES_26) {
      if (deckHasCode(fix.config.corpDeck, item.code) || deckHasCode(fix.config.runnerDeck, item.code)) {
        humanDeckCounts.set(item.code, (humanDeckCounts.get(item.code) ?? 0) + 1);
      }
    }
    const setup = deckGameSetup(fix.config.seed, fix.config.corpDeck, fix.config.runnerDeck);
    let st: GameState = createInitialGameState(setup);
    if (fix.startStops) st = { ...st, stops: fix.startStops };
    const met = new Set<string>();
    collectActiveCodes(st, met);
    for (const mv of fix.moves as GameAction[]) {
      if ('cardInstanceId' in mv && typeof mv.cardInstanceId === 'string') {
        const c = findCardAnywhere(st, mv.cardInstanceId);
        if (c) met.add(c.cardCode);
      }
      try {
        st = executeAction(st, mv);
        collectActiveCodes(st, met);
      } catch {
        // e.g. report-24 stops at move 286
        break;
      }
    }
    for (const code of met) {
      humanMetCounts.set(code, (humanMetCounts.get(code) ?? 0) + 1);
    }
  }

  console.log(`Source table (Batch: ${BATCH_DECKS.length} decks [13C+17R], NRDB: ${NRDB_DECKS.length} decks [11C+10R], Human: ${files.length} files)\n`);
  console.log('| Code | Card | Group | Batch decks | NRDB decks | Human decklist | Human met in play |');
  console.log('| --- | --- | --- | ---: | ---: | ---: | ---: |');
  for (const item of CASES_26) {
    const b = BATCH_DECKS.filter(d => deckHasCode(d, item.code)).length;
    const n = NRDB_DECKS.filter(d => deckHasCode(d, item.code)).length;
    const hd = humanDeckCounts.get(item.code) ?? 0;
    const hm = humanMetCounts.get(item.code) ?? 0;
    const def = getCardDefinition(item.code);
    console.log(`| \`${item.code}\` | ${def?.title ?? item.name} | ${item.group} | ${b} | ${n} | ${hd} | ${hm} |`);
  }
}

main();
