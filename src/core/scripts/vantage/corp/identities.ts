import { GameState } from '../../../types/state';
import { shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { revealInHand } from '../../../engine/helpers';
import { flipIdentity, gainFromCard, useOncePerTurn } from '../../../engine/cardEffects';
import { CardScript } from '../../types';
import { askCards, askChoice, takeFromRD } from '../../effects';
import { archivesCards, ids, isCentral, keywords, onceKey, takeFromCorpZone, title, type } from './helpers';

// Méliès U: Only the Brightest. When your discard phase ends, secretly set your identity to
// any copy of Méliès U (rules 1.5.2b: each copy's back names HQ, R&D or Archives). When the
// Runner makes a successful run on a central server, flip this identity. When the Runner's
// action phase ends, gain 1 credit. Back side: when you flip this identity to this side during
// a run on its server, look at the top card of R&D. You may trash that card. If you do, add 1
// card from Archives to HQ. When the Runner's discard phase ends, flip this identity.
const MELIES_SERVERS = { hq: 'HQ', rd: 'R&D', archives: 'Archives' } as const;

export const melies: CardScript = {
  triggers: {
    discard_phase_ends: (ctx, e) => {
      const { state } = ctx;
      if (e.side === 'runner') {
        if (state.corp.identity.flipped) flipIdentity(state, 'corp');
        return;
      }
      askChoice(ctx, 'corp', 'Méliès U: secretly set your identity to the copy for which server?', [
        { id: 'hq', label: 'HQ' },
        { id: 'rd', label: 'R&D' },
        { id: 'archives', label: 'Archives' },
      ], 'set');
    },
    successful_run: (ctx, e) => {
      const { state } = ctx;
      if (state.corp.identity.flipped || !isCentral(e.server)) return;
      flipIdentity(state, 'corp');
      const side = state.corp.meliesServer ?? 'hq';
      addLog(state, 'corp', `Méliès U was flipped: the ${MELIES_SERVERS[side]} side.`);
      if (side !== e.server || state.corp.rd.length === 0) return;
      const top = state.corp.rd[0];
      askChoice(ctx, 'corp', `Méliès U: the top card of R&D is ${title(top)}. Trash it to add 1 card from Archives to HQ?`, [
        { id: 'trash', label: `Trash ${title(top)}` },
        { id: 'no', label: 'Leave it' },
      ], 'top');
    },
    action_phase_ends: (ctx, e) => {
      if (e.side !== 'runner' || ctx.state.corp.identity.flipped) return;
      gainFromCard(ctx.state, 'corp', 1, ctx.card);
      addLog(ctx.state, 'corp', 'Corp gained 1 [credit] (Méliès U).');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'set' && answer.kind === 'effect_choice') {
      state.corp.meliesServer = answer.optionId as 'hq' | 'rd' | 'archives';
      state.corp.identity.flipped = false;
      addLog(state, 'corp', 'Corp secretly set their identity (Méliès U).');
    } else if (source.step === 'top' && answer.kind === 'effect_choice' && answer.optionId === 'trash') {
      const top = state.corp.rd.shift();
      if (!top) return;
      state.corp.archives.faceDown.push(top);
      addLog(state, 'corp', 'Corp trashed the top card of R&D (Méliès U).');
      askCards(ctx, 'corp', 'Méliès U: add 1 card from Archives to HQ.', ids(archivesCards(state)), 1, 1, 'archives');
    } else if (source.step === 'archives' && answer.kind === 'effect_cards') {
      const card = archivesCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      const faceUp = state.corp.archives.faceUp.includes(card);
      takeFromCorpZone(state, card);
      state.corp.hq.push(card);
      if (faceUp) revealInHand(state, 'corp', [card]);
      addLog(state, 'corp', `Corp added ${faceUp ? title(card) : 'a facedown card'} from Archives to HQ (Méliès U).`);
    }
  },
};

// Editorial Division: Ad Nihilum. The first time each turn you take bad publicity, you may
// search R&D for 1 non-agenda black ops, gray ops, or liability card and reveal it. Add it to HQ.
const editorialTargets = (state: GameState) =>
  state.corp.rd.filter(c => type(c) !== 'agenda' && /\b(black ops|gray ops|liability)\b/i.test(keywords(c)));

export const editorial: CardScript = {
  triggers: {
    bad_publicity_taken: ctx => {
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      askCards(ctx, 'corp', 'Editorial Division: you may search R&D for 1 black ops, gray ops or liability card.', ids(editorialTargets(ctx.state)), 0, 1, 'search');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const card = answer.cardInstanceIds.length > 0 ? takeFromRD(state, answer.cardInstanceIds[0]) : undefined;
    if (!card) {
      shuffleRD(state);
      return;
    }
    state.corp.hq.push(card);
    revealInHand(state, 'corp', [card]);
  },
};

// --- Agendas ----------------------------------------------------------------

export const vantageCorpIdentitiesScripts: Record<string, CardScript> = {
  '36036': melies,
  '36046': editorial,
};
