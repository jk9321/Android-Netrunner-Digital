import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CardInstance, GameAction, GameState, cardDef, getLegalActions, isLegalAction, trashableFirst } from '../../core';
import { TrashFirstButton, TrashFirstPicker } from './TrashFirstPicker';

/**
 * Where the selected HQ card can go: a new remote, or any server the engine
 * allows (ice on any server, upgrades in centrals, a replacement in a remote).
 */
export function CorpInstallOptions({
  state,
  card,
  onAction,
}: {
  state: GameState;
  card: CardInstance;
  onAction: (action: GameAction) => void;
}) {
  const def = cardDef(card);
  // Trash cards already there first (rules 8.5.6): ice for ice (they then don't count toward its cost), root cards for a root install
  const [replacing, setReplacing] = useState<{ cardId: string; serverId: string } | null>(null);
  const installWithTrash = (serverId: string, trashFirst: string[]): GameAction => ({
    type: 'INSTALL_CARD',
    player: 'corp',
    cardInstanceId: card.instanceId,
    targetServerId: serverId,
    trashFirst,
  });
  const replaceable = Object.values(state.corp.servers).filter(s => {
    const cards = trashableFirst(state, card, s.id);
    return cards.length > 0 && isLegalAction(state, installWithTrash(s.id, cards.map(c => c.instanceId)));
  });
  const what = def.type_code === 'ice' ? 'ice' : 'cards';
  if (replacing?.cardId === card.instanceId) {
    const server = state.corp.servers[replacing.serverId];
    // Outermost ice first, as on the board
    const cards = trashableFirst(state, card, server.id);
    return (
      <TrashFirstPicker
        key={`${card.instanceId}-${server.id}`}
        heading={`Install ${def.title} in ${server.name}, trashing first:`}
        cards={def.type_code === 'ice' ? cards.reverse() : cards}
        confirmLabel={trash => {
          const cost = def.type_code === 'ice' ? Math.max(0, server.ice.length - trash.length) : 0;
          return `Install${cost > 0 ? ` (${cost}c)` : ''}${trash.length > 0 ? `, trash ${trash.length}` : ''}`;
        }}
        canConfirm={trash => isLegalAction(state, installWithTrash(server.id, trash))}
        onConfirm={trash => {
          setReplacing(null);
          onAction(installWithTrash(server.id, trash));
        }}
        onCancel={() => setReplacing(null)}
      />
    );
  }
  const options = getLegalActions(state, 'corp').filter(
    (a): a is Extract<GameAction, { type: 'INSTALL_CARD' }> => a.type === 'INSTALL_CARD' && a.cardInstanceId === card.instanceId
  );
  if (options.length === 0 && replaceable.length === 0) {
    return <span className="text-xs text-slate-400">{def.title} cannot be installed right now.</span>;
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="install-options">
      <span className="text-xs text-amber-300 font-bold">Install {def.title}:</span>
      {options.map(a => {
        const server = a.targetServerId ? state.corp.servers[a.targetServerId] : null;
        const iceCost = def.type_code === 'ice' && server ? server.ice.length : 0;
        const replaced =
          server && ['agenda', 'asset'].includes(def.type_code)
            ? server.root.find(c => ['agenda', 'asset'].includes(cardDef(c).type_code))
            : undefined;
        return (
          <button
            key={`${a.targetServerId ?? 'new'}${a.faceUp ? '-faceup' : ''}`}
            onClick={() => onAction(a)}
            data-testid={`install-${a.targetServerId ?? 'new'}${a.faceUp ? '-faceup' : ''}`}
            title={replaced ? `Trashes ${cardDef(replaced).title} to make room` : undefined}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1 shadow-lg"
          >
            <Plus className="w-3.5 h-3.5" /> {server ? server.name : 'New remote'}
            {iceCost > 0 && ` (${iceCost}c)`}
            {replaced && ' (replace)'}
            {a.faceUp && ' (faceup)'}
          </button>
        );
      })}
      {replaceable.map(server => (
        <TrashFirstButton
          key={`trash-${server.id}`}
          label={`${server.name}: trash ${what} first`}
          title={
            def.type_code === 'ice'
              ? `Trash ice protecting ${server.name} first; trashed ice doesn't count toward the install cost`
              : `Trash cards in the root of ${server.name} first`
          }
          onClick={() => setReplacing({ cardId: card.instanceId, serverId: server.id })}
          testId={`install-replace-${server.id}`}
        />
      ))}
    </div>
  );
}
