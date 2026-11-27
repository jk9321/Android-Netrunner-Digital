// R-109 red team scan: how often one executeAction both draws (R&D -> HQ) and sends an R&D card that did not end in HQ,
// or a card drawn in that action, to a hidden place outside HQ and R&D (the case where rdKnowledge's destOf and the hand
// walk's prev.corp.hq read the instance's real path). Also: states where the HQ list counts >= 2 copies of one code certain.
// Copy into scripts/ and run: npx vite-node scripts/scan-mixed-actions.ts -- <from> <to> <steps>
import { createInitialGameState, executeAction, getLegalActions, createRng, GameState, CardInstance } from '../../../src/core';
import { deckGameSetup } from '../../../src/data/decks';
import { certainInHand } from '../../../src/core/engine/helpers';
import { FUZZ_CORPS, FUZZ_RUNNERS, pickAction } from '../../engine-fuzz-check';
import { actingSide } from '../../../src/core/engine/priority';

const args = process.argv.slice(2).filter(a => a !== '--');
const [from, to, steps] = [Number(args[0] ?? 1), Number(args[1] ?? 101), Number(args[2] ?? 1500)];
const hiddenNonHand = (s: GameState): Set<string> => {
  const ids = new Set<string>();
  for (const sv of Object.values(s.corp.servers)) for (const c of [...sv.root, ...sv.ice]) if (!c.isRezzed && !c.faceUp) ids.add(c.instanceId);
  for (const c of s.corp.archives.faceDown) ids.add(c.instanceId);
  return ids;
};
let secretTrashKnown = 0, secretTrashAll = 0;
let mixed = 0, drawAndHqExit = 0, dupCertain = 0, actionsSeen = 0, sepSightings = 0;
const sepEx: string[] = [];
const examples: string[] = [];
for (let seed = from; seed < to; seed++) {
  const corp = FUZZ_CORPS[seed % FUZZ_CORPS.length];
  const runner = FUZZ_RUNNERS[Math.floor(seed / FUZZ_CORPS.length) % FUZZ_RUNNERS.length];
  const rng = createRng(seed ^ 0x5eed);
  let s: GameState = createInitialGameState(deckGameSetup(seed, corp, runner));
  let dupSeenThisGame = false;
  let sepThisGame = false;
  const firstSeen = new Map<string, { step: number; drawn: boolean }>();
  for (let i = 0; i < steps && !s.winner; i++) {
    const side = actingSide(s);
    if (!side) break;
    const a = pickAction(getLegalActions(s, side), rng);
    if (!a) break;
    let n: GameState;
    try { n = executeAction(s, a); } catch { break; }
    actionsSeen++;
    const hqNow = new Set(n.corp.hq.map(c => c.instanceId));
    const prevHq = new Set(s.corp.hq.map(c => c.instanceId));
    const prevRd = s.corp.rd.map(c => c.instanceId);
    const hid = hiddenNonHand(n);
    const hidBefore = hiddenNonHand(s);
    const drawn = prevRd.filter(id => hqNow.has(id));
    const rdToHidden = prevRd.filter(id => hid.has(id) && !hidBefore.has(id));
    const hqToHidden = [...prevHq].filter(id => hid.has(id) && !hidBefore.has(id));
    if (drawn.length > 0 && rdToHidden.length > 0) {
      mixed++;
      if (examples.length < 15) examples.push(`seed ${seed} step ${i + 1} ${corp.id} ${a.type}${'cardId' in a ? ' ' + (a as { cardId?: string }).cardId : ''}: drawn ${drawn.length}, R&D->hidden ${rdToHidden.length}`);
    }
    if (drawn.length > 0 && hqToHidden.length > 0) drawAndHqExit++;
    // C3: a secret trash from the top of R&D (AU Co. 35046, Cultivate 36043) of a card the Runner placed exactly
    const src = s.pendingPrompts[0] && 'source' in s.pendingPrompts[0] ? s.pendingPrompts[0].source : undefined;
    if (src && (src.cardCode === '35046' || src.cardCode === '36043') && src.step === 'trash') {
      secretTrashAll++;
      const exact = new Set((s.corp.rdKnownToRunner ?? []).filter(e => e.lo === e.hi && !e.left).map(e => e.id));
      if ((n.corp.archKnownToRunner ?? []).some(e => exact.has(e.id) && !(s.corp.archKnownToRunner ?? []).some(k => k.id === e.id))) secretTrashKnown++;
    }
    for (const e of n.corp.knownToRunner ?? []) if (!firstSeen.has(e.id)) firstSeen.set(e.id, { step: i + 1, drawn: s.corp.rd.some(c => c.instanceId === e.id) });
    for (const e of [...firstSeen.keys()]) if (!(n.corp.knownToRunner ?? []).some(k => k.id === e)) firstSeen.delete(e);
    const certain = certainInHand(n, 'corp');
    if (!dupSeenThisGame && certain.some(([, k]) => k >= 2)) { dupCertain++; dupSeenThisGame = true; }
    // B: a code counted >= 2 certain whose entries came from sightings in HQ (not draws) in different actions
    for (const [code, k] of certain) {
      if (k < 2 || sepThisGame) continue;
      const steps = new Set((n.corp.knownToRunner ?? []).filter(e => e.code === code && !firstSeen.get(e.id)?.drawn).map(e => firstSeen.get(e.id)?.step));
      if (steps.size >= 2) { sepSightings++; sepThisGame = true; if (sepEx.length < 8) sepEx.push(`seed ${seed} step ${i + 1} ${corp.id} vs ${runner.id}: ${code} x${k}, sightings at steps ${[...steps].join(',')}`); }
    }
    s = n;
  }
}
console.log(`secret trashes ${secretTrashAll}, of a card the Runner placed exactly (now certain in Archives) ${secretTrashKnown}`);
console.log(`seeds ${from}-${to - 1}, ${actionsSeen} actions: mixed draw + R&D card to a hidden place ${mixed}; draw + HQ card to a hidden place ${drawAndHqExit}; games with a code counted >= 2 certain in HQ ${dupCertain}; of those, from HQ sightings in different actions ${sepSightings}`);
for (const e of sepEx) console.log('  B ' + e);
for (const e of examples) console.log('  ' + e);
void ({} as CardInstance);
