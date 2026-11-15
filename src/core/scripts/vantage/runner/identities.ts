import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { runnerSeesRd } from '../../../engine/rdKnowledge';
import { drawForEffect, removeTags } from '../../../engine/cardEffects';
import { CardScript } from '../../types';

// Virtual Intelligence, P.I.: Once per turn -> click, 1 credit: Draw 1 card and remove 1 tag.
export const vic: CardScript = {
  abilities: [
    {
      label: 'Draw 1 card and remove 1 tag.',
      clicks: 1,
      credits: 1,
      oncePerTurn: true,
      resolve: ({ state }) => {
        drawForEffect(state, 'runner', 1, 'Virtual Intelligence, P.I.');
        if (removeTags(state, 1) > 0) addLog(state, 'runner', 'Runner removed 1 tag (Virtual Intelligence, P.I.).');
      },
    },
  ],
};

// Hiram "0mission" Svensson: Whenever you install or trash a piece of hardware (from any
// location), look at the top card of R&D.
const hiramLook = (state: GameState) => {
  const top = state.corp.rd[0];
  if (!top) return;
  // Only the Runner looks (the Corp doesn't know the order of R&D either)
  addLog(state, 'runner', `Runner looked at the top card of R&D: ${cardDef(top).title} (Hiram "0mission" Svensson).`, top.cardCode, undefined, {
    from: 'corp',
    publicMessage: 'Runner looked at the top card of R&D (Hiram "0mission" Svensson).',
  });
  runnerSeesRd(state, top);
};

export const hiram: CardScript = {
  triggers: {
    installed: (ctx, e) => cardDef(e.card).type_code === 'hardware' && cardDef(e.card).side_code === 'runner' && hiramLook(ctx.state),
    hardware_trashed: ctx => hiramLook(ctx.state),
  },
};

// --- Events -----------------------------------------------------------------

export const vantageRunnerIdentitiesScripts: Record<string, CardScript> = {
  '36009': vic,
  '36017': hiram,
};
