import { CardInstance } from '../core/types/card';
import { isHidden } from '../core/cards';
import { GameState } from '../core/types/state';

export type FateKind = 'stolen' | 'trashed' | 'scored';

/** Something that just happened to a card, worth showing on the table. */
export interface CardFate {
  kind: FateKind;
  card: CardInstance;
  /** The card went to Archives face down, so only the Corp may see its face. */
  corpSecret: boolean;
}

const ids = (cards: CardInstance[]) => new Set(cards.map(c => c.instanceId));

/** Every card id in a state, in any zone. */
function everyId(state: GameState): Set<string> {
  const { corp, runner } = state;
  return ids([
    corp.identity,
    runner.identity,
    ...Object.values(corp.servers).flatMap(s => [...s.root, ...s.ice]),
    ...corp.hq, ...corp.rd, ...corp.archives.faceUp, ...corp.archives.faceDown, ...corp.scoreArea,
    ...runner.grip, ...runner.stack, ...runner.heap, ...runner.rig.programs, ...runner.rig.hardware, ...runner.rig.resources, ...runner.scoreArea,
    ...state.removedFromGame,
  ]);
}

/** Every installed card, Corp and Runner. */
function installedIds(state: GameState): Set<string> {
  const { corp, runner } = state;
  return ids([
    ...Object.values(corp.servers).flatMap(s => [...s.root, ...s.ice]),
    ...runner.rig.programs,
    ...runner.rig.hardware,
    ...runner.rig.resources,
  ]);
}

/**
 * The cards stolen, scored or trashed between two states. A card counts as
 * trashed when it was installed, or was in HQ or R&D while the Runner was
 * accessing, and is now in Archives or the heap. Discards from hand and played
 * events and operations are not trashes, so they don't show.
 */
export function cardFates(prev: GameState, next: GameState): CardFate[] {
  const fates: CardFate[] = [];

  const stolenBefore = ids(prev.runner.scoreArea);
  for (const card of next.runner.scoreArea) {
    if (!stolenBefore.has(card.instanceId)) fates.push({ kind: 'stolen', card, corpSecret: false });
  }
  const scoredBefore = ids(prev.corp.scoreArea);
  for (const card of next.corp.scoreArea) {
    if (!scoredBefore.has(card.instanceId)) fates.push({ kind: 'scored', card, corpSecret: false });
  }

  const eligible = installedIds(prev);
  const accessing = prev.activeRun?.phase === 'access';
  if (accessing) {
    for (const card of [...prev.corp.hq, ...prev.corp.rd]) eligible.add(card.instanceId);
  }
  // On one player's screen (a table rebuilt from their view) a card from HQ or R&D they couldn't see
  // shows up in Archives with an id of its own: during an access it was trashed from there
  const before = everyId(prev);
  const trashedBefore = ids([...prev.runner.heap, ...prev.corp.archives.faceUp, ...prev.corp.archives.faceDown]);
  const pushTrashed = (cards: CardInstance[], corpSecret: boolean) => {
    for (const card of cards) {
      if ((eligible.has(card.instanceId) || (accessing && !before.has(card.instanceId))) && !trashedBefore.has(card.instanceId)) {
        fates.push({ kind: 'trashed', card, corpSecret });
      }
    }
  };
  pushTrashed(next.corp.archives.faceUp, false);
  pushTrashed(next.corp.archives.faceDown, true);
  pushTrashed(next.runner.heap, false);
  // An installed card trashed facedown that this screen can't see in Archives (the Runner's view, rules 4.4.6c):
  // it left the table as Archives' facedown count went up, so it shows as a card back
  const hiddenAdded = next.corp.archives.faceDown.length - prev.corp.archives.faceDown.length;
  if (hiddenAdded > 0 && next.corp.archives.faceDown.every(isHidden)) {
    const now = everyId(next);
    const gone = Object.values(prev.corp.servers)
      .flatMap(s => [...s.ice, ...s.root])
      .filter(c => isHidden(c) && !now.has(c.instanceId));
    for (const card of gone.slice(0, hiddenAdded)) fates.push({ kind: 'trashed', card, corpSecret: true });
  }
  return fates;
}
